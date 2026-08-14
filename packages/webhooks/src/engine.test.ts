/**
 * Engine behavioral tests: A2–A5, invalid_webhook, renew, sanitize, no silent ACK.
 * Crash boundaries (10.6) live in engine.crash.test.ts.
 */
import { describe, it, expect } from "bun:test";
import { hashWebhookPayload } from "@paykernel/core";
import {
  computePayloadHash,
  createWebhookInboxEngine,
  resolveInboxPayloadHash,
} from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { isStoreLeaseLostError } from "./store";
import { createTestClock } from "./test-clock";
import { NonRetryableHandlerError } from "./types";

describe("processVerified happy path", () => {
  it("handler success → processed; store status completed", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({ store, mode: "inline", clock });
    let seenEvent: unknown;
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_ok",
      payloadHash: "abc",
      event: { type: "payment.succeeded" },
      handler: async (ctx) => {
        seenEvent = ctx.event;
        expect(ctx.key).toBe("stripe:evt_ok");
        expect(ctx.mode).toBe("inline");
        expect(ctx.gateway).toBe("stripe");
        expect(ctx.providerEventId).toBe("evt_ok");
      },
    });
    expect(outcome).toEqual({ outcome: "processed" });
    expect(seenEvent).toEqual({ type: "payment.succeeded" });
    const rec = await store.get("stripe:evt_ok");
    expect(rec?.status).toBe("completed");
  });

  it("computePayloadHash matches core hashWebhookPayload", () => {
    const body = { id: "1", amount: 10 };
    expect(computePayloadHash(body)).toBe(hashWebhookPayload(body));
  });
});

describe("WEBHOOKS-2 payloadHash source honesty", () => {
  it("raw body string hash differs from object hash (not interchangeable)", () => {
    const obj = { id: "evt_1", type: "payment_intent.succeeded" };
    const rawBody = JSON.stringify(obj);
    expect(hashWebhookPayload(rawBody)).not.toBe(hashWebhookPayload(obj));
    expect(computePayloadHash(rawBody)).not.toBe(computePayloadHash(obj));
  });

  it("resolveInboxPayloadHash prefers event.payloadHash over re-hash", () => {
    const obj = { id: "evt_1" };
    const objectHash = hashWebhookPayload(obj);
    const stringHash = hashWebhookPayload(JSON.stringify(obj));
    expect(stringHash).not.toBe(objectHash);

    expect(
      resolveInboxPayloadHash({
        eventPayloadHash: objectHash,
        payloadForHash: JSON.stringify(obj),
      }),
    ).toBe(objectHash);

    expect(
      resolveInboxPayloadHash({
        payloadForHash: obj,
      }),
    ).toBe(objectHash);
  });

  it("resolveInboxPayloadHash trims eventPayloadHash and refuses empty", () => {
    expect(
      resolveInboxPayloadHash({
        eventPayloadHash: "  abc  ",
      }),
    ).toBe("abc");
    expect(() => resolveInboxPayloadHash({})).toThrow(/eventPayloadHash|payloadForHash/);
    expect(() =>
      resolveInboxPayloadHash({ eventPayloadHash: "   " }),
    ).toThrow(/eventPayloadHash|payloadForHash/);
  });

  it("mixing string vs object hash on idle pending row → supersede + process (WEBHOOKS-3)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });
    const obj = { id: "evt_mix", type: "payment.succeeded" };
    const objectHash = hashWebhookPayload(obj);
    const stringHash = hashWebhookPayload(JSON.stringify(obj));

    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_mix",
      payloadHash: objectHash,
      event: obj,
      handler: async () => {
        throw new Error("leave pending");
      },
    });
    expect(first.outcome).toBe("scheduled_for_retry");

    // Idle non-terminal + corrected hash source: supersede, do not stick forever.
    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_mix",
      payloadHash: stringHash,
      event: obj,
      handler: async () => {},
    });
    expect(second).toEqual({ outcome: "processed" });
    const rec = await store.get("stripe:evt_mix");
    expect(rec?.status).toBe("completed");
    expect(rec?.payloadHash).toBe(stringHash);
  });
});

