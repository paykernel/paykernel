/**
 * Live PostgreSQL integration tests (env-gated).
 *
 * Env: PAYMENTS_SDK_PG_URL (preferred) or DATABASE_URL.
 * When unset: skip cleanly.
 *
 * Covers Stream B 12.4 items not in pure conformance:
 * - transaction rollback leaves no durable partial claim
 * - connection/unavailable error maps to StoreUnavailableError
 * - migrate empty → verify; second migrate idempotent
 * - stale lease token rejected (StoreLeaseLostError)
 * - multi-connection concurrent reserve (A1 multi-process evidence)
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock, StoreLeaseLostError, StoreUnavailableError } from "@paykernel/testkit";
import {
  createExecutorFromPostgresJs,
  createPostgresJsPostgresExecutor,
} from "./drivers/postgres-js";
import { createExecutorFromPg, createPgPostgresExecutor } from "./drivers/pg";
import {
  createPostgresIdempotencyStore,
  mapDriverError,
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "./index";
import {
  createNodePgPoolConfig,
  dropFoundationTablesSql,
  hasLivePostgres,
  PG_URL,
  uniqueTablePrefix,
} from "./test-utils/pg-env";

const live = hasLivePostgres();

describe.skipIf(!live)("integration: postgres-js primary binding", () => {
  it("transaction rollback: write then throw leaves no durable claim", async () => {
    const postgres = await import("postgres");
    const sql = postgres.default(PG_URL!, { max: 2 });
    const executor = createPostgresJsPostgresExecutor(sql);
    const prefix = uniqueTablePrefix("rb");
    try {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock();
      const store = createPostgresIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      expect(typeof executor.withTransaction).toBe("function");

      await expect(
        store.withTransaction(async () => {
          const r = await store.reserve({
            key: "tx_rollback_key",
            fingerprint: "fp",
            owner: "w1",
            leaseMs: 30_000,
          });
          expect(r.kind).toBe("acquired");
          throw new Error("force_rollback");
        }),
      ).rejects.toThrow(/force_rollback/);

      const got = await store.get("tx_rollback_key");
      expect(got).toBeUndefined();
    } finally {
      try {
        await sql.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sql.end({ timeout: 3 });
    }
  }, 60_000);

  it("stale lease token complete/fail rejected as StoreLeaseLostError", async () => {
    const postgres = await import("postgres");
    const sql = postgres.default(PG_URL!, { max: 2 });
    const executor = createExecutorFromPostgresJs(sql);
    const prefix = uniqueTablePrefix("st");
    try {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock();
      const store = createPostgresIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r1 = await store.reserve({
        key: "stale_tok",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(r1.kind).toBe("acquired");
      if (r1.kind !== "acquired") return;

      clock.advance(2_000);
      const r2 = await store.reserve({
        key: "stale_tok",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(r2.kind).toBe("acquired");
      if (r2.kind !== "acquired") return;

      await expect(
        store.complete({ key: "stale_tok", leaseToken: r1.leaseToken, result: {} }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await store.complete({
        key: "stale_tok",
        leaseToken: r2.leaseToken,
        result: { ok: true },
      });
      expect((await store.get("stale_tok"))?.status).toBe("completed");
    } finally {
      try {
        await sql.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sql.end({ timeout: 3 });
    }
  }, 60_000);

  it("migrate empty DB → verify ok; second migrate idempotent", async () => {
    const postgres = await import("postgres");
    const sql = postgres.default(PG_URL!, { max: 2 });
    const executor = createPostgresJsPostgresExecutor(sql);
    const prefix = uniqueTablePrefix("mig");
    try {
      const r1 = await migratePostgresAdapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(r1.currentVersion).toBeGreaterThanOrEqual(1);
      expect(r1.applied.length).toBeGreaterThan(0);

      const v = await verifyPostgresAdapterSchema(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(v.ok || v.missing.length === 0).toBe(true);

      const r2 = await migratePostgresAdapter(executor, {
        namespace: { tablePrefix: prefix },
      });
      expect(r2.applied).toEqual([]);
      expect(r2.alreadyApplied.length).toBeGreaterThan(0);
    } finally {
      try {
        await sql.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sql.end({ timeout: 3 });
    }
  }, 60_000);

  it("multi-connection concurrent reserve: exactly one acquired (A1)", async () => {
    const postgres = await import("postgres");
    // Two separate clients → ≥2 physical connections (not process mutex)
    const sqlA = postgres.default(PG_URL!, { max: 1 });
    const sqlB = postgres.default(PG_URL!, { max: 1 });
    const execA = createPostgresJsPostgresExecutor(sqlA);
    const execB = createPostgresJsPostgresExecutor(sqlB);
    const prefix = uniqueTablePrefix("mc");
    try {
      await migratePostgresAdapter(execA, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock();
      const storeA = createPostgresIdempotencyStore({
        executor: execA,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const storeB = createPostgresIdempotencyStore({
        executor: execB,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const key = `race_${Date.now()}`;
      const workers = 24;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) => {
          const store = i % 2 === 0 ? storeA : storeB;
          return store.reserve({
            key,
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          });
        }),
      );

      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
    } finally {
      try {
        await sqlA.unsafe(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await sqlA.end({ timeout: 3 });
      await sqlB.end({ timeout: 3 });
    }
  }, 60_000);

  it("connection refused / unavailable maps to StoreUnavailableError", async () => {
    // Unit-style mapping proof (always); plus real refused connect via bad port when practical.
    const mapped = mapDriverError(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
        code: "ECONNREFUSED",
      }),
    );
    expect(mapped).toBeInstanceOf(StoreUnavailableError);
    expect(mapped.code).toBe("unavailable");
    expect(mapped.retryable).toBe(true);

    const postgres = await import("postgres");
    // Intentionally bad port — should fail fast on connect/query
    const bad = postgres.default("postgres://127.0.0.1:1/nope", {
      max: 1,
      connect_timeout: 1,
    });
    const executor = createExecutorFromPostgresJs(bad);
    const store = createPostgresIdempotencyStore({ executor });
    try {
      await expect(
        store.reserve({
          key: "x",
          fingerprint: "fp",
          owner: "w",
          leaseMs: 1000,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });
    } finally {
      try {
        await bad.end({ timeout: 1 });
      } catch {
        /* ignore */
      }
    }
  }, 30_000);
});

