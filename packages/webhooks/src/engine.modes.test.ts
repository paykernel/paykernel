/**
 * A6 + mode explicitness: inline vs durable_retry never mixed implicitly.
 */
import { describe, it, expect } from "bun:test";
import { createWebhookInboxEngine } from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { createTestClock } from "./test-clock";
import { NonRetryableHandlerError } from "./types";

describe("modes: inline vs durable_retry (A6)", () => {
  it("mode is fixed on engine and readable", () => {
    const store = createMemoryWebhookInboxStore();
    const inline = createWebhookInboxEngine({ store, mode: "inline" });
    const durable = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    expect(inline.mode).toBe("inline");
    expect(durable.mode).toBe("durable_retry");
  });

  it("A6 inline: handler throw → handler_failed retryable true", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_inline_fail",
      payloadHash: "hash1",
      handler: async () => {
        throw new Error("temporary outage");
      },
    });

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
    const rec = await store.get("stripe:evt_inline_fail");
    expect(rec?.status).toBe("pending");
  });

  it("A6 durable_retry: handler throw → scheduled_for_retry", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
      defaultRetryAfterMs: 1000,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_durable_fail",
      payloadHash: "hash1",
      handler: async () => {
        throw new Error("temporary outage");
      },
    });

    expect(outcome).toEqual({ outcome: "scheduled_for_retry" });
    const rec = await store.get("stripe:evt_durable_fail");
    expect(rec?.status).toBe("pending");
    expect(rec?.lastError).toContain("temporary outage");
  });

  it("inline non-retryable → handler_failed retryable false + dead_letter", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_dead",
      payloadHash: "h",
      handler: async () => {
        throw new NonRetryableHandlerError("poison message");
      },
    });

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: false });
    const rec = await store.get("stripe:evt_dead");
    expect(rec?.status).toBe("dead_letter");
  });

  it("durable_retry + ackAfterClaim returns scheduled_for_retry without running handler", async () => {
    const store = createMemoryWebhookInboxStore();
    let handlerRuns = 0;
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack",
      payloadHash: "h",
      envelope: { type: "payment.succeeded", schemaVersion: "1" },
      handler: async () => {
        handlerRuns++;
      },
    });

    expect(outcome).toEqual({ outcome: "scheduled_for_retry" });
    expect(handlerRuns).toBe(0);
    const rec = await store.get("stripe:evt_ack");
    expect(rec?.status).toBe("pending");
    expect(rec?.payloadRef).toContain("payment.succeeded");
    // Parking claim is free vs maxAttempts handler budget.
    expect(rec?.attempts).toBe(0);
  });

  it("ackAfterClaim with mode inline throws at construction", () => {
    const store = createMemoryWebhookInboxStore();
    expect(() =>
      createWebhookInboxEngine({
        store,
        mode: "inline",
        ackAfterClaim: true,
      }),
    ).toThrow(/ackAfterClaim/);
  });

  it("processRetryable re-drives durable pending rows", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      clock,
    });

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_worker",
      payloadHash: "h",
      envelope: { id: "evt_worker" },
    });

    let runs = 0;
    const result = await engine.processRetryable({
      handler: async () => {
        runs++;
      },
    });

    expect(runs).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    const rec = await store.get("stripe:evt_worker");
    expect(rec?.status).toBe("completed");
  });

  it("processRetryable throws on inline engines (no mode mix)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    await expect(
      engine.processRetryable({
        handler: async () => {
          throw new Error("must not run");
        },
      }),
    ).rejects.toThrow(/durable_retry/);
  });

  it("does not silently mix modes: same store, different engines keep their mode", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const inline = createWebhookInboxEngine({ store, mode: "inline", clock });
    const durable = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
    });

    const o1 = await inline.processVerified({
      gateway: "g",
      providerEventId: "m1",
      payloadHash: "h1",
      handler: async () => {
        throw new Error("x");
      },
    });
    expect(o1.outcome).toBe("handler_failed");

    const o2 = await durable.processVerified({
      gateway: "g",
      providerEventId: "m2",
      payloadHash: "h2",
      handler: async () => {
        throw new Error("x");
      },
    });
    expect(o2.outcome).toBe("scheduled_for_retry");
  });
});
