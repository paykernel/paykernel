/**
 * postgres.js (`postgres`) binding — optional peer, isolated subpath only.
 */

import type { PostgresExecutor } from "../executor";
import {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
  createPostgresStores,
} from "../index-stores";
import type { PostgresStoreOptions, PostgresStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import type { SchemaNamespaceConfig } from "@paykernel/internal-sql-store";

/**
 * Minimal postgres.js SQL function shape.
 * Real clients: `const sql = postgres(url)` then `sql.unsafe(query, params)`.
 */
export type PostgresJsSql = {
  unsafe: <T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: readonly unknown[],
  ) => Promise<T[] | (T[] & { count?: number })>;
  begin?: <T>(fn: (sql: PostgresJsSql) => Promise<T>) => Promise<T>;
};

/**
 * Adapt a postgres.js client to {@link PostgresExecutor}.
 *
 * Alias: {@link createPostgresJsPostgresExecutor}.
 */
export function createExecutorFromPostgresJs(sql: PostgresJsSql): PostgresExecutor {
  const exec: PostgresExecutor = {
    async query<T = Record<string, unknown>>(
      query: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const rows = await sql.unsafe<T & Record<string, unknown>>(
        query,
        params as unknown[] | undefined,
      );
      return rows as T[];
    },
    async execute(
      query: string,
      params?: readonly unknown[],
    ): Promise<{ rowCount: number }> {
      const rows = await sql.unsafe(query, params as unknown[] | undefined);
      const count =
        typeof (rows as { count?: number }).count === "number"
          ? (rows as { count: number }).count
          : Array.isArray(rows)
            ? rows.length
            : 0;
      return { rowCount: count };
    },
  };

  if (typeof sql.begin === "function") {
    exec.withTransaction = async <T>(fn: (tx: PostgresExecutor) => Promise<T>) => {
      return sql.begin!(async (txSql) => {
        const txExec = createExecutorFromPostgresJs(txSql);
        return fn(txExec);
      });
    };
  }

  return exec;
}

/** Preferred name for postgres.js → PostgresExecutor adapter. */
export const createPostgresJsPostgresExecutor = createExecutorFromPostgresJs;

export type PostgresJsStoreOptions = {
  sql: PostgresJsSql;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: PostgresJsStoreOptions): PostgresStoreOptions {
  const base: PostgresStoreOptions = {
    executor: createExecutorFromPostgresJs(opts.sql),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createPostgresIdempotencyStoreFromPostgresJs(opts: PostgresJsStoreOptions) {
  return createPostgresIdempotencyStore(toOptions(opts));
}

export function createPostgresWebhookInboxStoreFromPostgresJs(opts: PostgresJsStoreOptions) {
  return createPostgresWebhookInboxStore(toOptions(opts));
}

export function createPostgresReconciliationStoreFromPostgresJs(opts: PostgresJsStoreOptions) {
  return createPostgresReconciliationStore(toOptions(opts));
}

export function createPostgresStoresFromPostgresJs(
  opts: PostgresJsStoreOptions,
): PostgresStoresBundle {
  return createPostgresStores(toOptions(opts));
}

export {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "../migrate";
export { POSTGRES_STORAGE_ADAPTER_MANIFEST, getPostgresStorageAdapterManifest } from "../manifest";
