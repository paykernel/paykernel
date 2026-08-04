/**
 * Machine-readable guarantees for the Turso / libSQL storage adapter.
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/store-contracts";

/**
 * Declared guarantees when using a shared remote Turso / libSQL database.
 *
 * Honesty notes:
 * - `coordinationScope: "multi-host"` assumes one shared remote primary that
 *   all workers talk to — not multi-primary without consensus.
 * - Strong claims require single-statement conditional writes (or multi-step
 *   only inside a write transaction / transactional batch), not get-then-set.
 * - Schema must be applied via explicit migrate before production traffic.
 * - Do not advertise untested `/sync` or embedded-replica local-first modes.
 */
export const TURSO_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "turso",
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
  supportsTransactions: true,
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "Shared durable SQLite-compatible store for multi-host deployments via Turso remote or libSQL remote URL.",
    "Not the same as packages/store-sqlite local single-host file databases.",
    "Claims prefer single-statement ON CONFLICT/RETURNING UPSERTs; multi-statement only in write transactions/batches.",
    "Never unprotected get-then-set across round-trips for claim correctness.",
    "@tursodatabase/serverless and @libsql/client are NOT interchangeable — use matching subpath; test independently.",
    "Embedded replica / sync modes are NOT advertised as true local-first sync; /sync subpath is not shipped.",
    "Legacy embedded replica semantics differ from true local-first sync — do not assume offline conflict resolution.",
    "Migrations are explicit (migrateTursoAdapter) — never on package import or default factory construction.",
    "Injectable clock: lease reclaim predicates use injected now; FakeClock works in conformance tests.",
    "Timestamps stored as TEXT ISO-8601; generation as INTEGER; lease tokens as TEXT.",
    "Root entry does not import @tursodatabase/serverless / @libsql/client; use isolated subpath bindings.",
    "Auth tokens must never appear in StoreError messages or logs.",
    "Pin tested client versions and verification date in docs when live tests run.",
    "Remote clients are async (fetch/HTTP); do not require sync transaction callbacks like local SQLite BEGIN IMMEDIATE.",
    "libSQL concurrent-write limitations may differ from Turso serverless MVCC — document and test both paths.",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(TURSO_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getTursoStorageAdapterManifest(): StorageAdapterManifest {
  return TURSO_STORAGE_ADAPTER_MANIFEST;
}
