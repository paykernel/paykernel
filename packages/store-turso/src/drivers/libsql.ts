/**
 * `@libsql/client` binding — optional peer, isolated subpath only.
 *
 * Supports remote libSQL/Turso URLs and local `file:` / `:memory:` for CI.
 * Do not advertise embedded-replica / sync as true local-first multi-writer.
 */

import type { TursoExecutor } from "../executor";
import {
  createTursoIdempotencyStore,
  createTursoWebhookInboxStore,
  createTursoReconciliationStore,
  createTursoStores,
} from "../index-stores";
import type { TursoStoreOptions, TursoStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";

/** Minimal surface of `@libsql/client` Client used by the adapter. */
export type LibsqlClientLike = {
  execute: (
    stmt:
      | string
      | {
          sql: string;
          args?: readonly unknown[] | Record<string, unknown>;
        },
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowsAffected: number;
  }>;
  batch?: (
    stmts: Array<
      | string
      | {
          sql: string;
          args?: readonly unknown[] | Record<string, unknown>;
        }
    >,
    mode?: string,
  ) => Promise<unknown>;
  /**
   * Interactive write transaction (required for remote HTTP/WebSocket).
   * Remote clients open a new stream per `execute()` — bare BEGIN/COMMIT
   * on sequential client.execute calls do NOT form one transaction.
   */
  transaction?: (mode?: string) => Promise<LibsqlTransactionLike>;
  /**
   * libSQL protocol: `"http"` | `"ws"` | `"file"` (local embedded).
   * Used to choose interactive vs same-connection BEGIN IMMEDIATE.
   */
  protocol?: string;
  close?: () => void;
};

/**
 * Remote HTTP/WebSocket needs interactive `client.transaction()`.
 * Local embedded (`file` / `:memory:`) must use same-connection BEGIN IMMEDIATE:
 * libsql's local `transaction()` detaches the main DB handle and opens a new
 * empty connection for later client ops (breaks :memory: schema visibility).
 */
function preferInteractiveTransaction(client: LibsqlClientLike): boolean {
  if (typeof client.transaction !== "function") return false;
  const protocol = (client.protocol ?? "").toLowerCase();
  return protocol === "http" || protocol === "ws" || protocol === "wss";
}

export type LibsqlTransactionLike = {
  execute: LibsqlClientLike["execute"];
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  close?: () => void;
};

function rowObjects(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  // libSQL Row is array-like with named props; keep named columns only.
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (/^\d+$/.test(key)) continue;
      out[key] = row[key];
    }
    return out;
  });
}

function makeExecutorFromQueryable(
  client: Pick<LibsqlClientLike, "execute">,
  withTxn?: TursoExecutor["transaction"],
  withBatch?: TursoExecutor["batch"],
): TursoExecutor {
  const exec: TursoExecutor = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const result = await client.execute({
        sql,
        args: params ? [...params] : [],
      });
      return rowObjects(result.rows) as T[];
    },
    async execute(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ changes: number }> {
      const result = await client.execute({
        sql,
        args: params ? [...params] : [],
      });
      return { changes: result.rowsAffected ?? 0 };
    },
  };
  if (withTxn) exec.transaction = withTxn;
  if (withBatch) exec.batch = withBatch;
  return exec;
}

/**
 * Adapt a `@libsql/client` Client to {@link TursoExecutor}.
 *
 * - Remote (`http`/`ws`): `client.transaction("write")` so all statements share
 *   one stream (required for real multi-statement rollback over HTTP).
 * - Local embedded (`file`/`:memory:`): BEGIN IMMEDIATE on the same connection
 *   (libsql local `transaction()` detaches the primary DB handle).
 *
 * Nested transactions join the outer scope.
 * Do not share one client across concurrent interactive write transactions.
 */
