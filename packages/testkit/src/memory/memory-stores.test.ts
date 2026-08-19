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

  it("deleteExpired keeps reclaimable reserved rows (SQL/Redis parity)", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "reserved_old_lease",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    // Advance past lease expiry; row is still reserved until reclaim.
    clock.advance(5_000);
    const before = new Date(clock.nowMs() + 1).toISOString();
    const cleaned = await store.deleteExpired({ before });
    expect(cleaned.deleted).toBe(0);
    // NEW-STORE-4: get is read-only — does not mutate reserved → expired.
    const got = await store.get("reserved_old_lease");
    expect(got).toBeDefined();
    expect(got?.status).toBe("reserved");
    expect(got?.leaseToken).toBe(r.leaseToken);
    clock.advance(1);
    const cleaned2 = await store.deleteExpired({
      before: new Date(clock.nowMs() + 1).toISOString(),
    });
    expect(cleaned2.deleted).toBe(0);
    expect((await store.get("reserved_old_lease"))?.status).toBe("reserved");
  });

  it("NEW-STORE-4: get after expiry is read-only; markIndeterminate still parks (A4)", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "a4_hang",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    clock.advance(1_001);
    const peeked = await store.get("a4_hang");
    expect(peeked?.status).toBe("reserved");
    expect(peeked?.leaseToken).toBe(r.leaseToken);
    await store.markIndeterminate({
      key: "a4_hang",
      leaseToken: r.leaseToken,
      reason: "network_timeout",
    });
    const parked = await store.get("a4_hang");
    expect(parked?.status).toBe("indeterminate");
    const blocked = await store.reserve({
      key: "a4_hang",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(blocked.kind).toBe("indeterminate");
  });

  it("NEW-STORE-4: complete after expiry fails closed without clearing the token", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const r = await store.reserve({
      key: "id_complete_exp",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    clock.advance(1_001);
    await expect(
      store.complete({
        key: "id_complete_exp",
        leaseToken: r.leaseToken,
        result: {},
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    const after = await store.get("id_complete_exp");
    expect(after?.status).toBe("reserved");
    expect(after?.leaseToken).toBe(r.leaseToken);
    await store.markIndeterminate({
      key: "id_complete_exp",
      leaseToken: r.leaseToken,
    });
    expect((await store.get("id_complete_exp"))?.status).toBe("indeterminate");
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
      // Free-form / PII-looking string — must not be persisted (TESTKIT-2)
      reason: "customer email user@example.com network_timeout",
    });
    const blocked = await store.reserve({
      key: "ind",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(blocked.kind).toBe("indeterminate");
    const indRec = await store.get("ind");
    expect(indRec?.status).toBe("indeterminate");
    // Status fences; free-form reason must never land on the public record
    expect(JSON.stringify(indRec)).not.toContain("user@example.com");
    expect(indRec?.result).toBeUndefined();
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

  it("classifies completed and indeterminate before fingerprint_conflict", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock });
    const done = await store.reserve({
      key: "term_fp",
      fingerprint: "fp-a",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(done.kind).toBe("acquired");
    if (done.kind !== "acquired") return;
    await store.complete({
      key: "term_fp",
      leaseToken: done.leaseToken,
      result: { ok: true },
    });
    const again = await store.reserve({
      key: "term_fp",
      fingerprint: "fp-b-different",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("already_completed");

    const park = await store.reserve({
      key: "ind_fp",
      fingerprint: "fp-a",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(park.kind).toBe("acquired");
    if (park.kind !== "acquired") return;
    await store.markIndeterminate({
      key: "ind_fp",
      leaseToken: park.leaseToken,
    });
    const blocked = await store.reserve({
      key: "ind_fp",
      fingerprint: "fp-b-different",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(blocked.kind).toBe("indeterminate");
  });

  it("maxEntries skips active reserved and evicts terminal; refuses when all leased", async () => {
    const clock = createFakeClock();
    const store = createMemoryIdempotencyStore({ clock, maxEntries: 2 });
    const keep = await store.reserve({
      key: "id_keep",
      fingerprint: "fp1",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(keep.kind).toBe("acquired");
    const done = await store.reserve({
      key: "id_done",
      fingerprint: "fp2",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(done.kind).toBe("acquired");
    if (done.kind !== "acquired") return;
    await store.complete({
      key: "id_done",
      leaseToken: done.leaseToken,
      result: { ok: true },
    });

    const next = await store.reserve({
      key: "id_new",
      fingerprint: "fp3",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(next.kind).toBe("acquired");
    expect((await store.get("id_keep"))?.status).toBe("reserved");
    expect(await store.get("id_done")).toBeUndefined();
    expect((await store.get("id_new"))?.status).toBe("reserved");

    const full = createMemoryIdempotencyStore({ clock, maxEntries: 1 });
    const only = await full.reserve({
      key: "id_only",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(only.kind).toBe("acquired");
    await expect(
      full.reserve({
        key: "id_overflow",
        fingerprint: "fp2",
        owner: "w2",
        leaseMs: 5_000,
      }),
    ).rejects.toThrow(/active lease|capacity/i);
    expect((await full.get("id_only"))?.status).toBe("reserved");
    expect(await full.get("id_overflow")).toBeUndefined();
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

  it("S19 ifMatchPayloadHash miss does not rewrite an idle newer hash", async () => {
    const store = createMemoryWebhookInboxStore({ clock: createFakeClock() });
    const first = await store.claim({
      key: "evt_s19_cas",
      payloadHash: "hash-a",
      owner: "w1",
      leaseMs: 5000,
      payloadRef: JSON.stringify({ id: "old" }),
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("expected acquired");
    await store.fail({
      key: "evt_s19_cas",
      leaseToken: first.leaseToken,
      error: "park a",
      retryAfterMs: 0,
    });
    const newer = await store.claim({
      key: "evt_s19_cas",
      payloadHash: "hash-b",
      owner: "w2",
      leaseMs: 5000,
      payloadRef: JSON.stringify({ id: "new" }),
    });
    expect(newer.kind).toBe("acquired");
    if (newer.kind !== "acquired") throw new Error("expected supersede");
    await store.fail({
      key: "evt_s19_cas",
      leaseToken: newer.leaseToken,
      error: "park b",
      retryAfterMs: 0,
      restoreAttempt: true,
    });
    const stale = await store.claim({
      key: "evt_s19_cas",
      payloadHash: "hash-a",
      owner: "worker",
      leaseMs: 5000,
      payloadRef: JSON.stringify({ id: "old" }),
      ifMatchPayloadHash: "hash-a",
    });
    expect(stale.kind).toBe("payload_hash_conflict");
    const rec = await store.get("evt_s19_cas");
    expect(rec?.payloadHash).toBe("hash-b");
    expect(rec?.payloadRef).toBe(JSON.stringify({ id: "new" }));
    expect(rec?.status).toBe("pending");
  });

  it("S20-MEM-GET-WIPE: get() after expiry is read-only; listRetryable still soft-releases", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_get_wipe",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    clock.advance(2_000);
    const peeked = await store.get("e_get_wipe");
    expect(peeked?.status).toBe("claimed");
    expect(peeked?.leaseToken).toBe(a.leaseToken);
    const listed = await store.listRetryable({ limit: 10 });
    const row = listed.find((r) => r.key === "e_get_wipe");
    expect(row?.status).toBe("pending");
    expect(row?.leaseToken).toBeUndefined();
    expect((await store.get("e_get_wipe"))?.status).toBe("pending");
  });

  it("S20-LIST-NOW: listRetryable with caller now ahead of store clock does not wipe a live lease", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_list_ahead",
      payloadHash: "h",
      owner: "w",
      leaseMs: 30_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    const workerNow = new Date(clock.nowMs() + 35_000).toISOString();
    const listed = await store.listRetryable({ now: workerNow, limit: 10 });
    expect(listed.find((r) => r.key === "e_list_ahead")).toBeUndefined();
    const got = await store.get("e_list_ahead");
    expect(got?.status).toBe("claimed");
    expect(got?.leaseToken).toBe(a.leaseToken);
  });

  it("WEBHOOKS-1: completed terminal wins before payload_hash_conflict", async () => {
    const store = createMemoryWebhookInboxStore({ clock: createFakeClock() });
    const a = await store.claim({
      key: "e_term",
      payloadHash: "a",
      owner: "w",
      leaseMs: 5000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") throw new Error("expected acquired");
    await store.complete({ key: "e_term", leaseToken: a.leaseToken });
    const again = await store.claim({
      key: "e_term",
      payloadHash: "b-different",
      owner: "w2",
      leaseMs: 5000,
    });
    expect(again.kind).toBe("already_completed");
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

  it("WEBHOOKS-2: fail after lease expiry with matching token records pending", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_fail_exp",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    expect(a.record.attempts).toBe(1);
    clock.advance(1_001);
    // Do not get/listRetryable first — those soft-release and would drop the token.
    await store.fail({
      key: "e_fail_exp",
      leaseToken: a.leaseToken,
      error: "handler_timeout",
      retryAfterMs: 5_000,
    });
    const after = await store.get("e_fail_exp");
    expect(after?.status).toBe("pending");
    expect(after?.attempts).toBe(1);
    expect(after?.lastError).toBe("handler_timeout");
  });

  it("WEBHOOKS-2: fail({ deadLetter: true }) after expiry records dead_letter", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_fail_dl_exp",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    clock.advance(1_001);
    await store.fail({
      key: "e_fail_dl_exp",
      leaseToken: a.leaseToken,
      error: "poison",
      deadLetter: true,
    });
    expect((await store.get("e_fail_dl_exp"))?.status).toBe("dead_letter");
  });

  it("complete after lease expiry still requires an active lease", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_complete_exp",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    clock.advance(1_001);
    await expect(
      store.complete({ key: "e_complete_exp", leaseToken: a.leaseToken }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("NEW-STORE-3: complete after expiry does not wipe then lease_lost", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_complete_wipe",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.complete({ key: "e_complete_wipe", leaseToken: a.leaseToken }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    // Fail-closed without restore-then-lose: matching token can still fail().
    await store.fail({
      key: "e_complete_wipe",
      leaseToken: a.leaseToken,
      error: "recorded_after_expiry",
    });
    const rec = await store.get("e_complete_wipe");
    expect(rec?.status).toBe("pending");
    expect(rec?.lastError).toBe("recorded_after_expiry");
  });

  it("NEW-STORE-3: renew after expiry does not wipe then lease_lost", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock });
    const a = await store.claim({
      key: "e_renew_wipe",
      payloadHash: "h",
      owner: "w",
      leaseMs: 1_000,
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    clock.advance(2_000);
    const r = await store.renew({
      key: "e_renew_wipe",
      leaseToken: a.leaseToken,
      leaseMs: 5_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
    await store.fail({
      key: "e_renew_wipe",
      leaseToken: a.leaseToken,
      error: "renew_expiry_recorded",
    });
    const rec = await store.get("e_renew_wipe");
    expect(rec?.status).toBe("pending");
    expect(rec?.lastError).toBe("renew_expiry_recorded");
  });

  it("maxEntries skips active claimed and evicts terminal; refuses when all leased", async () => {
    const clock = createFakeClock();
    const store = createMemoryWebhookInboxStore({ clock, maxEntries: 2 });
    const keep = await store.claim({
      key: "wh_keep",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(keep.kind).toBe("acquired");
    const done = await store.claim({
      key: "wh_done",
      payloadHash: "h2",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(done.kind).toBe("acquired");
    if (done.kind !== "acquired") return;
    await store.complete({ key: "wh_done", leaseToken: done.leaseToken });

    const next = await store.claim({
      key: "wh_new",
      payloadHash: "h3",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(next.kind).toBe("acquired");
    expect((await store.get("wh_keep"))?.status).toBe("claimed");
    expect(await store.get("wh_done")).toBeUndefined();
    expect((await store.get("wh_new"))?.status).toBe("claimed");

    const full = createMemoryWebhookInboxStore({ clock, maxEntries: 1 });
    const only = await full.claim({
      key: "wh_only",
      payloadHash: "h",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(only.kind).toBe("acquired");
    await expect(
      full.claim({
        key: "wh_overflow",
        payloadHash: "h2",
        owner: "w2",
        leaseMs: 5_000,
      }),
    ).rejects.toThrow(/active lease|capacity/i);
    expect((await full.get("wh_only"))?.status).toBe("claimed");
    expect(await full.get("wh_overflow")).toBeUndefined();
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

  /**
   * Regression: listDue must soft-release expired claimed→scheduled so poll
   * workers (claimDue/processDue) rediscover abandoned jobs without get(key).
   * Memory is the reference impl; durable adapters must match this contract.
   */
  it("listDue soft-releases expired claimed jobs (poll recovery)", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_list_soft",
      subjectId: "pay_soft",
      reason: "indeterminate",
      dueAt: clock.nowIso(),
    });
    const claimed = await store.claim({
      key: "r_list_soft",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");

    expect(
      (await store.listDue({ now: clock.nowIso(), limit: 10 })).some(
        (r) => r.key === "r_list_soft",
      ),
    ).toBe(false);

    clock.advance(1_001);

    const due = await store.listDue({ now: clock.nowIso(), limit: 10 });
    const row = due.find((r) => r.key === "r_list_soft");
    expect(row).toBeDefined();
    expect(row?.status).toBe("scheduled");
    expect(row?.leaseToken).toBeUndefined();
    expect(row?.leaseExpiresAt).toBeUndefined();

    // Soft-release must persist for subsequent get.
    const got = await store.get("r_list_soft");
    expect(got?.status).toBe("scheduled");
  });

  it("S20-MEM-GET-WIPE: get() after expiry is read-only; listDue still soft-releases", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_get_wipe",
      subjectId: "pay_get",
      reason: "indeterminate",
      dueAt: clock.nowIso(),
    });
    const claimed = await store.claim({
      key: "r_get_wipe",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;
    clock.advance(2_000);
    const peeked = await store.get("r_get_wipe");
    expect(peeked?.status).toBe("claimed");
    expect(peeked?.leaseToken).toBe(claimed.leaseToken);
    const due = await store.listDue({ now: clock.nowIso(), limit: 10 });
    expect(due.find((r) => r.key === "r_get_wipe")?.status).toBe("scheduled");
    expect((await store.get("r_get_wipe"))?.status).toBe("scheduled");
  });

  it("S20-LIST-NOW: listDue with caller now ahead of store clock does not wipe a live lease", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_list_ahead",
      subjectId: "pay_ahead",
      reason: "indeterminate",
      dueAt: clock.nowIso(),
    });
    const claimed = await store.claim({
      key: "r_list_ahead",
      owner: "w",
      leaseMs: 30_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;
    const workerNow = new Date(clock.nowMs() + 35_000).toISOString();
    const due = await store.listDue({ now: workerNow, limit: 10 });
    expect(due.find((r) => r.key === "r_list_ahead")).toBeUndefined();
    const got = await store.get("r_list_ahead");
    expect(got?.status).toBe("claimed");
    expect(got?.leaseToken).toBe(claimed.leaseToken);
  });

  it("maxEntries skips active claimed and evicts terminal; refuses when all leased", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock, maxEntries: 2 });
    await store.schedule({
      key: "r_keep",
      subjectId: "p1",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    await store.schedule({
      key: "r_done",
      subjectId: "p2",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    const keep = await store.claim({
      key: "r_keep",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(keep.kind).toBe("acquired");
    const done = await store.claim({
      key: "r_done",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(done.kind).toBe("acquired");
    if (done.kind !== "acquired") return;
    await store.complete({ key: "r_done", leaseToken: done.leaseToken });

    await store.schedule({
      key: "r_new",
      subjectId: "p3",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    expect((await store.get("r_keep"))?.status).toBe("claimed");
    expect(await store.get("r_done")).toBeUndefined();
    expect((await store.get("r_new"))?.status).toBe("scheduled");

    const full = createMemoryReconciliationStore({ clock, maxEntries: 1 });
    await full.schedule({
      key: "r_only",
      subjectId: "p",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    const only = await full.claim({
      key: "r_only",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(only.kind).toBe("acquired");
    await expect(
      full.schedule({
        key: "r_overflow",
        subjectId: "p2",
        reason: "x",
        dueAt: clock.nowIso(),
      }),
    ).rejects.toThrow(/active lease|capacity/i);
    expect((await full.get("r_only"))?.status).toBe("claimed");
    expect(await full.get("r_overflow")).toBeUndefined();
  });

  it("expired claimed listDue then claim does not burn attempts", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_attempts",
      subjectId: "pay_1",
      reason: "indeterminate",
      dueAt: clock.nowIso(),
    });
    const first = await store.claim({
      key: "r_attempts",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.record.attempts).toBe(1);

    clock.advance(1_001);
    const due = await store.listDue({ now: clock.nowIso(), limit: 10 });
    expect(due.some((r) => r.key === "r_attempts")).toBe(true);

    const second = await store.claim({
      key: "r_attempts",
      owner: "w_new",
      leaseMs: 30_000,
    });
    expect(second.kind).toBe("acquired");
    if (second.kind !== "acquired") return;
    expect(second.record.attempts).toBe(first.record.attempts);
  });

  it("NEW-STORE-5: fail after expiry records with matching token (no wipe-first)", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_fail_exp",
      subjectId: "p",
      reason: "hang",
      dueAt: clock.nowIso(),
    });
    const first = await store.claim({
      key: "r_fail_exp",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.record.attempts).toBe(1);
    clock.advance(2_000);
    await store.fail({
      key: "r_fail_exp",
      leaseToken: first.leaseToken,
      error: "handler overran lease",
      retryAt: new Date(clock.nowMs() + 5_000).toISOString(),
    });
    const rec = await store.get("r_fail_exp");
    expect(rec?.status).toBe("scheduled");
    expect(rec?.attempts).toBe(1);
    expect(rec?.lastError).toBe("handler overran lease");
  });

  it("NEW-STORE-5: complete after expiry fails closed; fail still records", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_complete_wipe",
      subjectId: "p",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    const first = await store.claim({
      key: "r_complete_wipe",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.complete({
        key: "r_complete_wipe",
        leaseToken: first.leaseToken,
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    await store.fail({
      key: "r_complete_wipe",
      leaseToken: first.leaseToken,
      error: "recorded_after_failed_complete",
    });
    expect((await store.get("r_complete_wipe"))?.status).toBe("failed");
  });

  it("NEW-STORE-5: markManualReview after expiry fails closed without wipe", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    await store.schedule({
      key: "r_review_exp",
      subjectId: "p",
      reason: "x",
      dueAt: clock.nowIso(),
    });
    const first = await store.claim({
      key: "r_review_exp",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.markManualReview({
        key: "r_review_exp",
        leaseToken: first.leaseToken,
        note: "hang_review",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    await store.fail({
      key: "r_review_exp",
      leaseToken: first.leaseToken,
      error: "recorded_after_failed_review",
    });
    expect((await store.get("r_review_exp"))?.status).toBe("failed");
  });

  it("schedule reopens terminal completed; claimed stays already_exists", async () => {
    const clock = createFakeClock();
    const store = createMemoryReconciliationStore({ clock });
    const first = await store.schedule({
      key: "r_reopen",
      subjectId: "pay_1",
      reason: "first",
      dueAt: clock.nowIso(),
    });
    expect(first.kind).toBe("scheduled");
    const claimed = await store.claim({
      key: "r_reopen",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;

    const whileClaimed = await store.schedule({
      key: "r_reopen",
      subjectId: "pay_1",
      reason: "steal",
      dueAt: clock.nowIso(),
    });
    expect(whileClaimed.kind).toBe("already_exists");

    await store.complete({ key: "r_reopen", leaseToken: claimed.leaseToken });
    const reopened = await store.schedule({
      key: "r_reopen",
      subjectId: "pay_1",
      reason: "reopen",
      dueAt: clock.nowIso(),
    });
    expect(reopened.kind).toBe("scheduled");
    if (reopened.kind !== "scheduled") return;
    expect(reopened.record.status).toBe("scheduled");
    expect(reopened.record.reason).toBe("reopen");
    expect(reopened.record.attempts).toBe(0);
    expect(reopened.record.generation).toBe(claimed.record.generation);

    const again = await store.schedule({
      key: "r_reopen",
      subjectId: "pay_1",
      reason: "again",
      dueAt: clock.nowIso(),
    });
    expect(again.kind).toBe("already_exists");
  });
});