describe("WEBHOOKS-4 terminal before payload_hash_conflict", () => {
  it("completed row redelivered with different hash → duplicate_completed", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    let runs = 0;

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_term_hash",
      payloadHash: "hash-a",
      handler: async () => {
        runs++;
      },
    });
    expect(runs).toBe(1);
    expect((await store.get("stripe:evt_term_hash"))?.status).toBe("completed");

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_term_hash",
      payloadHash: "hash-b",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(1);
  });

  it("dead_letter row redelivered with different hash → handler_failed non-retryable", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts: 1,
      defaultRetryAfterMs: 0,
    });

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_dl_hash",
      payloadHash: "hash-a",
      event: { id: "evt_dl_hash" },
      handler: async () => {
        throw new Error("poison");
      },
    });
    expect((await store.get("stripe:evt_dl_hash"))?.status).toBe("dead_letter");

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_dl_hash",
      payloadHash: "hash-b",
      event: { id: "evt_dl_hash" },
      handler: async () => {
        throw new Error("should not run");
      },
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: false });
  });
});

describe("WEBHOOKS-2 processVerified envelope materialization", () => {
  it("envelope-only durable_retry inline path materializes ctx.event from envelope", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });
    const paymentEvent = {
      schemaVersion: "1",
      type: "payment.succeeded",
      provider: {
        gateway: "stripe",
        eventId: "evt_env_only",
        eventType: "payment_intent.succeeded",
        occurredAt: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const envelope = {
      schemaVersion: "1",
      event: paymentEvent,
      payloadHash: "hash_env_only",
      storedAt: "2026-01-01T00:00:00.000Z",
    };

    let seen: unknown;
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_env_only",
      payloadHash: "hash_env_only",
      // no event — only envelope (dual-write persistence shape)
      envelope,
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });

    expect(outcome).toEqual({ outcome: "processed" });
    expect(seen).toEqual(paymentEvent);
    expect(seen).not.toBeUndefined();
  });

  it("plain object envelope becomes handler event when event omitted", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    const plain = { id: "evt_plain_env", type: "payment.succeeded" };
    let seen: unknown;
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_plain_env",
      payloadHash: "h",
      envelope: plain,
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });
    expect(outcome).toEqual({ outcome: "processed" });
    expect(seen).toEqual(plain);
  });
});

describe("WEBHOOKS-3 fail lease_lost preserves non-retryable intent", () => {
  it("NonRetryableHandlerError after lease expiry → handler_failed non-retryable + dead_letter", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultLeaseMs: 1_000,
      clock,
      defaultRetryAfterMs: 0,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_lease_lost_dl",
      payloadHash: "h",
      event: { id: "evt_lease_lost_dl" },
      handler: async () => {
        // Expire lease before handler returns; fail accepts matching token (WEBHOOKS-2)
        clock.advance(2_000);
        throw new NonRetryableHandlerError("poison forever");
      },
    });

    expect(outcome).toEqual({ outcome: "handler_failed", retryable: false });
    const rec = await store.get("stripe:evt_lease_lost_dl");
    // fail with expired matching token → dead_letter (or best-effort reclaim).
    expect(rec?.status).toBe("dead_letter");
  });
});

describe("WEBHOOKS-2 lease-timeout maxAttempts", () => {
  it("handler throw after lease expiry records attempt and eventually hits maxAttempts", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const maxAttempts = 3;
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts,
      defaultLeaseMs: 1_000,
      defaultRetryAfterMs: 0,
      clock,
    });

    let runs = 0;
    for (let i = 1; i <= maxAttempts; i++) {
      const o = await engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_lease_timeout_budget",
        payloadHash: "h",
        event: { id: "evt_lease_timeout_budget" },
        handler: async () => {
          runs++;
          // Simulate hang past lease then fail — must count toward maxAttempts.
          clock.advance(2_000);
          throw new Error(`timeout fail #${i}`);
        },
      });
      if (i < maxAttempts) {
        expect(o).toMatchObject({
          outcome: "scheduled_for_retry",
          reason: "handler_retry",
        });
        const rec = await store.get("stripe:evt_lease_timeout_budget");
        expect(rec?.status).toBe("pending");
        expect(rec?.attempts).toBe(i);
      } else {
        expect(o).toEqual({ outcome: "handler_failed", retryable: false });
        const rec = await store.get("stripe:evt_lease_timeout_budget");
        expect(rec?.status).toBe("dead_letter");
        expect(rec?.attempts).toBe(maxAttempts);
      }
    }
    expect(runs).toBe(maxAttempts);
  });

  it("renew lease_lost after expiry still records fail toward maxAttempts", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const maxAttempts = 2;
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      maxAttempts,
      defaultLeaseMs: 1_000,
      defaultRetryAfterMs: 0,
      clock,
    });

    let runs = 0;
    for (let i = 1; i <= maxAttempts; i++) {
      const o = await engine.processVerified({
        gateway: "stripe",
        providerEventId: "evt_renew_timeout_budget",
        payloadHash: "h",
        event: { id: "evt_renew_timeout_budget" },
        handler: async (ctx) => {
          runs++;
          clock.advance(2_000);
          await ctx.renew(10_000);
        },
      });
      if (i < maxAttempts) {
        expect(o).toMatchObject({
          outcome: "scheduled_for_retry",
          reason: "handler_retry",
        });
      } else {
        expect(o).toEqual({ outcome: "handler_failed", retryable: false });
        expect((await store.get("stripe:evt_renew_timeout_budget"))?.status).toBe(
          "dead_letter",
        );
      }
    }
    expect(runs).toBe(maxAttempts);
  });
});

