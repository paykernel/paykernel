/**
 * bun:sqlite binding — runtime-provided, isolated subpath only.
 *
 * Root package entry must never import `bun:sqlite`.
 *
 * Uses prepared statements (`db.prepare` / `db.query`) and `BEGIN IMMEDIATE`
 * (or native `db.transaction` with immediate behavior) for claim paths.
 *
 * BigInt: `run()` normalizes `changes` to a safe integer Number (parity with
 * node:sqlite / better-sqlite3 bindings).
 */

import { Database } from "bun:sqlite";
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

/**
 * Minimal bun:sqlite Database surface used by this binding.
 * Structural — accepts real `Database` instances from `bun:sqlite`.
 */
export type BunSqliteDatabase = {
  /** Preferred prepared-statement API (Bun). */
  prepare?: (sql: string) => BunSqliteStatement;
  /** Cached prepare (Bun); used when `prepare` is absent. */
  query: (sql: string) => BunSqliteStatement;
  exec: (sql: string) => void;
  /**
   * Native transaction helper when present.
   * Bun: `db.transaction(fn)` returns callable with `.immediate()` / options.
   */
  transaction?: (
    fn: () => unknown,
    options?: { behavior?: string },
  ) => ((...args: never[]) => unknown) & {
    immediate?: (...args: never[]) => unknown;
    exclusive?: (...args: never[]) => unknown;
    deferred?: (...args: never[]) => unknown;
  };
  close?: () => void;
};

type BunSqliteStatement = {
  all: (...params: never[]) => unknown[];
  get: (...params: never[]) => unknown;
  run: (...params: never[]) => { changes?: number | bigint };
};

function normalizeChanges(changes: number | bigint | undefined): number {
  if (typeof changes === "bigint") {
    if (
      changes >= BigInt(Number.MIN_SAFE_INTEGER) &&
      changes <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return Number(changes);
    }
    // Extremely large change counts are not expected; clamp via Number.
    return Number(changes);
  }
  return typeof changes === "number" ? changes : 0;
}

function bindParams(params?: readonly unknown[]): never[] {
  return (params === undefined ? [] : [...params]) as never[];
}

function prepareStmt(db: BunSqliteDatabase, sql: string): BunSqliteStatement {
  // Prefer explicit prepare when available; fall back to query (cached prepare).
  if (typeof db.prepare === "function") {
    return db.prepare(sql);
  }
  return db.query(sql);
}

/**
 * Adapt a bun:sqlite Database to {@link SqliteExecutor}.
 *
 * Nested `transaction` / `runInTransaction` join the outer scope (depth counter)
 * so `withTransaction` + claim methods roll back together.
 *
 * Claim paths should call `transaction(fn, { mode: "immediate" })`.
 */
export function createExecutorFromBunSqlite(db: BunSqliteDatabase): SqliteExecutor {
  const scope = createTransactionScope((sql) => db.exec(sql));

  return {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): T[] {
      const stmt = prepareStmt(db, sql);
      const rows = stmt.all(...bindParams(params));
      return rows as T[];
    },
    run(sql: string, params?: readonly unknown[]): { changes: number } {
      const stmt = prepareStmt(db, sql);
      const result = stmt.run(...bindParams(params));
      return { changes: normalizeChanges(result?.changes) };
    },
    transaction: scope.transaction,
    runInTransaction: scope.runInTransaction,
  };
}

/** Preferred name matching Phase 14.1 target API. */
export const createBunSqliteExecutor = createExecutorFromBunSqlite;

export type BunSqliteStoreOptions = {
  db: BunSqliteDatabase;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: BunSqliteStoreOptions): SqliteStoreOptions {
  const base: SqliteStoreOptions = {
    executor: createExecutorFromBunSqlite(opts.db),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createSqliteIdempotencyStoreFromBun(opts: BunSqliteStoreOptions) {
  return createSqliteIdempotencyStore(toOptions(opts));
}

export function createSqliteWebhookInboxStoreFromBun(opts: BunSqliteStoreOptions) {
  return createSqliteWebhookInboxStore(toOptions(opts));
}

export function createSqliteReconciliationStoreFromBun(opts: BunSqliteStoreOptions) {
  return createSqliteReconciliationStore(toOptions(opts));
}

/** Preferred Phase 14.1 names. */
export const createBunSqliteIdempotencyStore = createSqliteIdempotencyStoreFromBun;
export const createBunSqliteWebhookInboxStore = createSqliteWebhookInboxStoreFromBun;
export const createBunSqliteReconciliationStore =
  createSqliteReconciliationStoreFromBun;

/**
 * Bundle three stores over a bun:sqlite Database. Does **not** migrate.
 */
export function createBunSqliteStores(opts: BunSqliteStoreOptions): SqliteStoresBundle {
  return createSqliteStores(toOptions(opts));
}

/**
 * Open a bun:sqlite Database (file or `:memory:`).
 * Does not migrate and does not apply pragmas by default.
 */
export function openBunSqliteDatabase(
  path: string = ":memory:",
  options?: { create?: boolean; readonly?: boolean },
): Database {
  const openOpts: { create?: boolean; readonly?: boolean } = {};
  if (options?.create !== undefined) openOpts.create = options.create;
  if (options?.readonly !== undefined) openOpts.readonly = options.readonly;
  return new Database(path, {
    create: openOpts.create ?? true,
    ...(openOpts.readonly !== undefined ? { readonly: openOpts.readonly } : {}),
  });
}

/**
 * In-memory test helper: open `:memory:`, optional recommended pragmas.
 * Does **not** migrate — call `migrateSqliteAdapter` explicitly.
 */
export function createInMemoryBunSqliteExecutor(options?: {
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): { db: Database; executor: SqliteExecutor; close: () => void } {
  const db = openBunSqliteDatabase(":memory:");
  const executor = createExecutorFromBunSqlite(db);
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
 * In-memory stores helper for tests. Does **not** migrate.
 * Call `migrateSqliteAdapter(bundle.executor)` before exercising stores.
 */
export function createInMemoryBunSqliteStores(options?: {
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): SqliteStoresBundle & { db: Database; close: () => void } {
  const db = openBunSqliteDatabase(":memory:");
  const storeOpts: BunSqliteStoreOptions = { db };
  if (options?.clock !== undefined) storeOpts.clock = options.clock;
  if (options?.namespace !== undefined) storeOpts.namespace = options.namespace;
  const stores = createBunSqliteStores(storeOpts);
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

/** Alias for {@link createInMemoryBunSqliteStores}. */
export const createBunSqliteStoresInMemory = createInMemoryBunSqliteStores;

export {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
} from "../migrate";
export {
  SQLITE_STORAGE_ADAPTER_MANIFEST,
  getSqliteStorageAdapterManifest,
} from "../manifest";
export { applyRecommendedPragmas } from "../pragmas";
