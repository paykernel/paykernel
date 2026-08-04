/**
 * @paykernel/store-turso
 *
 * Root entry: store factories, migrate helpers, manifest, types.
 * ZERO static imports of @tursodatabase/serverless / @libsql/client / drizzle-orm.
 * Use subpaths for driver bindings:
 *   @paykernel/store-turso/serverless
 *   @paykernel/store-turso/libsql
 */

export {
  createTursoIdempotencyStore,
  createTursoWebhookInboxStore,
  createTursoReconciliationStore,
  createTursoStores,
} from "./index-stores";

export {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
} from "./migrate";
export type {
  MigrateTursoAdapterOptions,
  VerifyTursoAdapterOptions,
} from "./migrate";

export {
  TURSO_STORAGE_ADAPTER_MANIFEST,
  getTursoStorageAdapterManifest,
} from "./manifest";

export type {
  TursoExecutor,
  TursoStoreOptions,
  TursoStoresBundle,
  StoreClock,
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "./types";

export { toSqlStoreExecutor, isTursoExecutor } from "./executor";
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
