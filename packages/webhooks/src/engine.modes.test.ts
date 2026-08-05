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
      event: { id: "evt_durable_fail", type: "payment.succeeded" },
      handler: async () => {
        throw new Error("temporary outage");
      },
    });

    expect(outcome).toEqual({
      outcome: "scheduled_for_retry",
      reason: "handler_retry",
    });
    const rec = await store.get("stripe:evt_durable_fail");
    expect(rec?.status).toBe("pending");
    expect(rec?.lastError).toContain("temporary outage");
    expect(rec?.payloadRef).toContain("payment.succeeded");
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

    expect(outcome).toEqual({
      outcome: "scheduled_for_retry",
      reason: "parked",
    });
    expect(handlerRuns).toBe(0);
    const rec = await store.get("stripe:evt_ack");
    expect(rec?.status).toBe("pending");
    expect(rec?.payloadRef).toContain("payment.succeeded");
    // Parking claim is free vs maxAttempts handler budget.
    expect(rec?.attempts).toBe(0);
  });

  it("ackAfterClaim without envelope refuses before claim (invalid_webhook)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_no_env",
      payloadHash: "h",
    });

    expect(outcome.outcome).toBe("invalid_webhook");
    if (outcome.outcome === "invalid_webhook") {
      // WEBHOOKS-1: durable_retry refuses claim without materializable payload
      // (covers ackAfterClaim park and inline durable handler paths).
      expect(outcome.reason).toMatch(
        /envelope or event is required for durable_retry|envelope is required for ackAfterClaim/i,
      );
    }
    expect(store.size).toBe(0);
  });

  it("ackAfterClaim parks using redacted event when envelope omitted", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_from_event",
      payloadHash: "h",
      event: {
        id: "evt_ack_from_event",
        type: "payment.succeeded",
        secret_token: "tok",
      },
    });

    expect(outcome).toEqual({
      outcome: "scheduled_for_retry",
      reason: "parked",
    });
    const rec = await store.get("stripe:evt_ack_from_event");
    expect(rec?.status).toBe("pending");
    expect(rec?.payloadRef).toContain("payment.succeeded");
    expect(rec?.payloadRef).not.toContain('"tok"');
  });

  it("ackAfterClaim with empty-string envelope refuses before claim", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_empty",
      payloadHash: "h",
      envelope: "",
    });

    expect(outcome.outcome).toBe("invalid_webhook");
    expect(store.size).toBe(0);
  });

  it("ackAfterClaim redacts secret keys in object envelope payloadRef", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_redact",
      payloadHash: "h",
      envelope: {
        type: "payment.succeeded",
        secret_token: "super-secret-token",
        signature: "sig-value",
        id: "evt_ack_redact",
      },
    });

    expect(outcome).toEqual({
      outcome: "scheduled_for_retry",
      reason: "parked",
    });
    const rec = await store.get("stripe:evt_ack_redact");
    expect(rec?.payloadRef).toBeDefined();
    expect(rec?.payloadRef).not.toContain("super-secret-token");
    expect(rec?.payloadRef).not.toContain("sig-value");
    expect(rec?.payloadRef).toContain("[REDACTED]");
    expect(rec?.payloadRef).toContain("evt_ack_redact");
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

    // durable_retry with event → payloadRef snapshot → handler_retry on throw
    const o2 = await durable.processVerified({
      gateway: "g",
      providerEventId: "m2",
      payloadHash: "h2",
      event: { id: "m2", type: "payment.succeeded" },
      handler: async () => {
        throw new Error("x");
      },
    });
    expect(o2).toEqual({
      outcome: "scheduled_for_retry",
      reason: "handler_retry",
    });
    const rec = await store.get("g:m2");
    expect(rec?.payloadRef).toContain("payment.succeeded");
  });

  it("durable_retry without envelope/event refuses claim (WEBHOOKS-1 no permanent block)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_no_payload",
      payloadHash: "h",
      // no envelope, no event → no payloadRef — refuse before claim so provider
      // redelivery of paid events is not permanent-blocked by dead_letter.
      handler: async () => {
        throw new Error("transient");
      },
    });

    expect(outcome.outcome).toBe("invalid_webhook");
    if (outcome.outcome === "invalid_webhook") {
      expect(outcome.reason).toMatch(/payloadRef|envelope or event/i);
    }
    // No claim row — redelivery can retry with a materializable payload.
    expect(await store.get("stripe:evt_no_payload")).toBeUndefined();
  });

  it("processRetryable dead-letters rows with missing payloadRef (never stubs event)", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    // Seed a legacy pending row without payloadRef (simulates pre-fix durable fail).
    const claim = await store.claim({
      key: "stripe:evt_legacy_stub",
      payloadHash: "h_legacy",
      owner: "seed",
      leaseMs: 30_000,
    });
    if (claim.kind !== "acquired") throw new Error("expected acquired");
    await store.fail({
      key: "stripe:evt_legacy_stub",
      leaseToken: claim.leaseToken,
      error: "prior fail",
      retryAfterMs: 0,
    });

    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
    });

    let handlerRuns = 0;
    let seenEvent: unknown;
    const result = await engine.processRetryable({
      handler: async (ctx) => {
        handlerRuns++;
        seenEvent = ctx.event;
      },
    });

    expect(handlerRuns).toBe(0);
    expect(seenEvent).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({
      outcome: "handler_failed",
      retryable: false,
    });
    const rec = await store.get("stripe:evt_legacy_stub");
    expect(rec?.status).toBe("dead_letter");
    expect(rec?.lastError).toMatch(/missing payloadRef/i);
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

  it("JSON-string envelope is redacted before payloadRef store", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_json_str",
      payloadHash: "h",
      envelope: JSON.stringify({
        id: "evt_json_str",
        secret_token: "leak-me-please",
        type: "payment.succeeded",
      }),
    });

    expect(outcome).toEqual({
      outcome: "scheduled_for_retry",
      reason: "parked",
    });
    const rec = await store.get("stripe:evt_json_str");
    expect(rec?.payloadRef).toBeDefined();
    expect(rec?.payloadRef).not.toContain("leak-me-please");
    expect(rec?.payloadRef).toContain("[REDACTED]");
    expect(rec?.payloadRef).toContain("evt_json_str");
  });

  it("durable_retry snapshots redacted event into payloadRef when envelope omitted", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
      clock,
    });

    const event = {
      id: "evt_from_event",
      type: "payment.succeeded",
      secret_token: "should-redact",
      amount: 1000,
    };

    const failOnce = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_from_event",
      payloadHash: "h_evt",
      event,
      handler: async () => {
        throw new Error("transient");
      },
    });
    expect(failOnce).toEqual({
      outcome: "scheduled_for_retry",
      reason: "handler_retry",
    });

    const pending = await store.get("stripe:evt_from_event");
    expect(pending?.payloadRef).toBeDefined();
    expect(pending?.payloadRef).not.toContain("should-redact");
    expect(pending?.payloadRef).toContain("[REDACTED]");

    let seen: unknown;
    const result = await engine.processRetryable({
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });
    expect(result.items[0]?.outcome).toEqual({ outcome: "processed" });
    expect(seen).toMatchObject({
      id: "evt_from_event",
      type: "payment.succeeded",
      amount: 1000,
    });
    expect((seen as { secret_token?: string }).secret_token).toBe("[REDACTED]");
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

