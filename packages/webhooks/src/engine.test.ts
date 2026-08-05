/**
 * Engine behavioral tests: A2–A5, invalid_webhook, renew, sanitize, no silent ACK.
 * Crash boundaries (10.6) live in engine.crash.test.ts.
 */
import { describe, it, expect } from "bun:test";
import { hashWebhookPayload } from "@paykernel/core";
import {
  computePayloadHash,
  createWebhookInboxEngine,
} from "./engine";
import { createMemoryWebhookInboxStore } from "./memory-store";
import { isStoreLeaseLostError } from "./store";
import { createTestClock } from "./test-clock";

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

describe("A5 payload_conflict", () => {
  it("different payloadHash → payload_conflict, handler not called", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });
    let runs = 0;

    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "hash-a",
      handler: async () => {
        runs++;
      },
    });
    expect(runs).toBe(1);

    const o = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "hash-b",
      handler: async () => {
        runs++;
      },
    });
    expect(o).toEqual({ outcome: "payload_conflict" });
    expect(runs).toBe(1);
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

  it("verify infra/network throw → retryable handler_failed not invalid_webhook (WEBHOOKS-2)", async () => {
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