describe.skipIf(!live)("integration: pg binding parity smoke", () => {
  it("pg executor runs migrate + single reserve/complete", async () => {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool(createNodePgPoolConfig({ max: 2 }));
    const executor = createPgPostgresExecutor(pool);
    const prefix = uniqueTablePrefix("pgb");
    try {
      await migratePostgresAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock();
      const store = createPostgresIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const r = await store.reserve({
        key: "pg_key",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;
      await store.complete({ key: "pg_key", leaseToken: r.leaseToken, result: { ok: 1 } });
      expect((await store.get("pg_key"))?.status).toBe("completed");

      // Transaction support on Pool
      expect(typeof executor.withTransaction).toBe("function");
      await expect(
        executor.withTransaction!(async (tx) => {
          await tx.execute(`SELECT 1`);
          throw new Error("pg_tx_rollback");
        }),
      ).rejects.toThrow(/pg_tx_rollback/);
    } finally {
      try {
        await pool.query(dropFoundationTablesSql(prefix));
      } catch {
        /* ignore */
      }
      await pool.end();
    }
  }, 60_000);

  it("createExecutorFromPg alias parity", async () => {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool(createNodePgPoolConfig({ max: 1 }));
    try {
      const a = createExecutorFromPg(pool);
      const b = createPgPostgresExecutor(pool);
      const rowsA = await a.query<{ n: number }>("SELECT 1::int AS n");
      const rowsB = await b.query<{ n: number }>("SELECT 1::int AS n");
      expect(rowsA[0]?.n).toBe(1);
      expect(rowsB[0]?.n).toBe(1);
    } finally {
      await pool.end();
    }
  }, 30_000);
});

describe.skipIf(live)("integration skipped without PG URL", () => {
  it("skip pattern documents env", () => {
    expect(PG_URL).toBeFalsy();
  });
});
