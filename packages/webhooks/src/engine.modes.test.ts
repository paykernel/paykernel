/**
 * A6 + mode explicitness: inline vs durable_retry never mixed implicitly.
 */
import { describe, it, expect } from "bun:test";
import { createWebhookInboxEngine } from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { StoreLeaseLostError, type WebhookInboxStore } from "./store";
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

    expect(outcome).toMatchObject({
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
      workerGuaranteed: true,
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

    expect(outcome).toMatchObject({
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

  it("ackAfterClaim without envelope refuses before claim (retryable, not invalid_webhook)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_no_env",
      payloadHash: "h",
    });

    // WEBHOOKS-2: missing durable snapshot is not forgery / 400.
    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("ackAfterClaim parks using redacted event when envelope omitted", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
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

    expect(outcome).toMatchObject({
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
      workerGuaranteed: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack_empty",
      payloadHash: "h",
      envelope: "",
    });

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("ackAfterClaim redacts secret keys in object envelope payloadRef", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
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

    expect(outcome).toMatchObject({
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

  it("P610-ACK-2: park lease_lost does not return parked", async () => {
    const store = createMemoryWebhookInboxStore();
    const wrapped: WebhookInboxStore = {
      claim: store.claim.bind(store),
      renew: store.renew.bind(store),
      complete: store.complete.bind(store),
      fail: async () => {
        throw new StoreLeaseLostError("ackAfterClaim park lease_lost");
      },
      get: store.get.bind(store),
      listRetryable: store.listRetryable.bind(store),
      deleteExpired: store.deleteExpired.bind(store),
    };
    const engine = createWebhookInboxEngine({
      store: wrapped,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ack2_park",
      payloadHash: "h",
      envelope: { id: "evt_ack2_park", type: "payment.succeeded" },
    });

    expect(outcome.outcome).not.toBe("scheduled_for_retry");
    expect(
      outcome.outcome === "already_processing" ||
        (outcome.outcome === "handler_failed" &&
          "retryable" in outcome &&
          outcome.retryable === true),
    ).toBe(true);
    // Park fail did not apply — row remains claimed, not pending for workers.
    const rec = await store.get("stripe:evt_ack2_park");
    expect(rec?.status).toBe("claimed");
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

  it("I6: engine ackAfterClaim without workerGuaranteed throws at construction", () => {
    const store = createMemoryWebhookInboxStore();
    expect(() =>
      createWebhookInboxEngine({
        store,
        mode: "durable_retry",
        ackAfterClaim: true,
      }),
    ).toThrow(/workerGuaranteed/);
  });

  it("exposes workerGuaranteed on the returned engine for HTTP adapters", () => {
    const store = createMemoryWebhookInboxStore();
    const omitted = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    expect(omitted.workerGuaranteed).toBe(false);
    const guaranteed = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      workerGuaranteed: true,
    });
    expect(guaranteed.workerGuaranteed).toBe(true);
    expect(guaranteed.mode).toBe("durable_retry");
  });

  it("I6: per-call ackAfterClaim without workerGuaranteed is retryable, not parked", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_i6_no_worker",
      payloadHash: "h",
      envelope: { id: "evt_i6_no_worker", type: "payment.succeeded" },
      ackAfterClaim: true,
    });
    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
    expect(outcome.outcome).not.toBe("scheduled_for_retry");
    expect(store.size).toBe(0);
  });

  it("processRetryable re-drives durable pending rows", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
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

  it("NEW-WEBHOOKS-1: processRetryable does not claim the whole list before the first handler", async () => {
    const clock = createTestClock();
    const inner = createMemoryWebhookInboxStore({ clock });
    const parker = createWebhookInboxEngine({
      store: inner,
      mode: "durable_retry",
      ackAfterClaim: true,
      workerGuaranteed: true,
      clock,
    });
    await parker.processVerified({
      gateway: "stripe",
      providerEventId: "evt_a",
      payloadHash: "ha",
      envelope: { id: "evt_a" },
    });
    await parker.processVerified({
      gateway: "stripe",
      providerEventId: "evt_b",
      payloadHash: "hb",
      envelope: { id: "evt_b" },
    });
    await parker.processVerified({
      gateway: "stripe",
      providerEventId: "evt_c",
      payloadHash: "hc",
      envelope: { id: "evt_c" },
    });

    const claimedKeys: string[] = [];
    let claimsAtFirstHandler = 0;
    let handlerInFlight = 0;
    let claimsDuringHandler = 0;
    const store = {
      ...inner,
      async claim(input: Parameters<typeof inner.claim>[0]) {
        if (handlerInFlight > 0) claimsDuringHandler += 1;
        claimedKeys.push(input.key);
        return inner.claim(input);
      },
    };
    const worker = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
    });
    const result = await worker.processRetryable({
      handler: async () => {
        handlerInFlight += 1;
        if (claimsAtFirstHandler === 0) {
          claimsAtFirstHandler = claimedKeys.length;
        }
        handlerInFlight -= 1;
      },
    });
    expect(result.items).toHaveLength(3);
    expect(claimsAtFirstHandler).toBe(1);
    expect(claimedKeys).toHaveLength(3);
    expect(claimsDuringHandler).toBe(0);
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
    expect(o2).toMatchObject({
      outcome: "scheduled_for_retry",
      reason: "handler_retry",
    });
    const rec = await store.get("g:m2");
    expect(rec?.payloadRef).toContain("payment.succeeded");
  });

  it("durable_retry without envelope/event refuses claim as retryable (WEBHOOKS-2)", async () => {
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

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
    expect(outcome.outcome).not.toBe("invalid_webhook");
    // No claim row — redelivery can retry with a materializable payload.
    expect(await store.get("stripe:evt_no_payload")).toBeUndefined();
  });

  it("processRetryable does not dead-letter rows with missing payloadRef (WEBHOOKS-4)", async () => {
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
      retryable: true,
    });
    const rec = await store.get("stripe:evt_legacy_stub");
    expect(rec?.status).not.toBe("dead_letter");
    expect(rec?.status).toBe("pending");
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
      workerGuaranteed: true,
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
      workerGuaranteed: true,
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
      workerGuaranteed: true,
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
      workerGuaranteed: true,
      clock,
    });

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_n2_opaque",
      payloadHash: "hash_n2_opaque",
      // plain opaque non-JSON envelope (no secret patterns) passes through
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
      workerGuaranteed: true,
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

    expect(outcome).toMatchObject({
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
    expect(failOnce).toMatchObject({
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

describe("I14 processRetryable must not supersede a newer idle hash", () => {
  it("listed stale hash does not overwrite a newer idle payloadHash", async () => {
    const clock = createTestClock();
    const inner = createMemoryWebhookInboxStore({ clock });
    const seed = await inner.claim({
      key: "stripe:evt_i14",
      payloadHash: "hash-a",
      owner: "seed",
      leaseMs: 30_000,
      payloadRef: JSON.stringify({ id: "old" }),
    });
    if (seed.kind !== "acquired") throw new Error("expected acquired");
    await inner.fail({
      key: "stripe:evt_i14",
      leaseToken: seed.leaseToken,
      error: "park old",
      retryAfterMs: 0,
    });

    const claimedHashes: string[] = [];
    const store = {
      ...inner,
      async listRetryable(input: Parameters<typeof inner.listRetryable>[0]) {
        const rows = await inner.listRetryable(input);
        // After list snapshot (hash-a), a newer idle body supersedes to hash-b.
        const newer = await inner.claim({
          key: "stripe:evt_i14",
          payloadHash: "hash-b",
          owner: "newer",
          leaseMs: 30_000,
          payloadRef: JSON.stringify({ id: "new" }),
        });
        if (newer.kind === "acquired") {
          await inner.fail({
            key: "stripe:evt_i14",
            leaseToken: newer.leaseToken,
            error: "park newer",
            retryAfterMs: 0,
            restoreAttempt: true,
          });
        }
        return rows;
      },
      async claim(input: Parameters<typeof inner.claim>[0]) {
        claimedHashes.push(input.payloadHash);
        return inner.claim(input);
      },
    };

    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
    });
    let runs = 0;
    const result = await engine.processRetryable({
      handler: async () => {
        runs++;
      },
    });

    expect(claimedHashes).not.toContain("hash-a");
    expect(runs).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({
      outcome: "handler_failed",
      retryable: true,
    });
    const rec = await inner.get("stripe:evt_i14");
    expect(rec?.payloadHash).toBe("hash-b");
    expect(rec?.status).toBe("pending");
  });
});

describe("S19 processRetryable get→claim must not supersede a newer idle hash", () => {
  it("listed hash-a + idle hash-b at claim time does not rewrite to hash-a", async () => {
    const clock = createTestClock();
    const inner = createMemoryWebhookInboxStore({ clock });
    const seed = await inner.claim({
      key: "stripe:evt_s19",
      payloadHash: "hash-a",
      owner: "seed",
      leaseMs: 30_000,
      payloadRef: JSON.stringify({ id: "old" }),
    });
    if (seed.kind !== "acquired") throw new Error("expected acquired");
    await inner.fail({
      key: "stripe:evt_s19",
      leaseToken: seed.leaseToken,
      error: "park old",
      retryAfterMs: 0,
    });

    const claimedHashes: string[] = [];
    const store = {
      ...inner,
      async claim(input: Parameters<typeof inner.claim>[0]) {
        // After get (hash-a), idle supersede to hash-b before this claim.
        const newer = await inner.claim({
          key: "stripe:evt_s19",
          payloadHash: "hash-b",
          owner: "newer",
          leaseMs: 30_000,
          payloadRef: JSON.stringify({ id: "new" }),
        });
        if (newer.kind === "acquired") {
          await inner.fail({
            key: "stripe:evt_s19",
            leaseToken: newer.leaseToken,
            error: "park newer",
            retryAfterMs: 0,
            restoreAttempt: true,
          });
        }
        claimedHashes.push(input.payloadHash);
        return inner.claim(input);
      },
    };

    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      clock,
    });
    let runs = 0;
    const result = await engine.processRetryable({
      handler: async () => {
        runs++;
      },
    });

    expect(runs).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.outcome).toEqual({
      outcome: "handler_failed",
      retryable: true,
    });
    const rec = await inner.get("stripe:evt_s19");
    expect(rec?.payloadHash).toBe("hash-b");
    expect(rec?.payloadRef).toBe(JSON.stringify({ id: "new" }));
    expect(rec?.status).toBe("pending");
    expect(claimedHashes).toContain("hash-a");
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

