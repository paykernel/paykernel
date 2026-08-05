/**
 * Unit tests with a fake executor (no live PostgreSQL).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
} from "@paykernel/testkit";
import {
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreUnsupportedFeatureError,
} from "@paykernel/store-contracts";
import {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
} from "../index";
import type { PostgresExecutor } from "../executor";

type Row = Record<string, unknown>;

function createScriptedExecutor(handlers: {
  onQuery?: (sql: string, params: readonly unknown[]) => Row[] | Promise<Row[]>;
  onExecute?: (
    sql: string,
    params: readonly unknown[],
  ) => { rowCount: number } | Promise<{ rowCount: number }>;
}): PostgresExecutor & { calls: Array<{ sql: string; params: readonly unknown[] }> } {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return {
    calls,
    async query<T = Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push({ sql, params });
      const rows = (await handlers.onQuery?.(sql, params)) ?? [];
      return rows as T[];
    },
    async execute(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<{ rowCount: number }> {
      calls.push({ sql, params });
      return (await handlers.onExecute?.(sql, params)) ?? { rowCount: 0 };
    },
  };
}

describe("idempotency store unit (fake executor)", () => {
  it("complete with 0 rows throws StoreLeaseLostError", async () => {
    const executor = createScriptedExecutor({
      onQuery: () => [],
    });
    const store = createPostgresIdempotencyStore({ executor });
    await expect(
      store.complete({ key: "k", leaseToken: "tok", result: {} }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("renew returns lease_lost when update empty and row reserved", async () => {
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE")) return [];
        if (sql.includes("SELECT")) {
          return [
            {
              key: "k",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "w",
              lease_token: "other",
              lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
              attempts: 1,
              generation: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              result_json: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresIdempotencyStore({ executor });
    const r = await store.renew({ key: "k", leaseToken: "stale", leaseMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lease_lost");
  });

  it("reserve returns acquired when RETURNING row present", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const leaseTok = "lt_abc";
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) {
          return [
            {
              key: "k1",
              status: "reserved",
              fingerprint: "fp",
              lease_owner: "w1",
              lease_token: leaseTok,
              lease_expires_at: new Date(clock.nowMs() + 5000).toISOString(),
              attempts: 1,
              generation: 1,
              created_at: now,
              updated_at: now,
              result_json: null,
              inserted: true,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresIdempotencyStore({ executor, clock });
    const r = await store.reserve({
      key: "k1",
      fingerprint: "fp",
      owner: "w1",
      leaseMs: 5000,
    });
    expect(r.kind).toBe("acquired");
    if (r.kind === "acquired") {
      expect(r.record.generation).toBe(1);
      expect(r.leaseToken.length).toBeGreaterThan(0);
    }
    // Bound `now` param must come from clock (injectable)
    const insertCall = executor.calls.find((c) => c.sql.includes("INSERT"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain(now);
  });

  it("reserve classifies indeterminate when claim empty", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) return [];
        return [
          {
            key: "k",
            status: "indeterminate",
            fingerprint: "fp",
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
            attempts: 1,
            generation: 1,
            created_at: now,
            updated_at: now,
            result_json: null,
          },
        ];
      },
    });
    const store = createPostgresIdempotencyStore({ executor });
    const r = await store.reserve({
      key: "k",
      fingerprint: "fp",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("indeterminate");
  });

  it("reserve throws unavailable (not lease_lost) when claim and select both empty", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createPostgresIdempotencyStore({ executor });
    await expect(
      store.reserve({ key: "ghost", fingerprint: "fp", owner: "w", leaseMs: 1000 }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });
});

describe("webhook store unit", () => {
  it("fail with 0 rows → StoreLeaseLostError", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createPostgresWebhookInboxStore({ executor });
    await expect(
      store.fail({ key: "e", leaseToken: "t", error: "x" }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
  });

  it("listRetryable soft-releases expired claimed rows then selects pending", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onExecute: () => ({ rowCount: 1 }),
      onQuery: (sql) => {
        if (sql.includes("SELECT") && sql.includes("pending")) {
          return [
            {
              key: "abandoned",
              status: "pending",
              payload_hash: "h1",
              payload_ref: null,
              gateway: null,
              provider_event_id: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              available_at: now,
              first_received_at: now,
              last_received_at: now,
              completed_at: null,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresWebhookInboxStore({ executor, clock });
    const listed = await store.listRetryable({ now });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("abandoned");
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft?.sql.toLowerCase()).toContain("status = 'pending'");
    // WEBHOOKS-1: soft-release restores unfinished attempt
    expect(soft?.sql).toMatch(/attempts\s*=\s*CASE WHEN attempts > 0 THEN attempts - 1/i);
  });

  it("claim SQL template requires available_at for pending reclaim", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const future = new Date(clock.nowMs() + 60_000).toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT") || sql.includes("ON CONFLICT")) {
          // Simulate available_at gate: no reclaim
          return [];
        }
        if (sql.includes("SELECT")) {
          return [
            {
              key: "backoff",
              status: "pending",
              payload_hash: "h1",
              payload_ref: null,
              gateway: null,
              provider_event_id: null,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              available_at: future,
              first_received_at: now,
              last_received_at: now,
              completed_at: null,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresWebhookInboxStore({ executor, clock });
    const r = await store.claim({
      key: "backoff",
      payloadHash: "h1",
      owner: "w",
      leaseMs: 1000,
    });
    expect(r.kind).toBe("not_available");
    if (r.kind === "not_available") {
      expect(r.availableAt).toBe(future);
      expect(r.record.status).toBe("pending");
    }
    const claimCall = executor.calls.find((c) => c.sql.includes("ON CONFLICT"));
    expect(claimCall?.sql).toContain("available_at");
    expect(claimCall?.sql).toContain("status = 'pending'");
    expect(claimCall?.sql).toContain("status = 'claimed'");
    // WEBHOOKS-1: expired claimed reclaim keeps attempts; pending burns
    expect(claimCall?.sql).toMatch(
      /WHEN\s+"?[\w.]+"?\.status\s*=\s*'claimed'\s+THEN\s+"?[\w.]+"?\.attempts/i,
    );
    expect(claimCall?.sql).toContain("attempts + 1");
  });
});

describe("reconciliation store unit", () => {
  it("claim not_found when empty update and no row", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createPostgresReconciliationStore({ executor });
    const r = await store.claim({ key: "missing", owner: "w", leaseMs: 1000 });
    expect(r.kind).toBe("not_found");
  });

  it("SQL-2: claim miss for free due work repairs lexical due_at and acquires (not in_progress)", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    // Offset due that is due by Date.parse (09:00Z) but fails lexical TEXT vs Z now.
    const dueOffset = "2026-01-15T14:00:00+05:00";
    const dueZ = "2026-01-15T09:00:00.000Z";
    const now = new Date(clock.nowMs()).toISOString();
    let claimAttempts = 0;
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE") && sql.includes("status = 'claimed'")) {
          claimAttempts += 1;
          if (claimAttempts === 1) return [];
          // After canonicalize repair, claim succeeds.
          return [
            {
              key: "job-lex",
              status: "claimed",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: dueZ,
              lease_owner: "w",
              lease_token: "lt_repaired",
              lease_expires_at: new Date(clock.nowMs() + 1000).toISOString(),
              attempts: 1,
              generation: 1,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: dueZ,
              updated_at: now,
              completed_at: null,
            },
          ];
        }
        if (sql.includes("SELECT") && sql.includes("WHERE key")) {
          return [
            {
              key: "job-lex",
              status: "scheduled",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: dueOffset,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 0,
              generation: 0,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: dueZ,
              updated_at: dueZ,
              completed_at: null,
            },
          ];
        }
        return [];
      },
      onExecute: () => ({ rowCount: 1 }),
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    const r = await store.claim({ key: "job-lex", owner: "w", leaseMs: 1000 });
    expect(r.kind).toBe("acquired");
    expect(claimAttempts).toBe(2);
    const repair = executor.calls.find(
      (c) =>
        c.sql.includes("UPDATE") &&
        c.sql.includes("due_at") &&
        c.sql.includes("lease_expires_at") &&
        !c.sql.includes("status = 'claimed'"),
    );
    expect(repair).toBeDefined();
    // SQL-1: free-lease fence + now bind (key, dueAt, leaseExpiresAt, now)
    expect(repair!.sql).toContain("status = 'scheduled'");
    expect(repair!.sql).toMatch(/lease_expires_at IS NULL/i);
    expect(repair!.sql).toMatch(/lease_expires_at\s*<=/i);
    expect(repair!.params).toEqual(["job-lex", dueZ, null, now]);
  });

  it("SQL-1: timestamp repair free-lease fence does not steal active winner lease", async () => {
    // Race: first claim miss → classify claimable from free snapshot; concurrent
    // winner claims; repair must be free-lease fenced (0 rows); reselect → in_progress.
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const dueOffset = "2026-01-15T14:00:00+05:00";
    const dueZ = "2026-01-15T09:00:00.000Z";
    const now = new Date(clock.nowMs()).toISOString();
    const winnerLease = new Date(clock.nowMs() + 60_000).toISOString();
    let selectN = 0;
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("UPDATE") && sql.includes("status = 'claimed'")) {
          // Both claim attempts lose (winner already holds / still holds).
          return [];
        }
        if (sql.includes("SELECT") && sql.includes("WHERE key")) {
          selectN += 1;
          if (selectN === 1) {
            // Stale free snapshot that classifies as claimable.
            return [
              {
                key: "job-race",
                status: "scheduled",
                subject_id: "pay_1",
                reason: "timeout",
                due_at: dueOffset,
                lease_owner: null,
                lease_token: null,
                lease_expires_at: null,
                attempts: 0,
                generation: 0,
                last_error_sanitized: null,
                tenant_id: null,
                created_at: dueZ,
                updated_at: dueZ,
                completed_at: null,
              },
            ];
          }
          // After fenced repair (0 rows), winner is active.
          return [
            {
              key: "job-race",
              status: "claimed",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: dueZ,
              lease_owner: "winner",
              lease_token: "lt_winner",
              lease_expires_at: winnerLease,
              attempts: 1,
              generation: 1,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: dueZ,
              updated_at: now,
              completed_at: null,
            },
          ];
        }
        return [];
      },
      // Fenced repair matches 0 rows when lease is no longer free.
      onExecute: () => ({ rowCount: 0 }),
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    const r = await store.claim({ key: "job-race", owner: "loser", leaseMs: 1000 });
    expect(r.kind).toBe("in_progress");
    if (r.kind === "in_progress") {
      expect(r.record.leaseToken).toBe("lt_winner");
      expect(r.record.leaseExpiresAt).toBe(winnerLease);
    }
    const repair = executor.calls.find(
      (c) =>
        c.sql.includes("UPDATE") &&
        c.sql.includes("due_at") &&
        !c.sql.includes("status = 'claimed'"),
    );
    expect(repair).toBeDefined();
    expect(repair!.sql).toContain("status = 'scheduled'");
    expect(repair!.sql).toMatch(/lease_expires_at\s*<=/i);
    // Stale null lease must not be written without free-lease fence (params include now).
    expect(repair!.params).toEqual(["job-race", dueZ, null, now]);
  });

  it("SQL-1: schedule stores canonical Z dueAt", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql, params) => {
        if (sql.includes("INSERT")) {
          expect(params[3]).toBe("2026-01-15T09:00:00.000Z");
          return [
            {
              key: "job-z",
              status: "scheduled",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: params[3],
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 0,
              generation: 0,
              created_at: now,
              updated_at: now,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    const r = await store.schedule({
      key: "job-z",
      subjectId: "pay_1",
      reason: "timeout",
      dueAt: "2026-01-15T14:00:00+05:00",
    });
    expect(r.kind).toBe("scheduled");
    if (r.kind === "scheduled") {
      expect(r.record.dueAt).toBe("2026-01-15T09:00:00.000Z");
    }
  });

  it("schedule already_exists when insert returns empty", async () => {
    const now = new Date().toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        if (sql.includes("INSERT")) return [];
        return [
          {
            key: "job1",
            status: "scheduled",
            subject_id: "pay_1",
            reason: "timeout",
            due_at: now,
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
            attempts: 0,
            generation: 0,
            created_at: now,
            updated_at: now,
          },
        ];
      },
    });
    const store = createPostgresReconciliationStore({ executor });
    const r = await store.schedule({
      key: "job1",
      subjectId: "pay_1",
      reason: "timeout",
      dueAt: now,
    });
    expect(r.kind).toBe("already_exists");
  });

  it("listDue soft-releases expired claimed rows then selects scheduled", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onExecute: () => ({ rowCount: 1 }),
      onQuery: (sql) => {
        if (sql.includes("SELECT") && sql.includes("scheduled")) {
          return [
            {
              key: "abandoned-job",
              status: "scheduled",
              subject_id: "pay_1",
              reason: "timeout",
              due_at: now,
              lease_owner: null,
              lease_token: null,
              lease_expires_at: null,
              attempts: 1,
              generation: 1,
              last_error_sanitized: null,
              tenant_id: null,
              created_at: now,
              updated_at: now,
              completed_at: null,
            },
          ];
        }
        return [];
      },
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    const listed = await store.listDue({ now });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe("abandoned-job");
    const soft = executor.calls.find(
      (c) =>
        c.sql.includes("status = 'claimed'") &&
        c.sql.includes("lease_expires_at") &&
        c.sql.toLowerCase().includes("status = 'scheduled'"),
    );
    expect(soft).toBeDefined();
  });

  it("SQL-2: listDue canonicalizes offset input.now for TEXT lexical compares", async () => {
    const clock = createFakeClock({ initialMs: Date.parse("2026-01-15T12:00:00.000Z") });
    const offsetNow = "2026-01-15T17:00:00+05:00"; // same instant as 12:00Z
    const canonicalNow = "2026-01-15T12:00:00.000Z";
    const executor = createScriptedExecutor({
      onExecute: () => ({ rowCount: 0 }),
      onQuery: () => [],
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    await store.listDue({ now: offsetNow, limit: 10 });
    const soft = executor.calls.find(
      (c) => c.sql.includes("status = 'claimed'") && c.sql.includes("lease_expires_at"),
    );
    expect(soft).toBeDefined();
    expect(soft!.params[0]).toBe(canonicalNow);
    const select = executor.calls.find(
      (c) => c.sql.includes("SELECT") && c.sql.includes("due_at <="),
    );
    expect(select).toBeDefined();
    expect(select!.params[0]).toBe(canonicalNow);
  });

  it("markManualReview requires active lease (expired → lease_lost)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const executor = createScriptedExecutor({
      onQuery: (sql) => {
        // No row updated (expired lease fence).
        if (sql.includes("UPDATE") && sql.includes("manual_review")) return [];
        return [];
      },
    });
    const store = createPostgresReconciliationStore({ executor, clock });
    await expect(
      store.markManualReview({
        key: "job-exp",
        leaseToken: "stale",
        note: "review",
      }),
    ).rejects.toBeInstanceOf(StoreLeaseLostError);
    const call = executor.calls.find(
      (c) => c.sql.includes("manual_review") && c.sql.includes("UPDATE"),
    );
    expect(call).toBeDefined();
    expect(call!.sql).toContain("lease_expires_at");
    expect(call!.sql).toContain("lease_expires_at >");
    expect(call!.params).toContain(now);
  });
});

describe("withTransaction honesty (SHARED-1)", () => {
  it("fails closed when executor lacks withTransaction (no silent no-op)", async () => {
    const executor = createScriptedExecutor({});
    expect(executor.withTransaction).toBeUndefined();
    const store = createPostgresIdempotencyStore({ executor });
    await expect(
      store.withTransaction(async () => "should-not-run"),
    ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
    await expect(
      store.withTransaction(async () => "should-not-run"),
    ).rejects.toThrow(/refusing silent no-op/i);
  });

  it("uses executor.withTransaction when present", async () => {
    const executor = createScriptedExecutor({});
    let nested = false;
    executor.withTransaction = async <T>(fn: (tx: typeof executor) => Promise<T>) => {
      nested = true;
      return fn(executor);
    };
    const store = createPostgresIdempotencyStore({ executor });
    const out = await store.withTransaction(async () => "ok");
    expect(out).toBe("ok");
    expect(nested).toBe(true);
  });
});
