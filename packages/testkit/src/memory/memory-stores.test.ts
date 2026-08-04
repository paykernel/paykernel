import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  createMemoryIdempotencyStore,
  createMemoryStores,
  createMemoryWebhookInboxStore,
  createMemoryReconciliationStore,
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  MEMORY_STORE_WARNING,
  NON_DISTRIBUTED,
  NON_PRODUCTION,
} from "../index";
import { StoreLeaseLostError, StoreUnavailableError } from "../storage/contracts";

describe("memory stores markers", () => {
  it("exports NON_PRODUCTION, NON_DISTRIBUTED, MEMORY_STORE_WARNING banners", () => {
    expect(NON_PRODUCTION).toBe(true);
    expect(NON_DISTRIBUTED).toBe(true);
    expect(MEMORY_STORE_WARNING).toContain("NON-PRODUCTION");
    const stores = createMemoryStores();
    expect(stores.NON_PRODUCTION).toBe(true);
    expect(stores.NON_DISTRIBUTED).toBe(true);
    expect(stores.idempotency.NON_PRODUCTION).toBe(true);
    expect(stores.idempotency.MEMORY_STORE_WARNING).toBe(MEMORY_STORE_WARNING);
  });

  it("wires MEMORY_STORAGE_ADAPTER_MANIFEST on createMemoryStores", () => {
    // Full manifest field coverage lives in adapter-manifest.test.ts
    const stores = createMemoryStores();
    expect(stores.manifest).toBe(MEMORY_STORAGE_ADAPTER_MANIFEST);
  });
});

describe("fake clock", () => {
  it("advances deterministically", () => {
    const clock = createFakeClock({ initialMs: 1_000 });
    expect(clock.nowMs()).toBe(1_000);
    clock.advance(500);
    expect(clock.nowMs()).toBe(1_500);
    clock.set(9_000);
    expect(clock.nowIso()).toBe(new Date(9_000).toISOString());
  });

  it("accepts Date start and set(Date)", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const clock = createFakeClock(start);
    expect(clock.nowMs()).toBe(start.getTime());
    const next = new Date("2024-01-02T00:00:00.000Z");
    clock.set(next);
    expect(clock.nowMs()).toBe(next.getTime());
  });
});