describe("WEBHOOKS-5 scheduled_for_retry exposes timing", () => {
  it("not_available includes availableAt and retryAfterMs", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 60_000,
      clock,
    });

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_timing",
      payloadHash: "h",
      event: { id: "evt_timing" },
      handler: async () => {
        throw new Error("transient");
      },
    });

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_timing",
      payloadHash: "h",
      event: { id: "evt_timing" },
      handler: async () => {
        throw new Error("should not run");
      },
    });

    expect(o.outcome).toBe("scheduled_for_retry");
    if (o.outcome === "scheduled_for_retry") {
      expect(o.reason).toBe("not_available");
      expect(typeof o.availableAt).toBe("string");
      expect(o.retryAfterMs).toBeGreaterThan(0);
      expect(o.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });
});

describe("WEBHOOKS-6 opaque string envelope redaction", () => {
  it("redacts known secret patterns in opaque non-JSON envelope payloadRef", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_opaque_secret",
      payloadHash: "h",
      envelope: "Bearer sk_live_supersecrettoken123 and more",
    });

    const rec = await store.get("stripe:evt_opaque_secret");
    expect(rec?.payloadRef).toBeDefined();
    expect(rec?.payloadRef).not.toContain("sk_live_supersecrettoken123");
    expect(rec?.payloadRef).toContain("[REDACTED]");
  });
});

describe("invalid_webhook", () => {
  it("missing handler does not claim (no store row)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_no_handler",
      payloadHash: "h",
    });
    expect(o.outcome).toBe("invalid_webhook");
    expect(store.size).toBe(0);
  });

  it("empty gateway → invalid_webhook", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processVerified({
      gateway: "",
      providerEventId: "e",
      payloadHash: "h",
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
    if (o.outcome === "invalid_webhook") {
      expect(o.reason).toMatch(/gateway/i);
    }
  });

  it("empty providerEventId → invalid_webhook", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "  ",
      payloadHash: "h",
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
  });

  it("empty payloadHash → invalid_webhook", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "e",
      payloadHash: "",
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
  });
});

describe("A2 completed events do not re-run handler", () => {
  it("second process → duplicate_completed, handler not called", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    let runs = 0;
    const handler = async () => {
      runs++;
    };

    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_done",
      payloadHash: "h",
      handler,
    });
    expect(first).toEqual({ outcome: "processed" });
    expect(runs).toBe(1);

    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_done",
      payloadHash: "h",
      handler,
    });
    expect(second).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(1);
  });
});

describe("A3 expired lease reclaim re-runs handler", () => {
  it("after lease expiry, reclaim runs handler again", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    let runs = 0;
    // Claim but abandon: use low-level store claim to hold lease without complete
    await store.claim({
      key: "stripe:evt_reclaim",
      payloadHash: "h",
      owner: "old",
      leaseMs: 1000,
    });

    clock.advance(2000);

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_reclaim",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(outcome).toEqual({ outcome: "processed" });
    expect(runs).toBe(1);
  });
});

