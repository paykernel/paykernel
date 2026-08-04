/**
 * B3 / B4 / N2 regression tests:
 * - ackAfterClaim does not burn maxAttempts handler budget
 * - claim respects availableAt (true backoff under redelivery)
 * - NonRetryableHandlerError({ deadLetter: false }) poison path documented + capped
 */
import { describe, it, expect } from "bun:test";
import { createWebhookInboxEngine } from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { createTestClock } from "./test-clock";
import { NonRetryableHandlerError } from "./types";

describe("B3: ackAfterClaim must not burn handler attempt budget", () => {
  it("maxAttempts=3 + ackAfterClaim → 3 handler failures before dead_letter", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      maxAttempts: 3,
      defaultRetryAfterMs: 0,
      clock,
    });

    const park = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b3",
      payloadHash: "h",
      envelope: { id: "evt_b3" },
    });
    expect(park).toEqual({ outcome: "scheduled_for_retry" });

    const afterPark = await store.get("stripe:evt_b3");
    // Parking claim is free: attempts restored to 0.
    expect(afterPark?.status).toBe("pending");
    expect(afterPark?.attempts).toBe(0);

    let handlerRuns = 0;
    const failHandler = async () => {
      handlerRuns++;
      throw new Error(`handler fail #${handlerRuns}`);
    };

    // Handler attempts 1 and 2 → scheduled_for_retry; attempt 3 → dead_letter.
    for (let i = 1; i <= 2; i++) {
      const result = await engine.processRetryable({ handler: failHandler });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.outcome).toEqual({ outcome: "scheduled_for_retry" });
      const rec = await store.get("stripe:evt_b3");
      expect(rec?.status).toBe("pending");
      expect(rec?.attempts).toBe(i);
    }

    const third = await engine.processRetryable({ handler: failHandler });
    expect(third.items).toHaveLength(1);
    expect(third.items[0]?.outcome).toEqual({
      outcome: "handler_failed",
      retryable: false,
    });
    expect(handlerRuns).toBe(3);

    const terminal = await store.get("stripe:evt_b3");
    expect(terminal?.status).toBe("dead_letter");
    expect(terminal?.attempts).toBe(3);

    // Terminal re-claim does not re-run handler.
    const redelivery = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b3",
      payloadHash: "h",
      handler: failHandler,
      ackAfterClaim: false,
    });
    expect(redelivery).toEqual({ outcome: "handler_failed", retryable: false });
    expect(handlerRuns).toBe(3);
  });

  it("without ackAfterClaim, maxAttempts=3 still yields 3 handler failures", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts: 3,
      defaultRetryAfterMs: 0,
      clock,
    });

    let handlerRuns = 0;
    const failHandler = async () => {
      handlerRuns++;
      throw new Error("fail");
    };

    for (let i = 1; i <= 2; i++) {
      const o = await engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_b3_inline",
        payloadHash: "h",
        handler: failHandler,
      });
      expect(o).toEqual({ outcome: "scheduled_for_retry" });
    }
    const third = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b3_inline",
      payloadHash: "h",
      handler: failHandler,
    });
    expect(third).toEqual({ outcome: "handler_failed", retryable: false });
    expect(handlerRuns).toBe(3);
    expect((await store.get("stripe:evt_b3_inline"))?.status).toBe("dead_letter");
  });
});

