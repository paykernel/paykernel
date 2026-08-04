/**
 * Optional Drizzle ORM notes and thin helpers.
 *
 * Drizzle is an **optional** peer. This subpath must not be required for core
 * store factories. Prefer injecting a {@link PostgresExecutor} built from your
 * driver (pg / postgres.js / Bun SQL).
 *
 * This module intentionally does **not** import `drizzle-orm` at the top level
 * so consumers without Drizzle installed can still load type-only docs paths
 * when tree-shaken carefully. Runtime helpers accept an already-built executor.
 */

import type { PostgresExecutor } from "../executor";
import {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
  createPostgresStores,
} from "../index-stores";
import type { PostgresStoreOptions, PostgresStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";

/**
 * Notes for operators wiring Drizzle:
 *
 * 1. Keep foundation tables managed by `migratePostgresAdapter` (sql-store SQL),
 *    not by Drizzle push/migrate for payment store tables (avoids dual sources of truth).
 * 2. Build a {@link PostgresExecutor} from the underlying `pg`/`postgres` client
 *    used by `drizzle(...)`, then call `createPostgres*Store({ executor })`.
 * 3. Do not run store mutators through a general Drizzle query builder in a way
 *    that loses single-statement claim atomicity.
 * 4. Optional schema mirrors (for app joins) may be declared in the app repo;
 *    this package does not ship mandatory Drizzle table definitions.
 */
export const DRIZZLE_ADAPTER_NOTES = [
  "Drizzle is optional; root entry never imports drizzle-orm.",
  "Prefer migratePostgresAdapter for foundation DDL.",
  "Wire createPostgres*Store with a PostgresExecutor over the same DB client.",
  "Do not replace atomic claim SQL with multi-step Drizzle get-then-set.",
] as const;

export type DrizzleStoreOptions = {
  /** Pre-built narrow executor (from pg/postgres.js/Bun under Drizzle). */
  executor: PostgresExecutor;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
};

function toOptions(opts: DrizzleStoreOptions): PostgresStoreOptions {
  const base: PostgresStoreOptions = { executor: opts.executor };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.namespace !== undefined) base.namespace = opts.namespace;
  return base;
}

/** Convenience: same factories with an explicit executor from a Drizzle stack. */
export function createPostgresIdempotencyStoreWithDrizzleExecutor(opts: DrizzleStoreOptions) {
  return createPostgresIdempotencyStore(toOptions(opts));
}

export function createPostgresWebhookInboxStoreWithDrizzleExecutor(opts: DrizzleStoreOptions) {
  return createPostgresWebhookInboxStore(toOptions(opts));
}

export function createPostgresReconciliationStoreWithDrizzleExecutor(opts: DrizzleStoreOptions) {
  return createPostgresReconciliationStore(toOptions(opts));
}

export function createPostgresStoresWithDrizzleExecutor(
  opts: DrizzleStoreOptions,
): PostgresStoresBundle {
  return createPostgresStores(toOptions(opts));
}

export {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "../migrate";
export { POSTGRES_STORAGE_ADAPTER_MANIFEST, getPostgresStorageAdapterManifest } from "../manifest";
export type { PostgresExecutor } from "../executor";
