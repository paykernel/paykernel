/**
 * Structural compatibility: webhooks-owned WebhookInboxStore matches the
 * Phase 9 claim/renew/complete/fail surface expected by durable adapters and
 * testkit memory stores (dual types until optional re-export).
 */
import { describe, it, expect } from "bun:test";
import type {
  RenewWebhookLeaseResult,
  WebhookInboxRecord,
  WebhookInboxStore,
} from "./store";
import { StoreLeaseLostError, isStoreLeaseLostError } from "./store";
import { createMemoryWebhookInboxStore } from "./memory-store";

describe("WebhookInboxStore structural contract", () => {
  it("memory store is assignable to WebhookInboxStore", () => {
    const store: WebhookInboxStore = createMemoryWebhookInboxStore();
    expect(typeof store.claim).toBe("function");
    expect(typeof store.renew).toBe("function");
    expect(typeof store.complete).toBe("function");
    expect(typeof store.fail).toBe("function");
    expect(typeof store.get).toBe("function");
    expect(typeof store.listRetryable).toBe("function");
    expect(typeof store.deleteExpired).toBe("function");
  });

  it("claim result kinds include acquired | already_completed | in_progress | payload_hash_conflict | duplicate_failed", async () => {
    const store = createMemoryWebhookInboxStore();
    const a = await store.claim({
      key: "stripe:evt_a",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 30_000,
    });
    expect(a.kind).toBe("acquired");

    const b = await store.claim({
      key: "stripe:evt_a",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(b.kind).toBe("in_progress");

    const c = await store.claim({
      key: "stripe:evt_a",
      payloadHash: "h2",
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(c.kind).toBe("payload_hash_conflict");
  });

  it("renew rotates token and rejects stale", async () => {
    const store = createMemoryWebhookInboxStore();
    const a = await store.claim({
      key: "k1",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    const old = a.leaseToken;
    const r: RenewWebhookLeaseResult = await store.renew({
      key: "k1",
      leaseToken: old,
      leaseMs: 30_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.leaseToken).not.toBe(old);

    const stale = await store.renew({
      key: "k1",
      leaseToken: old,
      leaseMs: 30_000,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected fail");
    expect(stale.reason).toBe("lease_lost");
  });

  it("stale complete throws StoreLeaseLostError", async () => {
    const store = createMemoryWebhookInboxStore();
    const a = await store.claim({
      key: "k2",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    await store.complete({ key: "k2", leaseToken: a.leaseToken });
    try {
      await store.complete({ key: "k2", leaseToken: a.leaseToken });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
      expect(e).toBeInstanceOf(StoreLeaseLostError);
    }
  });

  it("record shape has required lean fields", async () => {
    const store = createMemoryWebhookInboxStore();
    const a = await store.claim({
      key: "k3",
      payloadHash: "hash",
      owner: "owner",
      leaseMs: 10_000,
      payloadRef: JSON.stringify({ schemaVersion: "1" }),
    });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    const rec: WebhookInboxRecord = a.record;
    expect(rec.key).toBe("k3");
    expect(rec.status).toBe("claimed");
    expect(rec.payloadHash).toBe("hash");
    expect(rec.payloadRef).toBe(JSON.stringify({ schemaVersion: "1" }));
    expect(typeof rec.attempts).toBe("number");
    expect(typeof rec.generation).toBe("number");
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.updatedAt).toBe("string");
    expect(typeof rec.availableAt).toBe("string");
  });

});