describe("B4: claim respects availableAt (true backoff)", () => {
  it("fail(retryAfterMs large) then immediate claim(key) → not_available", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });

    const acquired = await store.claim({
      key: "stripe:evt_b4",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") return;

    await store.fail({
      key: "stripe:evt_b4",
      leaseToken: acquired.leaseToken,
      error: "temporary",
      retryAfterMs: 60_000,
    });

    const rec = await store.get("stripe:evt_b4");
    expect(rec?.status).toBe("pending");
    expect(rec?.attempts).toBe(1);

    const early = await store.claim({
      key: "stripe:evt_b4",
      payloadHash: "h",
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(early.kind).toBe("not_available");
    if (early.kind === "not_available") {
      expect(early.availableAt).toBe(rec!.availableAt);
    }
    // Attempts must not increment during backoff.
    expect((await store.get("stripe:evt_b4"))?.attempts).toBe(1);

    const listedEarly = await store.listRetryable({ limit: 10 });
    expect(listedEarly).toHaveLength(0);

    clock.advance(60_000);

    const listedDue = await store.listRetryable({ limit: 10 });
    expect(listedDue).toHaveLength(1);

    const late = await store.claim({
      key: "stripe:evt_b4",
      payloadHash: "h",
      owner: "w3",
      leaseMs: 30_000,
    });
    expect(late.kind).toBe("acquired");
    if (late.kind === "acquired") {
      expect(late.record.attempts).toBe(2);
    }
  });

  it("processVerified redelivery during backoff → scheduled_for_retry without burning attempts", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 30_000,
      maxAttempts: 3,
      clock,
    });

    let handlerRuns = 0;
    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b4_engine",
      payloadHash: "h",
      handler: async () => {
        handlerRuns++;
        throw new Error("transient");
      },
    });
    expect(first).toEqual({ outcome: "scheduled_for_retry" });
    expect(handlerRuns).toBe(1);
    expect((await store.get("stripe:evt_b4_engine"))?.attempts).toBe(1);

    // Provider redelivery storm during backoff.
    for (let i = 0; i < 5; i++) {
      const o = await engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_b4_engine",
        payloadHash: "h",
        handler: async () => {
          handlerRuns++;
          throw new Error("should not run");
        },
      });
      expect(o).toEqual({ outcome: "scheduled_for_retry" });
    }
    expect(handlerRuns).toBe(1);
    expect((await store.get("stripe:evt_b4_engine"))?.attempts).toBe(1);
    expect((await store.listRetryable({ limit: 10 }))).toHaveLength(0);

    clock.advance(30_000);

    const after = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b4_engine",
      payloadHash: "h",
      handler: async () => {
        handlerRuns++;
      },
    });
    expect(after).toEqual({ outcome: "processed" });
    expect(handlerRuns).toBe(2);
  });
});

describe("N2: NonRetryableHandlerError({ deadLetter: false }) poison risk", () => {
  it("leaves row pending and advertises handler_failed{retryable:false} (documented footgun)", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts: 5,
      defaultRetryAfterMs: 0,
      clock,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2",
      payloadHash: "h",
      handler: async () => {
        throw new NonRetryableHandlerError("poison", { deadLetter: false });
      },
    });

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: false });
    const rec = await store.get("stripe:evt_n2");
    // Not dead_lettered immediately — residual poison risk until maxAttempts.
    expect(rec?.status).toBe("pending");
    expect(rec?.attempts).toBe(1);
  });

  it("durable_retry still dead-letters after maxAttempts even with deadLetter:false", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts: 2,
      defaultRetryAfterMs: 0,
      clock,
    });

    let runs = 0;
    const poison = async () => {
      runs++;
      throw new NonRetryableHandlerError("poison", { deadLetter: false });
    };

    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_cap",
      payloadHash: "h",
      handler: poison,
    });
    expect(first).toEqual({ outcome: "handler_failed", retryable: false });
    expect((await store.get("stripe:evt_n2_cap"))?.status).toBe("pending");

    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_cap",
      payloadHash: "h",
      handler: poison,
    });
    expect(second).toEqual({ outcome: "handler_failed", retryable: false });
    expect(runs).toBe(2);
    expect((await store.get("stripe:evt_n2_cap"))?.status).toBe("dead_letter");
  });

  it("default NonRetryableHandlerError dead-letters immediately (preferred)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "durable_retry" });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_default",
      payloadHash: "h",
      handler: async () => {
        throw new NonRetryableHandlerError("poison");
      },
    });
    expect(outcome).toEqual({ outcome: "handler_failed", retryable: false });
    expect((await store.get("stripe:evt_n2_default"))?.status).toBe("dead_letter");
  });
});
