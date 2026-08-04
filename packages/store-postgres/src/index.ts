/**
 * @paykernel/store-postgres
 *
 * Root entry: store factories, migrate helpers, manifest, types.
 * ZERO static imports of pg / postgres / drizzle-orm / bun:sql.
 * Use subpaths for driver bindings:
 *   @paykernel/store-postgres/pg
 *   @paykernel/store-postgres/postgres-js
 *   @paykernel/store-postgres/bun-sql
 *   @paykernel/store-postgres/drizzle
 */

export {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
  createPostgresStores,
} from "./index-stores";

export {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "./migrate";
export type {
  MigratePostgresAdapterOptions,
  VerifyPostgresAdapterOptions,
} from "./migrate";

export {
  POSTGRES_STORAGE_ADAPTER_MANIFEST,
  getPostgresStorageAdapterManifest,
} from "./manifest";

export type {
  PostgresExecutor,
  PostgresStoreOptions,
  PostgresStoresBundle,
  StoreClock,
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "./types";

export { toSqlStoreExecutor, isPostgresExecutor } from "./executor";
export { createSystemClock, clockNowIso, clockAddMsIso } from "./clock";
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