describe("A4 stale worker completion rejected", () => {
  it("stale leaseToken cannot complete after reclaim", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    const first = await store.claim({
      key: "stripe:evt_stale",
      payloadHash: "h",
      owner: "w1",
      leaseMs: 1000,
    });
    if (first.kind !== "acquired") throw new Error("expected acquired");
    const staleToken = first.leaseToken;

    clock.advance(2000);

    // Reclaim via engine
    let newToken: string | undefined;
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_stale",
      payloadHash: "h",
      handler: async (ctx) => {
        newToken = ctx.leaseToken;
      },
    });
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(staleToken);

    // Stale complete must fail
    try {
      await store.complete({
        key: "stripe:evt_stale",
        leaseToken: staleToken,
      });
      throw new Error("should throw");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
    }

    // Row is completed by successful engine path
    const rec = await store.get("stripe:evt_stale");
    expect(rec?.status).toBe("completed");
  });

  it("A4 mid-reclaim fencing: stale complete while new lease is active fails before new worker completes", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });

    const first = await store.claim({
      key: "stripe:evt_mid_reclaim",
      payloadHash: "h",
      owner: "w1",
      leaseMs: 1000,
    });
    if (first.kind !== "acquired") throw new Error("expected acquired");
    const staleToken = first.leaseToken;

    clock.advance(2000);

    // Second worker reclaims (store-level) and holds the lease without completing.
    const reclaim = await store.claim({
      key: "stripe:evt_mid_reclaim",
      payloadHash: "h",
      owner: "w2",
      leaseMs: 5000,
    });
    if (reclaim.kind !== "acquired") throw new Error("expected reclaimed");
    expect(reclaim.leaseToken).not.toBe(staleToken);
    expect(reclaim.record.generation).toBeGreaterThan(first.record.generation);

    // Mid-reclaim: old worker still tries to complete with pre-reclaim token.
    try {
      await store.complete({
        key: "stripe:evt_mid_reclaim",
        leaseToken: staleToken,
      });
      throw new Error("should throw lease_lost");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
    }

    // New worker still owns the lease and can complete.
    await store.complete({
      key: "stripe:evt_mid_reclaim",
      leaseToken: reclaim.leaseToken,
    });
    const rec = await store.get("stripe:evt_mid_reclaim");
    expect(rec?.status).toBe("completed");
  });
});

describe("A5 payload_conflict / WEBHOOKS-3 supersede", () => {
  it("different payloadHash on idle pending row → supersede and run handler (WEBHOOKS-3)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });
    let runs = 0;

    // Leave pending (not completed) so idle supersede applies.
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "hash-a",
      event: { id: "evt_conflict" },
      handler: async () => {
        runs++;
        throw new Error("leave pending");
      },
    });
    expect(runs).toBe(1);
    expect((await store.get("stripe:evt_conflict"))?.status).toBe("pending");

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "hash-b",
      event: { id: "evt_conflict" },
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "processed" });
    expect(runs).toBe(2);
    expect((await store.get("stripe:evt_conflict"))?.payloadHash).toBe("hash-b");
  });

  it("different payloadHash while lease active → payload_conflict, handler not called", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 30_000,
    });
    let runs = 0;

    const gate = { release: null as null | (() => void) };
    const first = engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_active_conflict",
      payloadHash: "hash-a",
      event: { id: "evt_active_conflict" },
      handler: async () => {
        runs++;
        await new Promise<void>((r) => {
          gate.release = r;
        });
      },
    });
    // Wait until first handler has the lease
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toBe(1);

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_active_conflict",
      payloadHash: "hash-b",
      event: { id: "evt_active_conflict" },
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "payload_conflict" });
    expect(runs).toBe(1);

    gate.release?.();
    await first;
  });
});

describe("already_processing", () => {
  it("while lease active returns already_processing with retryAfterMs", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 30_000,
    });

    const gate = { release: null as null | (() => void) };
    const first = engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_busy",
      payloadHash: "h",
      handler: async () => {
        await new Promise<void>((r) => {
          gate.release = r;
        });
      },
    });

    await new Promise((r) => setTimeout(r, 5));

    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_busy",
      payloadHash: "h",
      handler: async () => {},
    });
    expect(second.outcome).toBe("already_processing");
    if (second.outcome === "already_processing") {
      expect(second.retryAfterMs).toBeGreaterThan(0);
    }

    gate.release?.();
    await first;
  });
});