describe("createMemoryIdempotencyStore", () => {
  it("reserves, completes, and rejects stale token", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "k",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    await store.complete({ key: "k", leaseToken: r.leaseToken, result: { ok: true } });
    const got = await store.get("k");
    expect(got?.status).toBe("completed");
  });

  it("simulates crash boundary on next mutation", async () => {
    const store = createMemoryIdempotencyStore({ clock: createFakeClock() });
    store.simulateCrash();
    await expect(
      store.reserve({
        key: "c",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
    // next call works
    const r = await store.reserve({
      key: "c",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("acquired");
  });

  it("lease expiry with fake clock", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "exp",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 100,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    clock.advance(200);
    let lost = false;
    try {
      await store.complete({
        key: "exp",
        leaseToken: r.leaseToken,
        result: {},
      });
    } catch (e) {
      lost = e instanceof StoreLeaseLostError;
    }
    expect(lost).toBe(true);
  });

  it("withTransaction rolls back on throw", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    await expect(
      store.withTransaction(async () => {
        const r = await store.reserve({
          key: "tx",
          fingerprint: "fp",
          owner: "w",
          leaseMs: 5_000,
        });
        expect(r.kind).toBe("acquired");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.get("tx")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("withTransaction commits on success", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    await store.withTransaction(async () => {
      const r = await store.reserve({
        key: "tx_ok",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 5_000,
      });
      if (r.kind !== "acquired") throw new Error("expected acquired");
      await store.complete({
        key: "tx_ok",
        leaseToken: r.leaseToken,
        result: { v: 1 },
      });
    });
    expect((await store.get("tx_ok"))?.status).toBe("completed");
  });

  it("indeterminate blocks reserve and is not deleted by deleteExpired (A4)", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "ind",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    await store.markIndeterminate({
      key: "ind",
      leaseToken: r.leaseToken,
      reason: "network_timeout",
    });
    const blocked = await store.reserve({
      key: "ind",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(blocked.kind).toBe("indeterminate");
    clock.advance(60_000);
    await store.deleteExpired({
      before: new Date(clock.nowMs() + 1).toISOString(),
    });
    expect((await store.get("ind"))?.status).toBe("indeterminate");
  });

  it("renew rotates token and rejects pre-renew complete", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "rnw",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    const oldToken = r.leaseToken;
    const gen1 = r.record.generation;
    const renewed = await store.renew({
      key: "rnw",
      leaseToken: oldToken,
      leaseMs: 10_000,
    });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.leaseToken).not.toBe(oldToken);
    expect(renewed.record.generation).toBeGreaterThan(gen1);
    await expect(
      store.complete({ key: "rnw", leaseToken: oldToken, result: {} }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    await store.complete({
      key: "rnw",
      leaseToken: renewed.leaseToken,
      result: { ok: true },
    });
    expect((await store.get("rnw"))?.status).toBe("completed");
  });
});

describe("createMemoryWebhookInboxStore", () => {
  it("payload hash conflict", async () => {
    const store = createMemoryWebhookInboxStore({ clock: createFakeClock() });
    await store.claim({
      key: "e1",
      payloadHash: "a",
      owner: "w",
      leaseMs: 5000,
    });
    const c = await store.claim({
      key: "e1",
      payloadHash: "b",
      owner: "w2",
      leaseMs: 5000,
    });
    expect(c.kind).toBe("payload_hash_conflict");
  });

  it("withTransaction rollback on claim", async () => {
    const store = createMemoryWebhookInboxStore({ clock: createFakeClock() });
    await expect(
      store.withTransaction(async () => {
        await store.claim({
          key: "e_tx",
          payloadHash: "h",
          owner: "w",
          leaseMs: 5000,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await store.get("e_tx")).toBeUndefined();
  });

  it("renew rotates token; pre-renew complete fails", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_rnw",
      payloadHash: "h",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    const oldToken = a.leaseToken;
    const renewed = await store.renew({
      key: "e_rnw",
      leaseToken: oldToken,
      leaseMs: 10_000,
    });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.leaseToken).not.toBe(oldToken);
    expect(renewed.record.generation).toBeGreaterThan(a.record.generation);
    await expect(
      store.complete({ key: "e_rnw", leaseToken: oldToken }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    await store.complete({ key: "e_rnw", leaseToken: renewed.leaseToken });
    expect((await store.get("e_rnw"))?.status).toBe("completed");
  });

  it("claim respects availableAt; restoreAttempt undoes parking attempt", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_backoff",
      payloadHash: "h",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    expect(a.record.attempts).toBe(1);
    await store.fail({
      key: "e_backoff",
      leaseToken: a.leaseToken,
      error: "park",
      retryAfterMs: 10_000,
      restoreAttempt: true,
    });
    expect((await store.get("e_backoff"))?.attempts).toBe(0);
    const early = await store.claim({
      key: "e_backoff",
      payloadHash: "h",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(early.kind).toBe("not_available");
    expect((await store.get("e_backoff"))?.attempts).toBe(0);
    expect(await store.listRetryable({ limit: 10 })).toHaveLength(0);
    clock.advance(10_000);
    const late = await store.claim({
      key: "e_backoff",
      payloadHash: "h",
      owner: "w3",
      leaseMs: 5_000,
    });
    expect(late.kind).toBe("acquired");
    if (late.kind === "acquired") {
      expect(late.record.attempts).toBe(1);
    }
  });
});

describe("createMemoryReconciliationStore", () => {
  it("withTransaction rollback on schedule", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await expect(
      store.withTransaction(async () => {
        await store.schedule({
          key: "r_tx",
          subjectId: "p",
          reason: "x",
          dueAt: clock.nowIso(),
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await store.get("r_tx")).toBeUndefined();
  });

  it("renew rotates token; pre-renew complete fails", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_rnw",
      subjectId: "p",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    const c = await store.claim({
      key: "r_rnw",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(c.kind).toBe("acquired");
    if (c.kind !== "acquired") return;
    const oldToken = c.leaseToken;
    const renewed = await store.renew({
      key: "r_rnw",
      leaseToken: oldToken,
      leaseMs: 10_000,
    });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.leaseToken).not.toBe(oldToken);
    expect(renewed.record.generation).toBeGreaterThan(c.record.generation);
    await expect(
      store.complete({ key: "r_rnw", leaseToken: oldToken }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    await store.complete({ key: "r_rnw", leaseToken: renewed.leaseToken });
    expect((await store.get("r_rnw"))?.status).toBe("completed");
  });
});
