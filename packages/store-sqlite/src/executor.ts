/**
 * Narrow synchronous SQLite executor port.
 *
 * Stores depend only on this shape — never on a specific driver type.
 * Bound parameters only — never interpolate user values into SQL strings.
 *
 * Transaction callbacks MUST be synchronous (no async/await inside).
 */

import type { SqlExecutor } from "@paykernel/internal-sql-store";

export type SqliteTransactionMode = "deferred" | "immediate" | "exclusive";

/**
 * Minimal sync SQL port used by store factories and migrate helpers.
 *
 * Driver bindings (bun:sqlite / node:sqlite / better-sqlite3) adapt client APIs
 * to this shape.
 */
export type SqliteExecutor = {
  /**
   * Run a query that returns rows. Placeholders: `?` (SQLite positional).
   * Params must be bound — never string-interpolated.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): T[];

  /**
   * Execute a write; returns affected row count when known.
   */
  run(sql: string, params?: readonly unknown[]): { changes: number };

  /**
   * Run `fn` inside a transaction. Prefer `{ mode: "immediate" }` for write claims.
   * `fn` MUST be synchronous (no Promise). Nested calls join the outer transaction
   * (no nested BEGIN — depth-tracked on the same connection).
   */
  transaction<T>(
    fn: () => T,
    options?: { mode?: SqliteTransactionMode },
  ): T;

  /**
   * Optional async-capable outer transaction for `withTransaction` helpers.
   * Nested sync {@link SqliteExecutor.transaction} calls must join this scope
   * so claim writes roll back with the outer unit of work.
   *
   * Still: do not await external I/O (provider HTTP) while holding the lock.
   */
  runInTransaction?<T>(
    fn: () => Promise<T> | T,
    options?: { mode?: SqliteTransactionMode },
  ): Promise<T>;
};

/**
 * Adapt {@link SqliteExecutor} to sql-store {@link SqlExecutor} for migrate/verify.
 * Wraps sync methods so async migrate() can await them.
 */
export function toSqlStoreExecutor(executor: SqliteExecutor): SqlExecutor {
  return {
    execute: (sql: string, params?: readonly unknown[]) => {
      const result = executor.run(sql, params);
      return Promise.resolve(result);
    },
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => {
      return Promise.resolve(executor.query<T>(sql, params));
    },
  };
}

/**
 * Type guard: object looks like a SqliteExecutor.
 */
export function isSqliteExecutor(value: unknown): value is SqliteExecutor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.query === "function" &&
    typeof v.run === "function" &&
    typeof v.transaction === "function"
  );
}