export function createExecutorFromLibsql(client: LibsqlClientLike): TursoExecutor {
  let txDepth = 0;
  /** Active execute surface inside a transaction (interactive txn or client). */
  let activeQueryable: Pick<LibsqlClientLike, "execute"> = client;

  const withTxn: TursoExecutor["transaction"] = async <T>(
    fn: (tx: TursoExecutor) => Promise<T>,
  ): Promise<T> => {
    if (txDepth > 0) {
      // Join outer transaction (same stream / connection).
      return fn(makeExecutorFromQueryable(activeQueryable));
    }
    txDepth += 1;
    try {
      // Remote-correct path: interactive transaction on one stream.
      if (preferInteractiveTransaction(client)) {
        const txn = await client.transaction!("write");
        const prev = activeQueryable;
        activeQueryable = txn;
        try {
          const txExec = makeExecutorFromQueryable(txn);
          try {
            const out = await fn(txExec);
            await txn.commit();
            return out;
          } catch (err) {
            try {
              await txn.rollback();
            } catch {
              /* ignore rollback errors */
            }
            throw err;
          }
        } finally {
          activeQueryable = prev;
          try {
            txn.close?.();
          } catch {
            /* ignore close errors */
          }
        }
      }

      // Local embedded path: same-connection BEGIN IMMEDIATE.
      await client.execute("BEGIN IMMEDIATE");
      try {
        const txExec = makeExecutorFromQueryable(client);
        const out = await fn(txExec);
        await client.execute("COMMIT");
        return out;
      } catch (err) {
        try {
          await client.execute("ROLLBACK");
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      }
    } finally {
      txDepth -= 1;
    }
  };

  const withBatch: TursoExecutor["batch"] | undefined =
    typeof client.batch === "function"
      ? async (statements) => {
          if (txDepth > 0) {
            // Already in a transaction: run on the active stream sequentially.
            for (const s of statements) {
              await activeQueryable.execute({
                sql: s.sql,
                args: s.params ? [...s.params] : [],
              });
            }
            return;
          }
          await client.batch!(
            statements.map((s) => ({
              sql: s.sql,
              args: s.params ? [...s.params] : [],
            })),
            "write",
          );
        }
      : undefined;

  return makeExecutorFromQueryable(client, withTxn, withBatch);
}

/** Preferred name for libSQL → TursoExecutor adapter. */
export const createLibsqlTursoExecutor = createExecutorFromLibsql;

/**
 * Phase 15.2 public alias (docs / subpath examples).
 * @see createExecutorFromLibsql
 */
export const createLibsqlExecutor = createExecutorFromLibsql;

export type LibsqlStoreOptions = {
  /**
   * `@libsql/client` Client from `createClient({ url, authToken? })`.
   * Supports remote (`libsql://`, `https://`) and local (`file:`, `:memory:`).
   */
  client: LibsqlClientLike;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: LibsqlStoreOptions): TursoStoreOptions {
  const base: TursoStoreOptions = {
    executor: createExecutorFromLibsql(opts.client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createTursoIdempotencyStoreFromLibsql(opts: LibsqlStoreOptions) {
  return createTursoIdempotencyStore(toOptions(opts));
}

export function createTursoWebhookInboxStoreFromLibsql(opts: LibsqlStoreOptions) {
  return createTursoWebhookInboxStore(toOptions(opts));
}

export function createTursoReconciliationStoreFromLibsql(opts: LibsqlStoreOptions) {
  return createTursoReconciliationStore(toOptions(opts));
}

export function createTursoStoresFromLibsql(opts: LibsqlStoreOptions): TursoStoresBundle {
  return createTursoStores(toOptions(opts));
}

/** Phase 15.2 public aliases matching package docs. */
export const createLibsqlIdempotencyStore = createTursoIdempotencyStoreFromLibsql;
export const createLibsqlWebhookInboxStore = createTursoWebhookInboxStoreFromLibsql;
export const createLibsqlReconciliationStore =
  createTursoReconciliationStoreFromLibsql;
export const createLibsqlStores = createTursoStoresFromLibsql;

export {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
} from "../migrate";
export {
  TURSO_STORAGE_ADAPTER_MANIFEST,
  getTursoStorageAdapterManifest,
} from "../manifest";