describe("lease renew (10.5)", () => {
  it("renew succeeds and rotates token for complete", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 5000,
    });

    let tokens: string[] = [];
    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_renew",
      payloadHash: "h",
      handler: async (ctx) => {
        tokens.push(ctx.leaseToken);
        await ctx.renew(10_000);
        tokens.push(ctx.leaseToken);
      },
    });
    expect(outcome).toEqual({ outcome: "processed" });
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it("wrong token renew fails (stale renew)", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
    });

    const claim = await store.claim({
      key: "stripe:evt_bad_renew",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    if (claim.kind !== "acquired") throw new Error("acquired");

    const r = await engine.renewLease(
      "stripe:evt_bad_renew",
      "not-the-token",
      30_000,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
  });

  it("stale token renew failure during processing → handler_failed retryable", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      defaultLeaseMs: 1000,
    });

    const outcome = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_renew_expire",
      payloadHash: "h",
      handler: async (ctx) => {
        // Expire lease before renew
        clock.advance(5000);
        await ctx.renew(10_000);
      },
    });
    expect(outcome).toEqual({ outcome: "handler_failed", retryable: true });
  });
});

describe("processWithVerifier", () => {
  it("verify failure → invalid_webhook without claim", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => ({ ok: false, reason: "bad sig" }),
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "invalid_webhook", reason: "bad sig" });
    expect(store.size).toBe(0);
  });

  it("P610-SNAP-1: sanitizes {ok:false}.reason", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => ({
        ok: false,
        reason: "bad sig sk_live_LEAKME123 token",
      }),
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
    if (o.outcome === "invalid_webhook") {
      expect(o.reason).toBeDefined();
      expect(o.reason).not.toContain("sk_live_");
      expect(o.reason).not.toContain("LEAKME123");
      expect(o.reason).toContain("[REDACTED]");
    }
    expect(store.size).toBe(0);
  });

  it("verify infra/network throw → retryable handler_failed not invalid_webhook (WEBHOOKS-1)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const netErr = new Error("PayPal verify postback timed out");
    netErr.name = "NetworkError";
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw netErr;
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("RateLimitError during verify → retryable handler_failed not invalid_webhook (WEBHOOKS-1/4)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const err = new Error("Rate limit exceeded for paypal. Retry after 2s");
    err.name = "RateLimitError";
    (err as Error & { code?: string; statusCode?: number }).code =
      "RATE_LIMIT_EXCEEDED";
    (err as Error & { statusCode?: number }).statusCode = 429;
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw err;
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("TypeError during verify → retryable handler_failed not invalid_webhook (WEBHOOKS-1/4)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw new TypeError("fetch failed: body used already");
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("generic Error during verify → retryable handler_failed (fail-open WEBHOOKS-1)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw new Error("unexpected verify boom");
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("InvalidWebhookError during verify → invalid_webhook (forgery class WEBHOOKS-1)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const err = new Error("Webhook verification failed");
    err.name = "InvalidWebhookError";
    (err as Error & { code?: string }).code = "INVALID_WEBHOOK";
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw err;
      },
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
    expect(store.size).toBe(0);
  });

  // WEBHOOKS-1 / WEBHOOKS-5: post-verify parse / structure errors must redeliver
  // (retryable handler_failed), never permanent invalid_webhook / forgery.
  it.each([
    {
      label: "InvalidRequestError 4xx (parse after verify)",
      name: "InvalidRequestError",
      code: "INVALID_REQUEST",
      message: "Webhook parse failed: unknown event type",
      statusCode: 400,
    },
    {
      label: "mis-wrapped parse as InvalidWebhookError (message says parse)",
      name: "InvalidWebhookError",
      code: "INVALID_WEBHOOK",
      message: "Webhook parse failed: thin event shape",
    },
  ] as const)(
    "$label → retryable not invalid_webhook (WEBHOOKS-1/5)",
    async ({ name, code, message, ...rest }) => {
      const store = createMemoryWebhookInboxStore();
      const engine = createWebhookInboxEngine({ store, mode: "inline" });
      const err = new Error(message);
      err.name = name;
      (err as Error & { code?: string }).code = code;
      if ("statusCode" in rest && rest.statusCode !== undefined) {
        (err as Error & { statusCode?: number }).statusCode = rest.statusCode;
      }
      const o = await engine.processWithVerifier({
        raw: {},
        verifyAndNormalize: async () => {
          throw err;
        },
        handler: async () => {},
      });
      expect(o).toEqual({ outcome: "handler_failed", retryable: true });
      expect(store.size).toBe(0);
    },
  );

  it("permanent GatewayApiError structure → non-retryable handler_failed (WEBHOOKS-6)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const err = new Error("Invalid webhook payload: not valid JSON");
    err.name = "GatewayApiError";
    (err as Error & { code?: string }).code = "GATEWAY_API_ERROR";
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw err;
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: false });
    expect(store.size).toBe(0);
  });

  it.each([408, 409, 425] as const)(
    "statusCode %s stays retryable (narrow permanent 4xx)",
    async (statusCode) => {
      const store = createMemoryWebhookInboxStore();
      const engine = createWebhookInboxEngine({ store, mode: "inline" });
      const err = new Error(`transient ${statusCode}`);
      (err as Error & { statusCode?: number }).statusCode = statusCode;
      const o = await engine.processWithVerifier({
        raw: {},
        verifyAndNormalize: async () => {
          throw err;
        },
        handler: async () => {},
      });
      expect(o).toEqual({ outcome: "handler_failed", retryable: true });
      expect(store.size).toBe(0);
    },
  );

  it("GatewayApiError nested 408/409/425 stay retryable", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const err = new Error("gateway conflict");
    err.name = "GatewayApiError";
    (err as Error & { code?: string; rawError?: { status: number } }).code =
      "GATEWAY_API_ERROR";
    (err as Error & { rawError?: { status: number } }).rawError = { status: 409 };
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw err;
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
  });

  it("transient GatewayApiError (postback) → retryable handler_failed (WEBHOOKS-6)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const err = new Error("PayPal verify endpoint 503");
    err.name = "GatewayApiError";
    (err as Error & { code?: string; statusCode?: number }).code =
      "GATEWAY_API_ERROR";
    (err as Error & { statusCode?: number }).statusCode = 502;
    const o = await engine.processWithVerifier({
      raw: {},
      verifyAndNormalize: async () => {
        throw err;
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(store.size).toBe(0);
  });

  it("verify success → processVerified path", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processWithVerifier({
      raw: { body: 1 },
      verifyAndNormalize: async () => ({
        ok: true,
        gateway: "stripe",
        providerEventId: "evt_v",
        payloadHash: "h",
        event: { ok: true },
      }),
      handler: async (ctx) => {
        expect(ctx.event).toEqual({ ok: true });
      },
    });
    expect(o).toEqual({ outcome: "processed" });
  });
});

