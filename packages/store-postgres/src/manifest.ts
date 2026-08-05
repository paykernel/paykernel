/**
 * Machine-readable guarantees for the PostgreSQL storage adapter.
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/store-contracts";

/**
 * Declared guarantees when using a shared PostgreSQL cluster with this adapter.
 *
 * Honesty notes:
 * - `coordinationScope: "multi-host"` assumes one shared primary (or consistent
 *   cluster) that all workers talk to — not multi-primary without consensus.
 * - Strong claims require the adapter's single-statement conditional writes
 *   (templates from sql-store), not get-then-set.
 * - Schema must be applied via explicit migrate before production traffic.
 */
export const POSTGRES_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "postgres",
  contracts: {
    idempotency: true,
    webhookInbox: true,
    reconciliation: true,
  },
  consistency: {
    claims: "strong",
    readAfterWrite: "strong",
    staleReadsPossible: false,
  },
  coordinationScope: "multi-host",
  durability: "durable",
  supportsTransactions: true, // when PostgresExecutor.withTransaction is provided; store withTransaction fails closed otherwise
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "Multi-host safe when all workers share one PostgreSQL cluster/primary.",
    "Claims use engine-level INSERT ON CONFLICT / conditional UPDATE RETURNING (sql-store postgres templates).",
    "Never get-then-set for claim correctness across connections.",
    "withTransaction fails closed (StoreUnsupportedFeatureError) when PostgresExecutor.withTransaction is missing — no silent no-op multi-mutation atomicity.",
    "Durable: rows survive process restart; durability of the PG service depends on WAL/replication configuration.",
    "Migrations are explicit (migratePostgresAdapter) — never on package import or default factory construction.",
    "Injectable clock: lease reclaim predicates bind `now` params; FakeClock works in conformance tests.",
    "Timestamps stored as TEXT ISO-8601 (foundation policy); TIMESTAMPTZ may be used at the operator boundary with casting.",
    "SKIP LOCKED may be used for listDue/batch fairness only; the durable work record is the row itself, not advisory locks.",
    "Crash mid-handler: lease expires then reclaim with new leaseToken + generation++; stale tokens throw StoreLeaseLostError.",
    "Do not store raw provider payloads or secrets by default; last_error is sanitized and length-capped.",
    "Root entry does not import optional peer drivers (pg/postgres/drizzle-orm); use isolated subpath bindings.",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(POSTGRES_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getPostgresStorageAdapterManifest(): StorageAdapterManifest {
  return POSTGRES_STORAGE_ADAPTER_MANIFEST;
}
