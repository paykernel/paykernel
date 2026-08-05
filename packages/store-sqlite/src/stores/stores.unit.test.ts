/**
 * Unit tests with live in-memory bun:sqlite via root factories + executor port.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  createFakeClock,
} from "@paykernel/testkit";
import {
  StoreLeaseLostError,
} from "@paykernel/store-contracts";
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

  it("SQL-1/SQL-2: offset dueAt is stored as Z and free due work is claimable (not in_progress)", async () => {
    // now = 12:00Z; due offset +05:00 at 14:00 wall = 09:00Z (due) but sorts after Z lexically.
    const clock = createFakeClock({
      initialMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const store = createSqliteReconciliationStore({ executor, clock });
    const s = await store.schedule({
      key: "job-offset",
      subjectId: "pay_off",
      reason: "timeout",
      dueAt: "2026-01-15T14:00:00+05:00",
    });
    expect(s.kind).toBe("scheduled");
    if (s.kind === "scheduled") {
      expect(s.record.dueAt).toBe("2026-01-15T09:00:00.000Z");
    }
    const c = await store.claim({
      key: "job-offset",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(c.kind).toBe("acquired");
  });

  it("SQL-2: legacy non-canonical due_at row repairs and claims (never stuck in_progress)", async () => {
    const clock = createFakeClock({
      initialMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const store = createSqliteReconciliationStore({ executor, clock });
    // Bypass schedule: insert offset due_at the way a pre-fix writer would.
    const dueOffset = "2026-01-15T14:00:00+05:00";
    const created = "2026-01-15T08:00:00.000Z";
    executor.run(
      `INSERT INTO payment_reconciliation_jobs (
         key, status, subject_id, reason, due_at,
         attempts, generation, created_at, updated_at
       ) VALUES (?, 'scheduled', ?, ?, ?, 0, 0, ?, ?)`,
      ["job-legacy", "pay_leg", "timeout", dueOffset, created, created],
    );
    // Pure Date.parse says due; lexical TEXT compare vs Z now would miss.
    expect(dueOffset <= new Date(clock.nowMs()).toISOString()).toBe(false);
    expect(Date.parse(dueOffset) < clock.nowMs()).toBe(true);

    const c = await store.claim({
      key: "job-legacy",
      owner: "w",
      leaseMs: 5_000,
    });
    expect(c.kind).toBe("acquired");
    if (c.kind === "acquired") {
      expect(c.record.dueAt).toBe("2026-01-15T09:00:00.000Z");
    }
  });

  it("SQL-1: free-lease fenced repair never overwrites active winner lease_expires_at", async () => {
    // Prove the repair WHERE fence itself refuses to mutate an active claim
    // (the race the unfenced UPDATE used to win under multi-host SQL).
    const clock = createFakeClock({
      initialMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const store = createSqliteReconciliationStore({ executor, clock });
    const dueOffset = "2026-01-15T14:00:00+05:00"; // due by Date.parse, non-Z
    const created = "2026-01-15T08:00:00.000Z";
    const winnerLease = "2026-01-15T12:05:00.000Z"; // active at now=12:00Z
    const now = new Date(clock.nowMs()).toISOString();
    executor.run(
      `INSERT INTO payment_reconciliation_jobs (
         key, status, subject_id, reason, due_at,
         lease_owner, lease_token, lease_expires_at,
         attempts, generation, created_at, updated_at
       ) VALUES (?, 'claimed', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [
        "job-active",
        "pay_act",
        "timeout",
        dueOffset,
        "winner",
        "lt_winner",
        winnerLease,
        created,
        created,
      ],
    );

    // Directly apply the fenced repair the claim path uses (stale null lease snapshot).
    const { reconciliationTimestampRepairTemplates } = await import(
      "@paykernel/sql-foundation"
    );
    const repairTpl = reconciliationTimestampRepairTemplates().sqlite;
    const repaired = executor.run(repairTpl.sql, [
      "2026-01-15T09:00:00.000Z",
      null,
      "job-active",
      now,
    ]);
    expect(repaired.changes).toBe(0);

    const c = await store.claim({
      key: "job-active",
      owner: "loser",
      leaseMs: 5_000,
    });
    // Active foreign lease → in_progress (not stolen).
    expect(c.kind).toBe("in_progress");
    const row = executor.query<Record<string, unknown>>(
      `SELECT lease_token, lease_expires_at, lease_owner, status, due_at
       FROM payment_reconciliation_jobs WHERE key = ?`,
      ["job-active"],
    )[0];
    expect(row?.lease_token).toBe("lt_winner");
    expect(row?.lease_expires_at).toBe(winnerLease);
    expect(row?.lease_owner).toBe("winner");
    expect(row?.status).toBe("claimed");
    expect(row?.due_at).toBe(dueOffset);
  });

  it("listDue rediscovers abandoned expired claims without prior get", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteReconciliationStore({ executor, clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    await store.schedule({
      key: "abandoned-job",
      subjectId: "pay_ab",
      reason: "indeterminate",
      dueAt,
    });
    const claimed = await store.claim({
      key: "abandoned-job",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;

    let listed = await store.listDue({ now: new Date(clock.nowMs()).toISOString() });
    expect(listed.find((r) => r.key === "abandoned-job")).toBeUndefined();

    clock.advance(2_000);
    listed = await store.listDue({ now: new Date(clock.nowMs()).toISOString() });
    const row = listed.find((r) => r.key === "abandoned-job");
    expect(row).toBeDefined();
    expect(row?.status).toBe("scheduled");
    // STORES-1: soft-release restores unfinished claim attempt (floor 0)
    expect(row?.attempts).toBe(0);
    expect(row?.leaseToken).toBeUndefined();
  });

  it("SQL-2: listDue with offset input.now still soft-releases and lists due Z rows", async () => {
    const clock = createFakeClock({
      initialMs: Date.parse("2026-01-15T12:00:00.000Z"),
    });
    const store = createSqliteReconciliationStore({ executor, clock });
    await store.schedule({
      key: "job-due-z",
      subjectId: "pay_z",
      reason: "timeout",
      dueAt: "2026-01-15T11:00:00.000Z",
    });
    // Offset form that is the same instant as clock now (12:00Z).
    const listed = await store.listDue({ now: "2026-01-15T17:00:00+05:00" });
    expect(listed.find((r) => r.key === "job-due-z")).toBeDefined();
  });

  it("markManualReview rejects expired lease with lease_lost", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteReconciliationStore({ executor, clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    await store.schedule({
      key: "manual-exp",
      subjectId: "pay_m",
      reason: "ambiguous",
      dueAt,
    });
    const claimed = await store.claim({
      key: "manual-exp",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;
    clock.advance(2_000);
    await expect(
      store.markManualReview({
        key: "manual-exp",
        leaseToken: claimed.leaseToken,
        note: "late",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    // Still reclaimable after expiry (not terminal).
    const again = await store.claim({
      key: "manual-exp",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("acquired");
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

  it("listRetryable surfaces abandoned expired claims after lease expiry", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const claimed = await store.claim({
      key: "abandoned-evt",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;

    // Still within lease — not listable (still claimed).
    let listed = await store.listRetryable({ now: new Date(clock.nowMs()).toISOString() });
    expect(listed.find((r) => r.key === "abandoned-evt")).toBeUndefined();

    clock.advance(2_000);
    listed = await store.listRetryable({ now: new Date(clock.nowMs()).toISOString() });
    const row = listed.find((r) => r.key === "abandoned-evt");
    expect(row).toBeDefined();
    expect(row?.status).toBe("pending");
    // WEBHOOKS-1: soft-release restores unfinished claim attempt
    expect(row?.attempts).toBe(0);
    expect(row?.leaseToken).toBeUndefined();

    const got = await store.get("abandoned-evt");
    expect(got?.status).toBe("pending");
  });

  it("claim blocks pending when availableAt is in the future", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const first = await store.claim({
      key: "backoff-evt",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    await store.fail({
      key: "backoff-evt",
      leaseToken: first.leaseToken,
      error: "transient",
      retryAfterMs: 60_000,
    });

    const blocked = await store.claim({
      key: "backoff-evt",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 5_000,
    });
    // SQL gate leaves row pending; adapter returns not_available (ClaimWebhookResult parity).
    expect(blocked.kind).toBe("not_available");
    if (blocked.kind === "not_available") {
      expect(blocked.record.status).toBe("pending");
      expect(blocked.record.attempts).toBe(1);
      expect(blocked.availableAt).toBe(blocked.record.availableAt);
    }

    clock.advance(60_000);
    const due = await store.claim({
      key: "backoff-evt",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(due.kind).toBe("acquired");
    if (due.kind === "acquired") {
      expect(due.record.attempts).toBe(2);
    }
  });

  it("fail restoreAttempt decrements attempts (parking claim parity)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const first = await store.claim({
      key: "park-evt",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.record.attempts).toBe(1);

    await store.fail({
      key: "park-evt",
      leaseToken: first.leaseToken,
      error: "ack_after_claim",
      retryAfterMs: 0,
      restoreAttempt: true,
    });

    const got = await store.get("park-evt");
    expect(got?.status).toBe("pending");
    expect(got?.attempts).toBe(0);

    const again = await store.claim({
      key: "park-evt",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("acquired");
    if (again.kind === "acquired") {
      expect(again.record.attempts).toBe(1);
    }
  });

  it("claim reclaims expired lease even if availableAt would still be future", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const first = await store.claim({
      key: "expire-reclaim",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;

    // Directly push available_at into the future while leaving claimed+short lease.
    // (recovery path: expired lease must reclaim regardless of available_at)
    executor.run(
      `UPDATE payment_webhook_inbox SET available_at = ? WHERE key = ?`,
      [new Date(clock.nowMs() + 86_400_000).toISOString(), "expire-reclaim"],
    );

    clock.advance(2_000);
    const reclaim = await store.claim({
      key: "expire-reclaim",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(reclaim.kind).toBe("acquired");
    if (reclaim.kind === "acquired") {
      expect(reclaim.leaseToken).not.toBe(first.leaseToken);
      expect(reclaim.record.generation).toBeGreaterThan(first.record.generation);
      // STORES-1/WEBHOOKS-1: expired claimed reclaim keeps attempts
      expect(reclaim.record.attempts).toBe(first.record.attempts);
    }
  });

  it("STORES-2: listRetryable canonicalizes offset input.now", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const claimed = await store.claim({
      key: "canon-now-evt",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 1_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") return;
    clock.advance(2_000);
    // Offset form of the advanced clock instant (14:00+02:00 == 12:00:02Z after advance)
    const offsetNow = "2026-01-15T14:00:02+02:00";
    const listed = await store.listRetryable({ now: offsetNow });
    const row = listed.find((r) => r.key === "canon-now-evt");
    expect(row).toBeDefined();
    expect(row?.status).toBe("pending");
    // Soft-release must write canonical Z available_at (not the offset form).
    expect(row?.availableAt).toBe("2026-01-15T12:00:02.000Z");
  });

  it("STORES-4: claim repairs non-canonical available_at and acquires", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const store = createSqliteWebhookInboxStore({ executor, clock });
    const first = await store.claim({
      key: "lex-avail",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 5_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    await store.fail({
      key: "lex-avail",
      leaseToken: first.leaseToken,
      error: "retry",
      retryAfterMs: 0,
    });
    // Due by Date.parse (09:00Z) but fails lexical TEXT compare vs Z now (12:00Z).
    executor.run(
      `UPDATE payment_webhook_inbox SET available_at = ? WHERE key = ?`,
      ["2026-01-15T14:00:00+05:00", "lex-avail"],
    );
    const again = await store.claim({
      key: "lex-avail",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 5_000,
    });
    expect(again.kind).toBe("acquired");
    if (again.kind === "acquired") {
      expect(again.record.availableAt).toBe("2026-01-15T12:00:00.000Z");
    }
  });

  it("STORES-1: listDue soft-release restores attempt; reclaim of claimed keeps attempts", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createSqliteReconciliationStore({ executor, clock });
    const dueAt = new Date(clock.nowMs()).toISOString();
    await store.schedule({
      key: "recon-thrash",
      subjectId: "pay_1",
      reason: "timeout",
      dueAt,
    });
    const c1 = await store.claim({
      key: "recon-thrash",
      owner: "w_dead",
      leaseMs: 1_000,
    });
    expect(c1.kind).toBe("acquired");
    if (c1.kind !== "acquired") return;
    expect(c1.record.attempts).toBe(1);

    clock.advance(2_000);
    const due = await store.listDue({ now: new Date(clock.nowMs()).toISOString() });
    const soft = due.find((r) => r.key === "recon-thrash");
    expect(soft?.status).toBe("scheduled");
    // Soft-release restored unfinished attempt.
    expect(soft?.attempts).toBe(0);

    const c2 = await store.claim({
      key: "recon-thrash",
      owner: "w_new",
      leaseMs: 1_000,
    });
    expect(c2.kind).toBe("acquired");
    if (c2.kind !== "acquired") return;
    expect(c2.record.attempts).toBe(1);

    // Direct reclaim of expired claimed (no soft-release) also keeps attempts.
    clock.advance(2_000);
    const c3 = await store.claim({
      key: "recon-thrash",
      owner: "w3",
      leaseMs: 5_000,
    });
    expect(c3.kind).toBe("acquired");
    if (c3.kind === "acquired") {
      expect(c3.record.attempts).toBe(1);
    }
  });

});
