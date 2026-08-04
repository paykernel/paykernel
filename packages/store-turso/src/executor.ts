/**
 * Narrow async Turso / libSQL executor port.
 *
 * Remote clients are asynchronous — design matches PostgresExecutor, not
 * local SqliteExecutor sync transactions. Bound parameters only — never
 * interpolate user values into SQL strings. Placeholders: `?` (SQLite).
 */

import type { SqlExecutor } from "@paykernel/sql-foundation";

/**
 * Minimal async SQL port used by store factories and migrate helpers.
 *
 * Driver bindings (`@tursodatabase/serverless` / `@libsql/client`) adapt
 * client APIs to this shape. Stores must depend only on this port.
 */
export type TursoExecutor = {
  /**
   * Run a query that returns rows. Placeholders: `?`.
   * Params must be bound — never string-interpolated.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;

  /**
   * Execute a write; returns affected row count when known.
   */
  execute(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ changes: number }>;

  /**
   * Optional: run `fn` inside one write transaction.
   * Required when multi-statement claims cannot be reduced to single-statement UPSERT.
   * Nested transactions are not required.
   */
  transaction?<T>(fn: (tx: TursoExecutor) => Promise<T>): Promise<T>;

  /**
   * Optional: run multiple statements in one transactional write batch.
   * Prefer when the driver offers atomic batch (libSQL `batch(..., "write")`,
   * serverless `batch(..., "immediate")`).
   */
  batch?(
    statements: Array<{ sql: string; params?: readonly unknown[] }>,
  ): Promise<void>;
};

/**
 * Adapt {@link TursoExecutor} to sql-store {@link SqlExecutor} for migrate/verify.
 */
export function toSqlStoreExecutor(executor: TursoExecutor): SqlExecutor {
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
 * Type guard: object looks like a TursoExecutor.
 */
export function isTursoExecutor(value: unknown): value is TursoExecutor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.query === "function" && typeof v.execute === "function";
}
