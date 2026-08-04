/**
 * Shared option and executor types for the PostgreSQL adapter.
 */

import type {
  ResolvedSchemaNamespace,
  SchemaNamespaceConfig,
} from "@paykernel/internal-sql-store";
import type { PostgresExecutor } from "./executor";
import type { StoreClock } from "./clock";

export type { PostgresExecutor } from "./executor";
export type { StoreClock } from "./clock";
export type { SchemaNamespaceConfig, ResolvedSchemaNamespace };

/**
 * Options shared by all createPostgres*Store factories.
 *
 * - `executor` is required (narrow port; no driver import at root).
 * - `clock` is optional; default wall clock. Prefer FakeClock in tests.
 * - `namespace` is validated via createSchemaNamespace — never raw SQL names.
 * - Factories do **not** migrate by default.
 */
export type PostgresStoreOptions = {
  executor: PostgresExecutor;
  /** Injectable clock for lease expiry / ISO timestamps (FakeClock-compatible). */
  clock?: StoreClock;
  /** Schema/table namespace; validated identifiers only. */
  namespace?: SchemaNamespaceConfig;
};

export type PostgresStoresBundle = {
  idempotency: import("@paykernel/testkit").IdempotencyStore;
  webhookInbox: import("@paykernel/testkit").WebhookInboxStore;
  reconciliation: import("@paykernel/testkit").ReconciliationStore;
  executor: PostgresExecutor;
  namespace: ResolvedSchemaNamespace;
  clock: StoreClock;
  manifest: import("@paykernel/testkit").StorageAdapterManifest;
};
