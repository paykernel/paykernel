/**
 * node:sqlite binding — isolated subpath only (`DatabaseSync`).
 *
 * Supported Node lines (keep updated in docs/drivers.md + NODE_SQLITE_SUPPORT):
 * - Node.js 22.5+ : `node:sqlite` experimental (`DatabaseSync`)
 * - Node.js 23.x  : experimental (stability may change per minor)
 * - Node.js 24+ / 25+ : still verify release notes; treat as optional subpath
 *
 * Root package entry must never import `node:sqlite`.
 *
 * BigInt: prefer reading integers as JS number when within safe range;
 * store layer normalizes bigint fields from rows.
 */

import { DatabaseSync } from "node:sqlite";
import type { SchemaNamespaceConfig } from "@paykernel/internal-sql-store";
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

/** Minimal node:sqlite DatabaseSync surface (structural). */
export type NodeSqliteDatabase = {
  prepare: (sql: string) => {
    all: (...params: never[]) => unknown[];
    get: (...params: never[]) => unknown;
    run: (...params: never[]) => { changes?: number | bigint; lastInsertRowid?: number | bigint };
  };
  exec: (sql: string) => void;
  close?: () => void;
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
    // Extremely large change counts are not expected; clamp via Number.
    return Number(changes);
  }
  return typeof changes === "number" ? changes : 0;
}

/**
 * Adapt a node:sqlite DatabaseSync to {@link SqliteExecutor}.
 *
 * Uses prepared statements (`db.prepare`) and `BEGIN IMMEDIATE` for write claims.
 */
export function createExecutorFromNodeSqlite(db: NodeSqliteDatabase): SqliteExecutor {
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

/** Preferred name matching Phase 14.2 target API. */
export const createNodeSqliteExecutor = createExecutorFromNodeSqlite;

export type NodeSqliteStoreOptions = {
  db: NodeSqliteDatabase;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: NodeSqliteStoreOptions): SqliteStoreOptions {
  const base: SqliteStoreOptions = {
    executor: createExecutorFromNodeSqlite(opts.db),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

export function createSqliteIdempotencyStoreFromNode(opts: NodeSqliteStoreOptions) {
  return createSqliteIdempotencyStore(toOptions(opts));
}

export function createSqliteWebhookInboxStoreFromNode(opts: NodeSqliteStoreOptions) {
  return createSqliteWebhookInboxStore(toOptions(opts));
}

export function createSqliteReconciliationStoreFromNode(opts: NodeSqliteStoreOptions) {
  return createSqliteReconciliationStore(toOptions(opts));
}

export const createNodeSqliteIdempotencyStore = createSqliteIdempotencyStoreFromNode;
export const createNodeSqliteWebhookInboxStore = createSqliteWebhookInboxStoreFromNode;
export const createNodeSqliteReconciliationStore =
  createSqliteReconciliationStoreFromNode;

/**
 * Bundle three stores over node:sqlite DatabaseSync. Does **not** migrate.
 */
export function createNodeSqliteStores(opts: NodeSqliteStoreOptions): SqliteStoresBundle {
  return createSqliteStores(toOptions(opts));
}

/**
 * Open a node:sqlite DatabaseSync.
 * Does not migrate.
 */
export function openNodeSqliteDatabase(
  path: string = ":memory:",
  options?: { open?: boolean; readOnly?: boolean },
): DatabaseSync {
  return new DatabaseSync(path, {
    open: options?.open ?? true,
    ...(options?.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
  } as ConstructorParameters<typeof DatabaseSync>[1]);
}

/**
 * In-memory helper for tests when node:sqlite is available.
 * Does **not** migrate.
 */
export function createInMemoryNodeSqliteExecutor(options?: {
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): { db: DatabaseSync; executor: SqliteExecutor; close: () => void } {
  const db = openNodeSqliteDatabase(":memory:");
  const executor = createExecutorFromNodeSqlite(db);
  applyRecommendedPragmas(executor, {
    busyTimeoutMs: options?.busyTimeoutMs ?? 5_000,
    wal: false,
    foreignKeys: options?.foreignKeys !== false,
  });
  return {
    db,
    executor,
    close: () => {
      if (typeof db.close === "function") db.close();
    },
  };
}

/**
 * In-memory stores helper. Does **not** migrate.
 */
export function createInMemoryNodeSqliteStores(options?: {
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
}): SqliteStoresBundle & { db: DatabaseSync; close: () => void } {
  const db = openNodeSqliteDatabase(":memory:");
  const storeOpts: NodeSqliteStoreOptions = { db };
  if (options?.clock !== undefined) storeOpts.clock = options.clock;
  if (options?.namespace !== undefined) storeOpts.namespace = options.namespace;
  const stores = createNodeSqliteStores(storeOpts);
  applyRecommendedPragmas(stores.executor, {
    busyTimeoutMs: options?.busyTimeoutMs ?? 5_000,
    wal: false,
    foreignKeys: options?.foreignKeys !== false,
  });
  return {
    ...stores,
    db,
    close: () => {
      if (typeof db.close === "function") db.close();
    },
  };
}

/**
 * Documented Node version matrix for node:sqlite support.
 * Keep in sync with docs/drivers.md and package README.
 */
export const NODE_SQLITE_SUPPORT = {
  minimumNode: "22.5.0",
  module: "node:sqlite",
  api: "DatabaseSync",
  stability: "experimental (check Node release notes per major line)",
  matrix: [
    {
      node: "22.5.x – 22.x",
      status: "experimental",
      notes: "DatabaseSync introduced; enable with caution in production.",
    },
    {
      node: "23.x",
      status: "experimental",
      notes: "Still experimental; confirm flags / docs for the exact minor.",
    },
    {
      node: "24.x / 25.x+",
      status: "experimental (verify current release notes)",
      notes:
        "Module remains optional and isolated; prefer better-sqlite3 until stable.",
    },
  ],
  notes: [
    "Isolated to @paykernel/store-sqlite/node only.",
    "Not part of the portable core runtime baseline.",
    "Prefer better-sqlite3 for mature Node production until node:sqlite is stable.",
    "BigInt column values are normalized in the store layer (safe number or string).",
  ],
} as const;

export {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
} from "../migrate";
export {
  SQLITE_STORAGE_ADAPTER_MANIFEST,
  getSqliteStorageAdapterManifest,
} from "../manifest";
export { applyRecommendedPragmas } from "../pragmas";
