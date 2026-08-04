/**
 * @paykernel/store-sqlite
 *
 * Root entry: store factories, migrate helpers, manifest, types, pragmas.
 * ZERO static imports of bun:sqlite / node:sqlite / better-sqlite3.
 * Use subpaths for driver bindings:
 *   @paykernel/store-sqlite/bun
 *   @paykernel/store-sqlite/node
 *   @paykernel/store-sqlite/better-sqlite3
 */

export {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  createSqliteReconciliationStore,
  createSqliteStores,
} from "./index-stores";

export {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
} from "./migrate";
export type {
  MigrateSqliteAdapterOptions,
  VerifySqliteAdapterOptions,
} from "./migrate";

export {
  SQLITE_STORAGE_ADAPTER_MANIFEST,
  getSqliteStorageAdapterManifest,
} from "./manifest";

export type {
  SqliteExecutor,
  SqliteStoreOptions,
  SqliteStoresBundle,
  SqliteTransactionMode,
  StoreClock,
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "./types";

export { toSqlStoreExecutor, isSqliteExecutor } from "./executor";
export { createSystemClock, clockNowIso, clockAddMsIso } from "./clock";
export { applyRecommendedPragmas } from "./pragmas";
export type { RecommendedPragmaOptions } from "./pragmas";
export {
  mapDriverError,
  withMappedErrors,
  StoreError,
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreTimeoutError,
  StoreSerializationFailureError,
  StoreInvalidSchemaError,
  StoreCorruptedRecordError,
} from "./errors";
export type { StoreErrorCode } from "./errors";
