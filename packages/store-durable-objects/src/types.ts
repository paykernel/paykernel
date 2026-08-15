/**
 * Structural Durable Object / SqlStorage types + store options.
 *
 * Consumers pass `env.PAYMENTS_DO` (or mocks) without this package importing
 * `cloudflare:workers`. Optional peer `@cloudflare/workers-types` improves DX.
 *
 * Verified against Cloudflare Durable Objects SQLite storage API docs (2026-08-03):
 * https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
 */

import type {
  ResolvedSchemaNamespace,
  SchemaNamespaceConfig,
} from "@paykernel/sql-foundation";
import type { StoreClock } from "./clock";
import type { DoExecutor } from "./sql-executor";
import type { DoShardingStrategy } from "./sharding";

export type { StoreClock } from "./clock";
export type { DoExecutor } from "./sql-executor";
export type { SchemaNamespaceConfig, ResolvedSchemaNamespace };

/**
 * Minimal cursor surface from `storage.sql.exec(...)`.
 * Callers MUST fully consume the cursor (e.g. `.toArray()`) before any await.
 */
export type SqlStorageCursorLike = {
  toArray(): Record<string, unknown>[];
  one?(): Record<string, unknown> | null;
};

/**
 * Sync SQLite storage API on a SQLite-backed Durable Object (`new_sqlite_classes`).
 * Placeholders: `?` with bound parameters — never string-interpolate user values.
 */
export type SqlStorageLike = {
  exec(query: string, ...bindings: unknown[]): SqlStorageCursorLike;
};

/**
 * Durable Object storage surface used by in-object stores.
 *
 * - `sql` / `transactionSync` are required for claims.
 * - Alarm methods are optional (17.4); default-off.
 *
 * `transactionSync` callbacks MUST be synchronous (no await / fetch).
 */
export type DoStorageLike = {
  sql: SqlStorageLike;
  transactionSync<T>(callback: () => T): T;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
  getAlarm?(): Promise<number | null>;
  deleteAlarm?(): Promise<void>;
};

/**
 * Structural DO stub RPC surface (Worker → DO). Methods return promises.
 * Production stubs come from `namespace.get(id)` / `getByName`.
 */
export type DoStubLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: (...args: any[]) => Promise<unknown> | unknown;
};

/**
 * Structural DurableObjectNamespace — duck-types Workers env binding.
 * Prefer `getByName` when available; otherwise `idFromName` + `get`.
 */
export type DoNamespaceLike = {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): DoStubLike;
  getByName?(name: string): DoStubLike;
};

/** Optional alarm options (default-off; one alarm per DO + due queue). */
export type DoAlarmOptions = {
  /** Enable partitioned alarm queue + setAlarm. Default false. */
  enabled?: boolean;
  /** Max retry attempts for a queued item before giving up. */
  maxRetries?: number;
  /** Base backoff in ms (jitter applied). Default 1000. */
  baseBackoffMs?: number;
  /** Max backoff cap in ms. Default 300_000. */
  maxBackoffMs?: number;
};

/**
 * Options for createDo*Store factories that take an executor (test / in-object path).
 *
 * - `executor` is required when not using storage/namespace factories.
 * - `clock` is optional; default wall clock. Prefer FakeClock in tests.
 * - Factories do **not** migrate by default.
 */
export type DoStoreOptions = {
  executor: DoExecutor;
  /** Injectable clock for lease expiry / ISO timestamps (FakeClock-compatible). */
  clock?: StoreClock;
  /** Schema/table namespace; validated identifiers only. */
  namespace?: SchemaNamespaceConfig;
};

/**
 * Direct storage path for unit tests / in-object construction.
 * Does **not** migrate by default (call ensureDoSchema / migrateDoAdapter).
 */
export type DoStorageStoreOptions = {
  storage: DoStorageLike;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

/**
 * Worker-side client options: namespace + explicit sharding strategy.
 *
 * NEVER defaults to a single global Durable Object.
 */
export type DoClientStoreOptions = {
  /** Workers DO binding (`env.PAYMENTS_DO`) or mock namespace. */
  namespace: DoNamespaceLike;
  /**
   * Required sharding strategy.
   * Prefer `{ kind: "key" }` for per-key serialization, or
   * `{ kind: "hash", partitions: N }` with N >= 16 for bounded partitions.
   * NEVER use a silent global singleton.
   */
  sharding: DoShardingStrategy;
  clock?: StoreClock;
  /**
   * Optional logical table prefix. The Worker client forwards this on every
   * store RPC; {@link PaymentsStoreObject} applies it (constructor `namespace`
   * is the default when the arg is omitted). Not injected by mock namespaces.
   */
  tableNamespace?: SchemaNamespaceConfig;
  /**
   * Optional name prefix for shard object names (e.g. `"payments-v1"`).
   * Combined with resolveDoShardName output — not a global DO name by itself.
   */
  objectNamePrefix?: string;
};

/**
 * Single-partition storage path for createDoPaymentStoresFromStorage.
 * For multi-partition mocks, pass a map keyed by shard name.
 */
export type DoFromStorageOptions = {
  /**
   * Single partition storage, or map of shardName → storage for partition tests.
   * When a map is provided, `sharding` is required to route ops.
   */
  storage: DoStorageLike | Map<string, DoStorageLike> | Record<string, DoStorageLike>;
  sharding?: DoShardingStrategy;
  clock?: StoreClock;
  tableNamespace?: SchemaNamespaceConfig;
  objectNamePrefix?: string;
  alarms?: DoAlarmOptions;
};

export type DoStoresBundle = {
  idempotency: import("@paykernel/store-contracts").IdempotencyStore;
  webhookInbox: import("@paykernel/store-contracts").WebhookInboxStore;
  reconciliation: import("@paykernel/store-contracts").ReconciliationStore;
  namespace: ResolvedSchemaNamespace;
  clock: StoreClock;
  manifest: import("@paykernel/store-contracts").StorageAdapterManifest;
  /** Present when built from an executor (not Worker client). */
  executor?: DoExecutor;
  /** Present when built from Worker namespace client. */
  sharding?: DoShardingStrategy;
};
