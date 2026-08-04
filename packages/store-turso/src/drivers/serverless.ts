/**
 * `@tursodatabase/serverless` binding — optional peer, isolated subpath only.
 *
 * Fetch-based remote Turso Cloud client. Not interchangeable with `@libsql/client`.
 * Do not ship or advertise `/sync` or embedded-replica modes here.
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
import type { SchemaNamespaceConfig } from "@paykernel/internal-sql-store";

/**
 * Minimal surface of `@tursodatabase/serverless` Connection / Transaction.
 *
 * API (pinned docs @tursodatabase/serverless ~1.4.x):
 * - `all(sql, ...bind)` / `run(sql, ...bind)` one-shot
 * - `batch(statements, mode?)` with mode `"immediate"` for atomic write batch
 * - `transactionAsync(fn)` for interactive write transactions
 */
export type ServerlessConnectionLike = {
  all: (sql: string, ...bindParameters: unknown[]) => Promise<unknown[]>;
  run: (sql: string, ...bindParameters: unknown[]) => Promise<unknown>;
  batch?: (
    statements: Array<string | { sql: string; args?: unknown }>,
    mode?: string,
  ) => Promise<unknown>;
  transactionAsync?: (
    fn: (tx: ServerlessTransactionLike, ...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => Promise<unknown>;
  /** Deprecated sync-style wrapper; prefer transactionAsync when present. */
  transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
  close?: () => Promise<void> | void;
};

export type ServerlessTransactionLike = {
  all: ServerlessConnectionLike["all"];
  run: ServerlessConnectionLike["run"];
  prepare?: (sql: string) => Promise<{
    all: (...args: unknown[]) => Promise<unknown[]>;
    run: (...args: unknown[]) => Promise<unknown>;
  }>;
  batch?: ServerlessConnectionLike["batch"];
};

function changesFromRunResult(result: unknown): number {
  if (result === null || result === undefined) return 0;
  if (typeof result === "object") {
    const r = result as {
      changes?: unknown;
      rowsAffected?: unknown;
      meta?: { changes?: unknown };
    };
    if (typeof r.changes === "number") return r.changes;
    if (typeof r.rowsAffected === "number") return r.rowsAffected;
    if (typeof r.meta?.changes === "number") return r.meta.changes;
  }
  return 0;
}

function rowsFromAll(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    if (row === null || typeof row !== "object") return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (/^\d+$/.test(k)) continue;
      out[k] = v;
    }
    return out;
  });
}

function makeExecutorFromConnection(
  conn: Pick<ServerlessConnectionLike, "all" | "run">,
  withTxn?: TursoExecutor["transaction"],
  withBatch?: TursoExecutor["batch"],
): TursoExecutor {
  const exec: TursoExecutor = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const args = params ? [...params] : [];
      const rows = await conn.all(sql, ...args);
      return rowsFromAll(rows) as T[];
    },
    async execute(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ changes: number }> {
      const args = params ? [...params] : [];
      const result = await conn.run(sql, ...args);
      return { changes: changesFromRunResult(result) };
    },
  };
  if (withTxn) exec.transaction = withTxn;
  if (withBatch) exec.batch = withBatch;
  return exec;
}

/**
 * Adapt a `@tursodatabase/serverless` Connection to {@link TursoExecutor}.
 */
export function createExecutorFromServerless(
  connection: ServerlessConnectionLike,
): TursoExecutor {
  const withTxn: TursoExecutor["transaction"] | undefined =
    typeof connection.transactionAsync === "function"
      ? async <T>(fn: (tx: TursoExecutor) => Promise<T>): Promise<T> => {
          const wrapped = connection.transactionAsync!(async (txHandle) => {
            const txExec = makeExecutorFromConnection(txHandle);
            return fn(txExec);
          });
          // Prefer immediate write mode when the wrapper supports it.
          const maybeModes = wrapped as {
            ( ...args: unknown[]): Promise<T>;
            immediate?: () => Promise<T>;
            deferred?: () => Promise<T>;
          };
          if (typeof maybeModes.immediate === "function") {
            return maybeModes.immediate();
          }
          return maybeModes();
        }
      : undefined;

  const withBatch: TursoExecutor["batch"] | undefined =
    typeof connection.batch === "function"
      ? async (statements) => {
          await connection.batch!(
            statements.map((s) => ({
              sql: s.sql,
              args: s.params ? [...s.params] : [],
            })),
            "immediate",
          );
        }
      : undefined;

  return makeExecutorFromConnection(connection, withTxn, withBatch);
}

/** Preferred name for serverless → TursoExecutor adapter. */
export const createServerlessTursoExecutor = createExecutorFromServerless;

/**
 * Phase 15.1 public alias (docs / subpath examples).
 * @see createExecutorFromServerless
 */
export const createTursoServerlessExecutor = createExecutorFromServerless;

export type ServerlessStoreOptions = {
  /**
   * `@tursodatabase/serverless` Connection from `connect({ url, authToken })`.
   * Alias: `client`.
   */
  connection?: ServerlessConnectionLike;
  /** Alias for {@link ServerlessStoreOptions.connection}. */
  client?: ServerlessConnectionLike;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function resolveConnection(opts: ServerlessStoreOptions): ServerlessConnectionLike {
  const conn = opts.connection ?? opts.client;
  if (!conn) {
    throw new TypeError(
      "createTursoServerlessStores requires { connection } or { client } from @tursodatabase/serverless connect()",
    );
  }
  return conn;
}

function toOptions(opts: ServerlessStoreOptions): TursoStoreOptions {
  const base: TursoStoreOptions = {
    executor: createExecutorFromServerless(resolveConnection(opts)),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createTursoIdempotencyStoreFromServerless(
  opts: ServerlessStoreOptions,
) {
  return createTursoIdempotencyStore(toOptions(opts));
}

export function createTursoWebhookInboxStoreFromServerless(
  opts: ServerlessStoreOptions,
) {
  return createTursoWebhookInboxStore(toOptions(opts));
}

export function createTursoReconciliationStoreFromServerless(
  opts: ServerlessStoreOptions,
) {
  return createTursoReconciliationStore(toOptions(opts));
}

export function createTursoStoresFromServerless(
  opts: ServerlessStoreOptions,
): TursoStoresBundle {
  return createTursoStores(toOptions(opts));
}

/** Phase 15.1 public aliases matching package docs. */
export const createTursoServerlessIdempotencyStore =
  createTursoIdempotencyStoreFromServerless;
export const createTursoServerlessWebhookInboxStore =
  createTursoWebhookInboxStoreFromServerless;
export const createTursoServerlessReconciliationStore =
  createTursoReconciliationStoreFromServerless;
export const createTursoServerlessStores = createTursoStoresFromServerless;

export {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
} from "../migrate";
export {
  TURSO_STORAGE_ADAPTER_MANIFEST,
  getTursoStorageAdapterManifest,
} from "../manifest";
