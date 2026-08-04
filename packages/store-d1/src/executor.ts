/**
 * Narrow async D1 executor port (Workers Binding API).
 *
 * D1 is async — design matches TursoExecutor / PostgresExecutor, not local
 * SqliteExecutor sync transactions. Bound parameters only — never interpolate
 * user values into SQL strings. Placeholders: `?` (SQLite).
 *
 * Under the hood: prepare + bind + first/all/run; batch maps to db.batch().
 * Verified against Cloudflare D1 Workers Binding API (pin date in manifest notes).
 */

import type { SqlExecutor } from "@paykernel/sql-foundation";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./types";

/**
 * Minimal async SQL port used by store factories and migrate helpers.
 * Stores must depend only on this port (+ clock + namespace).
 */
export type D1Executor = {
  /**
   * Run a query that returns rows (SELECT, or write with RETURNING).
   * Placeholders: `?`. Params must be bound — never string-interpolated.
   *
   * Uses prepared statement `.all()` so UPSERT/UPDATE/DELETE … RETURNING rows
   * are available (plain writes without RETURNING yield empty results on D1).
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;

  /**
   * Execute a write; returns affected row count when known (via `.run()` meta).
   */
  execute(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ changes: number }>;

  /**
   * Multi-statement transactional batch via D1 `db.batch()`.
   * On statement failure D1 aborts/rolls back the entire sequence.
   * Prefer for multi-statement claims when single-statement UPSERT is not enough.
   */
  batch?(
    statements: Array<{ sql: string; params?: readonly unknown[] }>,
  ): Promise<void>;

  /**
   * Optional interactive write transaction for store `withTransaction`.
   *
   * Implemented with `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on the binding
   * connection (works with mock D1 / same-connection SQLite). Production D1
   * is auto-commit per statement; interactive BEGIN may be rejected — prefer
   * single-statement UPSERT or `batch()` for multi-statement atomicity on live D1.
   */
  transaction?<T>(fn: (tx: D1Executor) => Promise<T>): Promise<T>;

  /**
   * Optional: obtain a session-scoped executor (primary-first / bookmark).
   * Requires underlying D1Database.withSession.
   */
  withSession?(constraintOrBookmark?: string): D1Executor;
};

function prepareBound(
  db: D1DatabaseLike,
  sql: string,
  params?: readonly unknown[],
): D1PreparedStatementLike {
  let stmt = db.prepare(sql);
  if (params !== undefined && params.length > 0) {
    stmt = stmt.bind(...params);
  }
  return stmt;
}

/**
 * Create a narrow {@link D1Executor} over a Workers D1 binding (or mock).
 *
 * Does **not** migrate. Optional `session` wraps with `withSession` when present
 * (e.g. `"first-primary"` for read-after-write under D1 read replication).
 */
export function createD1Executor(
  db: D1DatabaseLike,
  options: { session?: string } = {},
): D1Executor {
  const active: D1DatabaseLike =
    options.session !== undefined && typeof db.withSession === "function"
      ? db.withSession(options.session)
      : db;

  function makeExecutor(target: D1DatabaseLike, nested: boolean): D1Executor {
    const executor: D1Executor = {
      async query<T = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> {
        const stmt = prepareBound(target, sql, params);
        const result = await stmt.all<T>();
        return (result.results ?? []) as T[];
      },

      async execute(
        sql: string,
        params?: readonly unknown[],
      ): Promise<{ changes: number }> {
        const stmt = prepareBound(target, sql, params);
        const result = await stmt.run();
        const changes =
          result.meta && typeof result.meta.changes === "number"
            ? result.meta.changes
            : 0;
        return { changes };
      },

      async batch(
        statements: Array<{ sql: string; params?: readonly unknown[] }>,
      ): Promise<void> {
        const prepared = statements.map((s) =>
          prepareBound(target, s.sql, s.params),
        );
        await target.batch(prepared);
      },
    };

    if (!nested) {
      // Interactive TX for store withTransaction (mock D1 / same-connection SQLite).
      // Live D1 prefers batch() / single-statement UPSERT — BEGIN may be rejected.
      executor.transaction = async <T>(
        fn: (tx: D1Executor) => Promise<T>,
      ): Promise<T> => {
        await prepareBound(target, "BEGIN IMMEDIATE").run();
        try {
          const result = await fn(makeExecutor(target, true));
          await prepareBound(target, "COMMIT").run();
          return result;
        } catch (err) {
          try {
            await prepareBound(target, "ROLLBACK").run();
          } catch {
            /* ignore rollback errors */
          }
          throw err;
        }
      };
    }

    if (typeof db.withSession === "function") {
      executor.withSession = (constraintOrBookmark?: string): D1Executor => {
        const sessionDb = db.withSession!(constraintOrBookmark);
        return createD1Executor(sessionDb);
      };
    }

    return executor;
  }

  return makeExecutor(active, false);
}

/**
 * Adapt {@link D1Executor} to sql-store {@link SqlExecutor} for migrate/verify.
 */
export function toSqlStoreExecutor(executor: D1Executor): SqlExecutor {
  return {
    execute: async (sql: string, params?: readonly unknown[]) => {
      return executor.execute(sql, params);
    },
    query: async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => {
      return executor.query<T>(sql, params);
    },
  };
}

/**
 * Type guard: object looks like a D1Executor.
 */
export function isD1Executor(value: unknown): value is D1Executor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.query === "function" && typeof v.execute === "function";
}

/**
 * Type guard: object looks like a structural D1Database binding.
 */
export function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.prepare === "function" && typeof v.batch === "function";
}
