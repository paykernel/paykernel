/**
 * Engine crash-boundary tests (roadmap / Phase 10 §10.6).
 *
 * Each scenario is named for the pipeline boundary it documents.
 * Handler MUST be idempotent: reclaim after a crash may re-run the handler.
 *
 * Boundaries covered:
 * 1. Before claim
 * 2. After claim, before handler
 * 3. During handler
 * 4. After external side effect, before complete
 * 5. After completion
 */
import { describe, it, expect } from "bun:test";
import { createWebhookInboxEngine } from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { isStoreLeaseLostError } from "./store";
import { createTestClock } from "./test-clock";

describe("crash boundaries (10.6)", () => {
  /**
   * 10.6.1 — Crash BEFORE claim
   * No store mutation; redelivery is safe and can complete normally once the
   * process is healthy again.
   */
  it("10.6 crash before claim: no store mutation; safe retry", async () => {
    const store = createMemoryWebhookInboxStore();
    store.simulateCrash({ message: "crash before claim" });
    const engine = createWebhookInboxEngine({ store, mode: "inline" });

    await expect(
      engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_pre",
        payloadHash: "h",
        handler: async () => {},
      }),
    ).rejects.toThrow(/crash before claim/);

    expect(store.size).toBe(0);

    // Retry after one-shot crash cleared
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_pre",
      payloadHash: "h",
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "processed" });
  });

  /**
   * 10.6.2 — Crash AFTER claim, BEFORE handler
   * Lease is held; concurrent process reports already_processing until lease
   * expires; reclaim then runs the handler under a new lease token.
   */
  it("10.6 crash after claim before handler: abandon then reclaim", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    // Simulate: claim succeeded, process died before handler started
    const claim = await store.claim({
      key: "stripe:evt_abandon",
      payloadHash: "h",
      owner: "crashed",
      leaseMs: 1000,
    });
    expect(claim.kind).toBe("acquired");

    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    // Still in progress under active lease
    const busy = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_abandon",
      payloadHash: "h",
      handler: async () => {},
    });
    expect(busy.outcome).toBe("already_processing");

    // Expire lease — reclaim runs handler once
    clock.advance(2000);
    let runs = 0;
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_abandon",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "processed" });
    expect(runs).toBe(1);
  });

  /**
   * 10.6.3 — Crash DURING handler
   * Side effect may have partially applied; lease expires; reclaim re-runs the
   * handler. APPLICATION HANDLERS MUST BE IDEMPOTENT.
   */
  it("10.6 crash during handler: abandon lease; reclaim re-runs (handler idempotency required)", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    let runs = 0;
    // Claim + simulate mid-handler crash (side effect without complete)
    const claim = await store.claim({
      key: "stripe:evt_mid",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1000,
    });
    expect(claim.kind).toBe("acquired");
    runs = 1; // first handler attempt side effect, process died before complete

    clock.advance(2000);
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_mid",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "processed" });
    // Handler re-ran after reclaim — documents idempotency requirement
    expect(runs).toBe(2);
  });

  /**
   * 10.6.4 — Crash AFTER external side effect, BEFORE complete
   * Stale worker's complete is rejected (lease_lost). Engine MUST NOT report
   * `processed` — uncertain outcome stays retryable (never convert to failure
   * without certainty; never silent-ACK as success).
   */
  it("10.6 crash after side effect before complete: complete lease_lost → not processed", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    // Side effect done, but lease expired before complete (stale worker)
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_side",
      payloadHash: "h",
      handler: async (_ctx) => {
        // External side effect "committed"; lease expires before complete
        clock.advance(5000);
      },
    });
    // Must NOT claim success when complete fails
    expect(outcome.outcome).not.toBe("processed");
    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
  });

  /**
   * 10.6.4 (mid-reclaim fencing) — After lease expiry a new worker reclaims
   * while the old token is still known. Stale `store.complete` is rejected
   * (lease_lost) even while the new lease is active; the new owner can finish.
   * Stronger than lease-expiry-only: proves token fencing under concurrent reclaim.
   */
  it("10.6 mid-reclaim fencing: stale complete rejected while new lease active; reclaim processes", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });

    const first = await store.claim({
      key: "stripe:evt_mid_fence",
      payloadHash: "h",
      owner: "stale-worker",
      leaseMs: 1000,
    });
    if (first.kind !== "acquired") throw new Error("expected acquired");
    const staleToken = first.leaseToken;
    // External side effect assumed committed under staleToken; process dies.

    clock.advance(2000);

    // New worker reclaims and holds the lease (mid-reclaim window).
    const reclaim = await store.claim({
      key: "stripe:evt_mid_fence",
      payloadHash: "h",
      owner: "reclaim-worker",
      leaseMs: 5000,
    });
    if (reclaim.kind !== "acquired") throw new Error("expected reclaimed");
    expect(reclaim.leaseToken).not.toBe(staleToken);

    // Stale worker wakes and tries complete — must not terminalize under new lease.
    try {
      await store.complete({
        key: "stripe:evt_mid_fence",
        leaseToken: staleToken,
      });
      throw new Error("should throw lease_lost");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
    }

    // Row still claimed by reclaim worker — not falsely completed.
    const mid = await store.get("stripe:evt_mid_fence");
    expect(mid?.status).toBe("claimed");
    expect(mid?.leaseToken).toBe(reclaim.leaseToken);

    // Engine path after reclaim owner completes: redelivery is terminal.
    await store.complete({
      key: "stripe:evt_mid_fence",
      leaseToken: reclaim.leaseToken,
    });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });
    let runs = 0;
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_mid_fence",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(0);
  });

  /**
   * 10.6.5 — Crash AFTER completion
   * Terminal completed state; redelivery → duplicate_completed; handler not re-run.
   */
  it("10.6 crash after completion: redelivery → duplicate_completed", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_done2",
      payloadHash: "h",
      handler: async () => {},
    });
    let runs = 0;
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_done2",
      payloadHash: "h",
      handler: async () => {
        runs++;
        throw new Error("should not run");
      },
    });
    expect(o).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(0);
  });
});
