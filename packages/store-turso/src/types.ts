/**
 * Shared option and executor types for the Turso / libSQL adapter.
 */

import type {
  ResolvedSchemaNamespace,
  SchemaNamespaceConfig,
} from "@paykernel/sql-foundation";
import type { TursoExecutor } from "./executor";
import type { StoreClock } from "./clock";

export type { TursoExecutor } from "./executor";
export type { StoreClock } from "./clock";
export type { SchemaNamespaceConfig, ResolvedSchemaNamespace };

/**
 * Options shared by all createTurso*Store factories.
 *
 * - `executor` is required (narrow port; no driver import at root).
 * - `clock` is optional; default wall clock. Prefer FakeClock in tests.
 * - `namespace` is validated via createSchemaNamespace — never raw SQL names.
 * - Factories do **not** migrate by default.
 */
export type TursoStoreOptions = {
  executor: TursoExecutor;
  /** Injectable clock for lease expiry / ISO timestamps (FakeClock-compatible). */
  clock?: StoreClock;
  /** Schema/table namespace; validated identifiers only. */
  namespace?: SchemaNamespaceConfig;
};

export type TursoStoresBundle = {
  idempotency: import("@paykernel/store-contracts").IdempotencyStore;
  webhookInbox: import("@paykernel/store-contracts").WebhookInboxStore;
  reconciliation: import("@paykernel/store-contracts").ReconciliationStore;
  executor: TursoExecutor;
  namespace: ResolvedSchemaNamespace;
  clock: StoreClock;
  manifest: import("@paykernel/store-contracts").StorageAdapterManifest;
};
