/**
 * node-postgres (`pg`) binding — optional peer, isolated subpath only.
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

/** Minimal surface of `pg` Pool / Client used by the adapter. */
export type PgQueryable = {
  query: (
    text: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

export type PgPoolLike = PgQueryable & {
  connect?: () => Promise<
    PgQueryable & {
      release?: () => void;
      query: PgQueryable["query"];
    }
  >;
};

/**
 * Adapt a `pg` Pool or Client to {@link PostgresExecutor}.
 *
 * Alias: {@link createPgPostgresExecutor}.
 */
export function createExecutorFromPg(client: PgPoolLike): PostgresExecutor {
  const exec: PostgresExecutor = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const result = await client.query(sql, params as unknown[] | undefined);
      return result.rows as T[];
    },
    async execute(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rowCount: number }> {
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rowCount: result.rowCount ?? 0 };
    },
  };

  if (typeof client.connect === "function") {
    const pool = client;
    exec.withTransaction = async <T>(fn: (tx: PostgresExecutor) => Promise<T>) => {
      const conn = await pool.connect!();
      try {
        await conn.query("BEGIN");
        const txExec: PostgresExecutor = {
          async query<R = Record<string, unknown>>(
            sql: string,
            params?: readonly unknown[],
          ): Promise<R[]> {
            const result = await conn.query(sql, params as unknown[] | undefined);
            return result.rows as R[];
          },
          async execute(
            sql: string,
            params?: readonly unknown[],
          ): Promise<{ rowCount: number }> {
            const result = await conn.query(sql, params as unknown[] | undefined);
            return { rowCount: result.rowCount ?? 0 };
          },
        };
        try {
          const out = await fn(txExec);
          await conn.query("COMMIT");
          return out;
        } catch (err) {
          try {
            await conn.query("ROLLBACK");
          } catch {
            /* ignore rollback errors */
          }
          throw err;
        }
      } finally {
        conn.release?.();
      }
    };
  }

  return exec;
}

/** Preferred name for node-postgres → PostgresExecutor adapter. */
export const createPgPostgresExecutor = createExecutorFromPg;

export type PgStoreOptions = {
  client: PgPoolLike;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: PgStoreOptions): PostgresStoreOptions {
  const base: PostgresStoreOptions = {
    executor: createExecutorFromPg(opts.client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createPostgresIdempotencyStoreFromPg(opts: PgStoreOptions) {
  return createPostgresIdempotencyStore(toOptions(opts));
}

export function createPostgresWebhookInboxStoreFromPg(opts: PgStoreOptions) {
  return createPostgresWebhookInboxStore(toOptions(opts));
}

export function createPostgresReconciliationStoreFromPg(opts: PgStoreOptions) {
  return createPostgresReconciliationStore(toOptions(opts));
}

export function createPostgresStoresFromPg(opts: PgStoreOptions): PostgresStoresBundle {
  return createPostgresStores(toOptions(opts));
}

// Re-export migrate for convenient binding-local use.
export {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "../migrate";
export { POSTGRES_STORAGE_ADAPTER_MANIFEST, getPostgresStorageAdapterManifest } from "../manifest";
