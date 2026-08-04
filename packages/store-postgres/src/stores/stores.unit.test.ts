/**
 * Unit tests with a fake executor (no live PostgreSQL).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  StoreLeaseLostError,
  StoreUnavailableError,
} from "@paykernel/testkit";
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
});

describe("reconciliation store unit", () => {
  it("claim not_found when empty update and no row", async () => {
    const executor = createScriptedExecutor({ onQuery: () => [] });
    const store = createPostgresReconciliationStore({ executor });
    const r = await store.claim({ key: "missing", owner: "w", leaseMs: 1000 });
    expect(r.kind).toBe("not_found");
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
});