describe("duplicate_failed → handler_failed not retryable", () => {
  it("dead_letter claim maps to handler_failed retryable false", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });

    const claim = await store.claim({
      key: "stripe:evt_dl",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    if (claim.kind !== "acquired") throw new Error("acquired");
    await store.fail({
      key: "stripe:evt_dl",
      leaseToken: claim.leaseToken,
      error: "poison",
      deadLetter: true,
    });

    let runs = 0;
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_dl",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: false });
    expect(runs).toBe(0);
  });
});

describe("sanitize errors in store lastError", () => {
  it("handler errors are sanitized before store.fail", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_secret",
      payloadHash: "h",
      handler: async () => {
        throw new Error("bad sk_live_ABCDEFG123 token");
      },
    });
    const rec = await store.get("stripe:evt_secret");
    expect(rec?.lastError).toBeDefined();
    expect(rec?.lastError).not.toContain("sk_live_");
    expect(rec?.lastError).toContain("[REDACTED]");
  });
});

describe("no silent ACK of failures", () => {
  it("never returns processed when handler throws", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    const o = await engine.processVerified({
      gateway: "g",
      providerEventId: "e",
      payloadHash: "h",
      handler: async () => {
        throw new Error("fail");
      },
    });
    expect(o.outcome).not.toBe("processed");
    expect(o.outcome).not.toBe("duplicate_completed");
  });
});

