/**
 * Bun SQL binding — runtime-provided (`bun:sql`), isolated subpath only.
 *
 * Root package entry must never import `bun:sql`.
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
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";

/**
 * Minimal Bun SQL client surface (`new SQL(url)`).
 * Uses `.unsafe` / reserved call forms depending on Bun version.
 */
export type BunSqlClient = {
  /**
   * Execute raw SQL with bound params (preferred for prepared statements).
   * Bun SQL: `sql.unsafe(query, params)` or equivalent.
   */
  unsafe?: (
    query: string,
    params?: readonly unknown[],
  ) => Promise<Record<string, unknown>[] | { rows?: Record<string, unknown>[]; count?: number }>;
  /**
   * Some Bun SQL builds expose `.query` returning a helper with `.execute`.
   */
  query?: (
    strings: TemplateStringsArray | string,
    ...values: unknown[]
  ) => Promise<Record<string, unknown>[]>;
  begin?: <T>(fn: (tx: BunSqlClient) => Promise<T>) => Promise<T>;
  reserve?: () => Promise<BunSqlClient & { release?: () => Promise<void> | void }>;
};

async function runBunSql(
  client: BunSqlClient,
  sql: string,
  params?: readonly unknown[],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  if (typeof client.unsafe === "function") {
    const result = await client.unsafe(sql, params);
    if (Array.isArray(result)) {
      return { rows: result, rowCount: result.length };
    }
    const rows = result.rows ?? [];
    return {
      rows,
      rowCount: typeof result.count === "number" ? result.count : rows.length,
    };
  }
  // Fallback: tagged template is not used for bound $n style; require unsafe.
  throw new Error(
    "Bun SQL client must expose unsafe(query, params) for prepared $n statements",
  );
}

/**
 * Adapt a Bun SQL client to {@link PostgresExecutor}.
 *
 * Alias: {@link createBunSqlPostgresExecutor}.
 */
export function createExecutorFromBunSql(client: BunSqlClient): PostgresExecutor {
  const exec: PostgresExecutor = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const { rows } = await runBunSql(client, sql, params);
      return rows as T[];
    },
    async execute(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rowCount: number }> {
      const { rowCount } = await runBunSql(client, sql, params);
      return { rowCount };
    },
  };

  if (typeof client.begin === "function") {
    exec.withTransaction = async <T>(fn: (tx: PostgresExecutor) => Promise<T>) => {
      return client.begin!(async (txClient) => {
        const txExec = createExecutorFromBunSql(txClient);
        return fn(txExec);
      });
    };
  }

  return exec;
}

/** Preferred name for Bun SQL → PostgresExecutor adapter. */
export const createBunSqlPostgresExecutor = createExecutorFromBunSql;

export type BunSqlStoreOptions = {
  sql: BunSqlClient;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: BunSqlStoreOptions): PostgresStoreOptions {
  const base: PostgresStoreOptions = {
    executor: createExecutorFromBunSql(opts.sql),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createPostgresIdempotencyStoreFromBunSql(opts: BunSqlStoreOptions) {
  return createPostgresIdempotencyStore(toOptions(opts));
}

export function createPostgresWebhookInboxStoreFromBunSql(opts: BunSqlStoreOptions) {
  return createPostgresWebhookInboxStore(toOptions(opts));
}

export function createPostgresReconciliationStoreFromBunSql(opts: BunSqlStoreOptions) {
  return createPostgresReconciliationStore(toOptions(opts));
}

export function createPostgresStoresFromBunSql(
  opts: BunSqlStoreOptions,
): PostgresStoresBundle {
  return createPostgresStores(toOptions(opts));
}

export {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "../migrate";
export { POSTGRES_STORAGE_ADAPTER_MANIFEST, getPostgresStorageAdapterManifest } from "../manifest";
