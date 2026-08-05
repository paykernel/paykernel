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


describe("processRetryable default envelope unwrap", () => {
  const paymentEvent = {
    schemaVersion: "1",
    type: "payment.succeeded",
    provider: {
      gateway: "stripe",
      eventId: "evt_n2_env",
      eventType: "payment_intent.succeeded",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:00:00.000Z",
    },
    payment: {
      status: "succeeded",
      references: { providerPaymentId: "pi_1" },
    },
  };

  it("unwraps PersistedPaymentEventEnvelope so handler receives .event", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      clock,
    });

    const envelope = {
      schemaVersion: "1",
      event: paymentEvent,
      payloadHash: "hash_n2_env",
      storedAt: "2026-01-01T00:00:00.000Z",
    };

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_env",
      payloadHash: "hash_n2_env",
      envelope,
    });

    let seen: unknown;
    const result = await engine.processRetryable({
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    // Auto-unwrap: handler must see PaymentEvent, not the envelope wrapper.
    expect(seen).toEqual(paymentEvent);
    expect(seen).not.toHaveProperty("payloadHash");
    expect(seen).not.toHaveProperty("storedAt");
    expect((seen as { type?: string }).type).toBe("payment.succeeded");
  });

  it("passes plain PaymentEvent payloadRef through without wrap/unwrap", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      clock,
    });

    // Plain PaymentEvent shape (schemaVersion + type + provider; no top-level event+payloadHash).
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_plain",
      payloadHash: "hash_n2_plain",
      envelope: paymentEvent,
    });

    let seen: unknown;
    const result = await engine.processRetryable({
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    expect(seen).toEqual(paymentEvent);
    expect((seen as { type?: string }).type).toBe("payment.succeeded");
  });

  it("resolveEvent override still wins over default unwrap", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      clock,
    });

    const envelope = {
      schemaVersion: "1",
      event: paymentEvent,
      payloadHash: "hash_n2_override",
      storedAt: "2026-01-01T00:00:00.000Z",
    };

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_override",
      payloadHash: "hash_n2_override",
      envelope,
    });

    const custom = { custom: true, id: "resolved" };
    let seen: unknown;
    const result = await engine.processRetryable({
      resolveEvent: (rec) => ({
        gateway: "stripe",
        providerEventId: "evt_n2_override",
        payloadHash: rec.payloadHash,
        event: custom,
      }),
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    expect(seen).toEqual(custom);
  });

  it("opaque non-JSON payloadRef is passed through as event", async () => {
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
      providerEventId: "evt_n2_opaque",
      payloadHash: "hash_n2_opaque",
      // string envelope stored as-is (not JSON object)
      envelope: "opaque-ref-token",
    });

    let seen: unknown;
    const result = await engine.processRetryable({
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    expect(seen).toBe("opaque-ref-token");
  });
});

describe("leaseMs / defaultLeaseMs validation", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY] as const)(
    "defaultLeaseMs=%s throws at construction",
    (defaultLeaseMs) => {
      const store = createMemoryWebhookInboxStore();
      expect(() =>
        createWebhookInboxEngine({
          store,
          mode: "inline",
          defaultLeaseMs,
        }),
      ).toThrow(/defaultLeaseMs/);
    },
  );

  it("per-call leaseMs <= 0 throws on processVerified before claim", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    await expect(
      engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_bad_lease",
        payloadHash: "h",
        leaseMs: 0,
        handler: async () => {},
      }),
    ).rejects.toThrow(/leaseMs/);
    expect(store.size).toBe(0);
  });

  it("default and explicit positive lease accepted", () => {
    const store = createMemoryWebhookInboxStore();
    expect(() =>
      createWebhookInboxEngine({ store, mode: "inline" }),
    ).not.toThrow();
    expect(() =>
      createWebhookInboxEngine({
        store,
        mode: "inline",
        defaultLeaseMs: 30_000,
      }),
    ).not.toThrow();
  });
});

