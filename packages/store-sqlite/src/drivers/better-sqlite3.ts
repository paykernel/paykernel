/**
 * better-sqlite3 binding — optional peer, isolated subpath only.
 *
 * Root package entry must never import `better-sqlite3`.
 * Uses synchronous prepared statements + IMMEDIATE transactions.
 * Enable safeIntegers when reading potentially large INTEGER columns.
 *
 * Native module may fail to load under Bun (Node ABI mismatch) — tests skip-clean.
 */

import Database from "better-sqlite3";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";
import type { SqliteExecutor } from "../executor";
import {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  createSqliteReconciliationStore,
  createSqliteStores,
} from "../index-stores";
import type { SqliteStoreOptions, SqliteStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import { applyRecommendedPragmas } from "../pragmas";
import { createTransactionScope } from "../transaction-scope";

/** Minimal better-sqlite3 Database surface (structural). */
export type BetterSqlite3Database = {
  prepare: (sql: string) => {
    all: (...params: never[]) => unknown[];
    get: (...params: never[]) => unknown;
    run: (...params: never[]) => { changes?: number | bigint };
  };
  exec: (sql: string) => void;
  pragma?: (source: string, options?: { simple?: boolean }) => unknown;
  close?: () => void;
  defaultSafeIntegers?: (toggle?: boolean) => void;
  /**
   * better-sqlite3 native transaction: returns callable with
   * `.immediate()` / `.exclusive()` / `.deferred()`.
   */
  transaction?: (
    fn: (...args: never[]) => unknown,
  ) => ((...args: never[]) => unknown) & {
    immediate?: (...args: never[]) => unknown;
    exclusive?: (...args: never[]) => unknown;
    deferred?: (...args: never[]) => unknown;
  };
};

function bindParams(params?: readonly unknown[]): never[] {
  return (params === undefined ? [] : [...params]) as never[];
}

function normalizeChanges(changes: number | bigint | undefined): number {
  if (typeof changes === "bigint") {
    if (
      changes >= BigInt(Number.MIN_SAFE_INTEGER) &&
      changes <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return Number(changes);
    }
    return Number(changes);
  }
  return typeof changes === "number" ? changes : 0;
}

/**
 * Adapt a better-sqlite3 Database to {@link SqliteExecutor}.
 *
 * Depth-tracked BEGIN IMMEDIATE so nested claim transactions join
 * runInTransaction / withTransaction (parity with better-sqlite3
 * `.transaction(fn).immediate()` for top-level claims, with safe nesting).
 */
export function createExecutorFromBetterSqlite3(
  db: BetterSqlite3Database,
): SqliteExecutor {
  if (typeof db.defaultSafeIntegers === "function") {
    try {
      db.defaultSafeIntegers(true);
    } catch {
      // optional — older builds may not expose this API
    }
  }

  const scope = createTransactionScope((sql) => db.exec(sql));

  return {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): T[] {
      const stmt = db.prepare(sql);
      return stmt.all(...bindParams(params)) as T[];
    },
    run(sql: string, params?: readonly unknown[]): { changes: number } {
      const stmt = db.prepare(sql);
      const result = stmt.run(...bindParams(params));
      return { changes: normalizeChanges(result?.changes) };
    },
    transaction: scope.transaction,
    runInTransaction: scope.runInTransaction,
  };
}

/** Preferred name matching Phase 14.3 target API. */
export const createBetterSqlite3Executor = createExecutorFromBetterSqlite3;

export type BetterSqlite3StoreOptions = {
  db: BetterSqlite3Database;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: BetterSqlite3StoreOptions): SqliteStoreOptions {
  const base: SqliteStoreOptions = {
    executor: createExecutorFromBetterSqlite3(opts.db),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createSqliteIdempotencyStoreFromBetterSqlite3(
  opts: BetterSqlite3StoreOptions,
) {
  return createSqliteIdempotencyStore(toOptions(opts));
}

export function createSqliteWebhookInboxStoreFromBetterSqlite3(
  opts: BetterSqlite3StoreOptions,
) {
  return createSqliteWebhookInboxStore(toOptions(opts));
}

export function createSqliteReconciliationStoreFromBetterSqlite3(
  opts: BetterSqlite3StoreOptions,
) {
  return createSqliteReconciliationStore(toOptions(opts));
}

export const createBetterSqlite3IdempotencyStore =
  createSqliteIdempotencyStoreFromBetterSqlite3;
export const createBetterSqlite3WebhookInboxStore =
  createSqliteWebhookInboxStoreFromBetterSqlite3;
export const createBetterSqlite3ReconciliationStore =
  createSqliteReconciliationStoreFromBetterSqlite3;

/**
 * Bundle three stores over better-sqlite3. Does **not** migrate.
 */
export function createBetterSqlite3Stores(
  opts: BetterSqlite3StoreOptions,
): SqliteStoresBundle {
  return createSqliteStores(toOptions(opts));
}

/**
 * Open a better-sqlite3 Database.
 * Does not migrate.
 */
export function openBetterSqlite3Database(
  path: string = ":memory:",
  options?: ConstructorParameters<typeof Database>[1],
): InstanceType<typeof Database> {
  return new Database(path, options);
}

/**
 * In-memory helper for tests when better-sqlite3 is installed.
 * Does **not** migrate.
 */
export function createInMemoryBetterSqlite3Executor(options?: {
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): {
  db: InstanceType<typeof Database>;
  executor: SqliteExecutor;
  close: () => void;
} {
  const db = openBetterSqlite3Database(":memory:");
  const executor = createExecutorFromBetterSqlite3(db);
  applyRecommendedPragmas(executor, {
    busyTimeoutMs: options?.busyTimeoutMs ?? 5_000,
    wal: false,
    foreignKeys: options?.foreignKeys !== false,
  });
  return {
    db,
    executor,
    close: () => db.close(),
  };
}

/**
 * In-memory stores helper. Does **not** migrate.
 */
export function createInMemoryBetterSqlite3Stores(options?: {
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): SqliteStoresBundle & {
  db: InstanceType<typeof Database>;
  close: () => void;
} {
  const db = openBetterSqlite3Database(":memory:");
  const storeOpts: BetterSqlite3StoreOptions = { db };
  if (options?.clock !== undefined) storeOpts.clock = options.clock;
  if (options?.namespace !== undefined) storeOpts.namespace = options.namespace;
  const stores = createBetterSqlite3Stores(storeOpts);
  applyRecommendedPragmas(stores.executor, {
    busyTimeoutMs: options?.busyTimeoutMs ?? 5_000,
    wal: false,
    foreignKeys: options?.foreignKeys !== false,
  });
  return {
    ...stores,
    db,
    close: () => db.close(),
  };
}

export {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
} from "../migrate";
export {
  SQLITE_STORAGE_ADAPTER_MANIFEST,
  getSqliteStorageAdapterManifest,
} from "../manifest";
export { applyRecommendedPragmas } from "../pragmas";
