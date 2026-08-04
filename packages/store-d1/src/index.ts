/**
 * @paykernel/store-d1
 *
 * Root entry: store factories, migrate helpers, manifest, types, D1 executor.
 * ZERO static imports of cloudflare:workers, bun:sqlite, better-sqlite3,
 * node:sqlite, @libsql/client, or @tursodatabase/serverless.
 *
 * Primary ergonomic API:
 *   createD1PaymentStores({ db: env.PAYMENTS_DB })
 *
 * Explicit migrate only:
 *   await migrateD1Adapter(db) // or executor
 */

export {
  createD1IdempotencyStore,
  createD1WebhookInboxStore,
  createD1ReconciliationStore,
  createD1Stores,
} from "./index-stores";

export {
  createD1PaymentStores,
  createD1IdempotencyStoreFromBinding,
  createD1WebhookInboxStoreFromBinding,
  createD1ReconciliationStoreFromBinding,
} from "./d1-binding";

export {
  migrateD1Adapter,
  verifyD1AdapterSchema,
} from "./migrate";
export type {
  MigrateD1AdapterOptions,
  VerifyD1AdapterOptions,
} from "./migrate";

export {
  D1_STORAGE_ADAPTER_MANIFEST,
  getD1StorageAdapterManifest,
} from "./manifest";

export type {
  D1Executor,
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1StoreOptions,
  D1BindingStoreOptions,
  D1StoresBundle,
  StoreClock,
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "./types";

export {
  createD1Executor,
  toSqlStoreExecutor,
  isD1Executor,
  isD1DatabaseLike,
} from "./executor";

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

export {
  D1_SESSION_FIRST_PRIMARY,
  D1_SESSION_FIRST_UNCONSTRAINED,
  supportsD1Sessions,
  withD1Session,
  createSessionScopedExecutor,
  scopeExecutorSession,
} from "./sessions";
