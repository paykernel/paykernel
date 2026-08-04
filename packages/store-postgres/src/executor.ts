/**
 * Narrow PostgreSQL executor port.
 *
 * Preserves transaction + error semantics without pulling a full ORM.
 * Bound parameters only — never interpolate user values into SQL strings.
 */

import type { SqlExecutor } from "@paykernel/sql-foundation";

/**
 * Minimal async SQL port used by store factories and migrate helpers.
 *
 * Driver bindings (pg / postgres.js / Bun SQL) adapt client APIs to this shape.
 */
export type PostgresExecutor = {
  /**
   * Run a query that returns rows. Placeholders: `$1..$n`.
   * Params must be bound — never string-interpolated.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;

  /**
   * Run a statement; returns affected row count when known.
   */
  execute(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rowCount: number }>;

  /**
   * Optional transactional work unit. Nested transactions not required.
   * Store `withTransaction` uses this when present.
   */
  withTransaction?<T>(fn: (tx: PostgresExecutor) => Promise<T>): Promise<T>;
};

/**
 * Adapt {@link PostgresExecutor} to sql-store {@link SqlExecutor} for migrate/verify.
 */
export function toSqlStoreExecutor(executor: PostgresExecutor): SqlExecutor {
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
 * Type guard: object looks like a PostgresExecutor.
 */
export function isPostgresExecutor(value: unknown): value is PostgresExecutor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.query === "function" && typeof v.execute === "function";
}
