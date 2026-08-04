/**
 * @paykernel/store-durable-objects
 *
 * Root entry: store factories, Worker client, sharding, migrate helpers,
 * manifest, types, DO SQL executor.
 *
 * ZERO static imports of cloudflare:workers, bun:sqlite, better-sqlite3,
 * node:sqlite, @libsql/client, or @tursodatabase/serverless.
 *
 * Primary ergonomic API (Worker):
 *   createDoPaymentStores({ namespace: env.PAYMENTS_DO, sharding: { kind: "hash", partitions: 32 } })
 *
 * Direct / test path:
 *   createDoPaymentStoresFromStorage({ storage })
 *   createDoStores({ executor })
 *
 * Explicit migrate only:
 *   await migrateDoAdapter(storage) // or ensureDoSchema
 *
 * Not D1. Not local sqlite. Not Turso. SQLite-backed DO only (new_sqlite_classes).
 */

export {
  createDoIdempotencyStore,
  createDoWebhookInboxStore,
  createDoReconciliationStore,
  createDoStores,
  createDoStoresFromStorage,
} from "./index-stores";

export {
  createDoPaymentStores,
  createDoPaymentStoresFromStorage,
  createDoIdempotencyStoreFromNamespace,
  createDoWebhookInboxStoreFromNamespace,
  createDoReconciliationStoreFromNamespace,
} from "./client";

export {
  migrateDoAdapter,
  ensureDoSchema,
  verifyDoAdapterSchema,
} from "./migrate";
export type {
  MigrateDoAdapterOptions,
  VerifyDoAdapterOptions,
} from "./migrate";

export {
  DO_STORAGE_ADAPTER_MANIFEST,
  getDoStorageAdapterManifest,
} from "./manifest";

export {
  resolveDoShardName,
  hashStringToUint32,
  getDoStub,
  assertDoShardingStrategy,
  RECOMMENDED_HASH_PARTITIONS,
} from "./sharding";
export type {
  DoShardingStrategy,
  DoShardInput,
  ResolveDoShardNameOptions,
} from "./sharding";

export type {
  DoExecutor,
  DoStoreOptions,
  DoStorageStoreOptions,
  DoClientStoreOptions,
  DoFromStorageOptions,
  DoStoresBundle,
  DoStorageLike,
  SqlStorageLike,
  SqlStorageCursorLike,
  DoStubLike,
  DoNamespaceLike,
  DoAlarmOptions,
  StoreClock,
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "./types";

export {
  createDoExecutor,
  createDoExecutorFromSql,
  toSqlStoreExecutor,
  isDoExecutor,
  isDoStorageLike,
} from "./sql-executor";

export { createSystemClock, clockNowIso, clockAddMsIso } from "./clock";

export {
  mapDriverError,
  withMappedErrors,
  withMappedTransaction,
  isLikelyDriverFailure,
  StoreError,
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreTimeoutError,
  StoreSerializationFailureError,
  StoreInvalidSchemaError,
  StoreCorruptedRecordError,
} from "./errors";
export type { StoreErrorCode } from "./errors";

export { PaymentsStoreObject } from "./object/payments-store-object";
export type { PaymentsStoreObjectOptions } from "./object/payments-store-object";

export {
  createAlarmScheduler,
  ensureAlarmQueueSchema,
} from "./object/alarm-scheduler";
export type {
  AlarmScheduler,
  AlarmQueueItem,
  DoAlarmSchedulerOptions,
} from "./object/alarm-scheduler";