describe("P610-ACK-1: inline never emits scheduled_for_retry", () => {
  it("inline throw then immediate redelivery is not scheduled_for_retry", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
      // If fail used this delay, immediate redelivery would hit not_available.
      defaultRetryAfterMs: 60_000,
    });

    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_inline_redeliver",
      payloadHash: "h",
      handler: async () => {
        throw new Error("temporary outage");
      },
    });
    expect(first).toEqual({ outcome: "handler_failed", retryable: true });
    expect(first.outcome).not.toBe("scheduled_for_retry");

    let runs = 0;
    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_inline_redeliver",
      payloadHash: "h",
      handler: async () => {
        runs++;
      },
    });
    expect(second.outcome).not.toBe("scheduled_for_retry");
    expect(second).toEqual({ outcome: "processed" });
    expect(runs).toBe(1);
  });

  it("inline maps claim not_available to handler_failed retryable true", async () => {
    const clock = createTestClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const claim = await store.claim({
      key: "stripe:evt_inline_na",
      payloadHash: "h",
      owner: "seed",
      leaseMs: 30_000,
    });
    if (claim.kind !== "acquired") throw new Error("expected acquired");
    await store.fail({
      key: "stripe:evt_inline_na",
      leaseToken: claim.leaseToken,
      error: "backoff",
      retryAfterMs: 60_000,
    });

    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      clock,
    });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_inline_na",
      payloadHash: "h",
      handler: async () => {
        throw new Error("must not run");
      },
    });
    expect(o).toEqual({ outcome: "handler_failed", retryable: true });
    expect(o.outcome).not.toBe("scheduled_for_retry");
  });
});

describe("P610-SNAP-1: durable_retry must not persist rawPayload", () => {
  const paymentEvent = {
    schemaVersion: "1" as const,
    type: "payment.succeeded" as const,
    provider: {
      gateway: "stripe" as const,
      eventId: "evt_snap_pe",
      eventType: "payment_intent.succeeded",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:00:00.000Z",
    },
    payment: {
      status: "succeeded" as const,
      references: { providerPaymentId: "pi_snap" },
    },
  };

  it("refuses event that still has rawPayload/headers (no PaymentEvent to wrap)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_snap_refuse",
      payloadHash: "h",
      event: {
        id: "evt_snap_refuse",
        type: "payment.succeeded",
        rawPayload: { card: "4242424242424242", secret: "raw-body" },
        headers: { "stripe-signature": "t=1,v1=abc" },
      },
      handler: async () => {},
    });
    expect(o.outcome).toBe("invalid_webhook");
    if (o.outcome === "invalid_webhook") {
      expect(o.reason).toMatch(/rawPayload|headers|toPersistedPaymentEventEnvelope/i);
    }
    expect(store.size).toBe(0);
  });

  it("wraps dual-write event via toPersistedPaymentEventEnvelope (no rawPayload in payloadRef)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
    });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_snap_wrap",
      payloadHash: "h_snap_wrap",
      event: {
        id: "evt_snap_wrap",
        type: "payment_intent.succeeded",
        rawPayload: { do_not_persist: "raw-body-secret" },
        headers: { "stripe-signature": "t=1,v1=leak-sig" },
        event: paymentEvent,
      },
      handler: async () => {},
    });
    expect(o).toEqual({ outcome: "processed" });
    const rec = await store.get("stripe:evt_snap_wrap");
    expect(rec?.payloadRef).toBeDefined();
    expect(rec?.payloadRef).not.toContain("raw-body-secret");
    expect(rec?.payloadRef).not.toContain("stripe-signature");
    expect(rec?.payloadRef).not.toContain("leak-sig");
    expect(rec?.payloadRef).not.toMatch(/"rawPayload"/);
    expect(rec?.payloadRef).toContain("payment.succeeded");
  });

  it("refuses envelope that still has rawPayload", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      ackAfterClaim: true,
    });
    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_snap_env",
      payloadHash: "h",
      envelope: {
        id: "evt_snap_env",
        rawPayload: { leak: "envelope-raw" },
      },
    });
    expect(o.outcome).toBe("invalid_webhook");
    expect(store.size).toBe(0);
  });
});

describe("WEBHOOKS-5 first-delivery redaction parity", () => {
  it("redacts secret keys on first-delivery handler event (inline)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    let seen: unknown;
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_redact_first",
      payloadHash: "h",
      event: {
        id: "evt_redact_first",
        client_secret: "sk_live_secret",
        secret_token: "tok_secret",
        amount: 100,
      },
      handler: async (ctx) => {
        seen = ctx.event;
      },
    });
    expect(seen).toMatchObject({
      id: "evt_redact_first",
      amount: 100,
      client_secret: "[REDACTED]",
      secret_token: "[REDACTED]",
    });
  });
});