describe("maxAttempts / defaultRetryAfterMs validation", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY] as const)(
    "maxAttempts=%s throws at construction",
    (maxAttempts) => {
      const store = createMemoryWebhookInboxStore();
      expect(() =>
        createWebhookInboxEngine({
          store,
          mode: "durable_retry",
          maxAttempts,
        }),
      ).toThrow(/maxAttempts/);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY] as const)(
    "defaultRetryAfterMs=%s throws at construction",
    (defaultRetryAfterMs) => {
      const store = createMemoryWebhookInboxStore();
      expect(() =>
        createWebhookInboxEngine({
          store,
          mode: "durable_retry",
          defaultRetryAfterMs,
        }),
      ).toThrow(/defaultRetryAfterMs/);
    },
  );

  it("accepts maxAttempts>=1 integer and defaultRetryAfterMs>=0", () => {
    const store = createMemoryWebhookInboxStore();
    expect(() =>
      createWebhookInboxEngine({
        store,
        mode: "durable_retry",
        maxAttempts: 1,
        defaultRetryAfterMs: 0,
      }),
    ).not.toThrow();
    expect(() =>
      createWebhookInboxEngine({
        store,
        mode: "durable_retry",
        maxAttempts: 10,
        defaultRetryAfterMs: 5_000,
      }),
    ).not.toThrow();
  });
});

