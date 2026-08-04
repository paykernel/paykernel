/**
 * Unit tests with live in-memory bun:sqlite via root factories + executor port.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  createFakeClock,
  StoreLeaseLostError,
} from "@paykernel/testkit";
import {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  createSqliteReconciliationStore,
  createSqliteStores,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "../index";
import {
  createInMemoryBunSqliteExecutor,
  createExecutorFromBunSqlite,
  openBunSqliteDatabase,
} from "../drivers/bun";
import type { SqliteExecutor } from "../executor";

describe("sqlite stores unit (bun:sqlite memory)", () => {
  let executor: SqliteExecutor;
  let close: () => void;

  beforeEach(async () => {
    const mem = createInMemoryBunSqliteExecutor();
    executor = mem.executor;
    close = mem.close;
    await migrateSqliteAdapter(executor);
  });

  afterEach(() => {
    close();
  });

  it("idempotency reserve → complete roundtrip", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteIdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    expect(r.record.generation).toBe(1);
    expect(r.leaseToken.length).toBeGreaterThan(8);
    expect(r.leaseToken.startsWith("lt_")).toBe(true);

    await store.complete({
      key: "k1",
      leaseToken: r.leaseToken,
      result: { ok: true },
    });
    const got = await store.get("k1");
    expect(got?.status).toBe("completed");
  });

  it("complete with wrong token throws StoreLeaseLostError", async () => {
    const store = createSqliteIdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k2",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    await expect(
      store.complete({ key: "k2", leaseToken: "stale", result: {} }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("reserve returns indeterminate and does not re-lease", async () => {
    const store = createSqliteIdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k3",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    await store.markIndeterminate({
      key: "k3",
      leaseToken: r.leaseToken,
      reason: "uncertain",
    });
    const again = await store.reserve({
      key: "k3",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("indeterminate");
  });

  it("reserve returns fingerprint_conflict", async () => {
    const store = createSqliteIdempotencyStore({ executor });
    await store.reserve({
      key: "k4",
      fingerprint: "fp1",
      owner: "w",
      leaseMs: 5_000,
    });
    const r = await store.reserve({
      key: "k4",
      fingerprint: "fp2",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("fingerprint_conflict");
  });

  it("FakeClock controls lease reclaim", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteIdempotencyStore({ executor, clock });
    const r1 = await store.reserve({
      key: "lease-clock",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(r1.kind).toBe("acquired");
    if (r1.kind !== "acquired") return;

    const blocked = await store.reserve({
      key: "lease-clock",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 1_000,
    });
    expect(blocked.kind).toBe("in_progress");

    clock.advance(2_000);
    const r2 = await store.reserve({
      key: "lease-clock",
      fingerprint: "fp",
      owner: "w2",
      leaseMs: 1_000,
    });
    expect(r2.kind).toBe("acquired");
    if (r2.kind !== "acquired") return;
    expect(r2.record.generation).toBe(2);
    expect(r2.leaseToken).not.toBe(r1.leaseToken);
  });

  it("webhook claim → complete", async () => {
    const store = createSqliteWebhookInboxStore({ executor });
    const r = await store.claim({
      key: "evt1",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind !== "acquired") return;
    await store.complete({ key: "evt1", leaseToken: r.leaseToken });
    const again = await store.claim({
      key: "evt1",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("already_completed");
  });

  it("reconciliation schedule → claim → complete", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteReconciliationStore({ executor, clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    const s = await store.schedule({
      key: "job1",
      subjectId: "pay_1",
      reason: "timeout",
      dueAt,
    });
    expect(s.kind).toBe("scheduled");

    const c = await store.claim({ key: "job1", owner: "w", leaseMs: 5_000 });
    expect(c.kind).toBe("acquired");
    if (c.kind !== "acquired") return;
    await store.complete({ key: "job1", leaseToken: c.leaseToken });
    const got = await store.get("job1");
    expect(got?.status).toBe("completed");
  });

  it("createSqliteStores shares namespace and does not migrate", async () => {
    const db = openBunSqliteDatabase(":memory:");
    const bare = createExecutorFromBunSqlite(db);
    applyRecommendedPragmas(bare, { busyTimeoutMs: 1000, wal: false });
    // No migrate — factory still constructs
    const bundle = createSqliteStores({
      executor: bare,
      namespace: { tablePrefix: "t_" },
    });
    expect(bundle.manifest.name).toBe("sqlite");
    expect(bundle.namespace.tablePrefix).toBe("t_");
    // Operations fail without schema
    await expect(
      bundle.idempotency.reserve({
        key: "x",
        fingerprint: "f",
        owner: "w",
        leaseMs: 1000,
      }),
    ).rejects.toBeDefined();
    db.close();
  });

  it("deleteExpired never removes indeterminate by default", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteIdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "ind",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 5_000,
    });
    if (r.kind !== "acquired") throw new Error("expected acquired");
    await store.markIndeterminate({ key: "ind", leaseToken: r.leaseToken });
    clock.advance(86_400_000);
    const before = new Date(clock.nowMs()).toISOString();
    const cleaned = await store.deleteExpired({ before });
    expect(cleaned.deleted).toBe(0);
    const got = await store.get("ind");
    expect(got?.status).toBe("indeterminate");
  });
});
