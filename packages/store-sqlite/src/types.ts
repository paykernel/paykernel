/**
 * Shared option and executor types for the SQLite adapter.
 */

import type {
  ResolvedSchemaNamespace,
  SchemaNamespaceConfig,
} from "@paykernel/sql-foundation";
import type { SqliteExecutor } from "./executor";
import type { StoreClock } from "./clock";

export type { SqliteExecutor, SqliteTransactionMode } from "./executor";
export type { StoreClock } from "./clock";
export type { SchemaNamespaceConfig, ResolvedSchemaNamespace };

/**
 * Options shared by all createSqlite*Store factories.
 *
 * - `executor` is required (narrow port; no driver import at root).
 * - `clock` is optional; default wall clock. Prefer FakeClock in tests.
 * - `namespace` is validated via createSchemaNamespace — never raw SQL names.
 * - Factories do **not** migrate by default.
 */
export type SqliteStoreOptions = {
  executor: SqliteExecutor;
  /** Injectable clock for lease expiry / ISO timestamps (FakeClock-compatible). */
  clock?: StoreClock;
  /** Schema/table namespace; validated identifiers only. */
  namespace?: SchemaNamespaceConfig;
};

export type SqliteStoresBundle = {
  idempotency: import("@paykernel/store-contracts").IdempotencyStore;
  webhookInbox: import("@paykernel/store-contracts").WebhookInboxStore;
  reconciliation: import("@paykernel/store-contracts").ReconciliationStore;
  executor: SqliteExecutor;
  namespace: ResolvedSchemaNamespace;
  clock: StoreClock;
  manifest: import("@paykernel/store-contracts").StorageAdapterManifest;
};
