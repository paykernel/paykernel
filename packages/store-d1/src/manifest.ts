/**
 * Machine-readable guarantees for the Cloudflare D1 storage adapter.
 *
 * D1 Workers Binding API verification pin: 2026-08-03
 * https://developers.cloudflare.com/d1/worker-api/
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/store-contracts";

/**
 * Declared guarantees when using a shared Cloudflare D1 database from Workers.
 *
 * Honesty notes:
 * - `coordinationScope: "multi-host"` assumes one shared D1 database bound into
 *   all Worker instances — not multi-primary without consensus.
 * - Strong claims require single-statement conditional writes (or multi-step
 *   only inside D1 `batch()`), not get-then-set across round-trips.
 * - Read-after-write under D1 read replication is session-dependent; without
 *   Sessions API (`withSession('first-primary')` / bookmarks), stale replica
 *   reads are possible.
 * - Schema must be applied via explicit migrate before production traffic.
 * - Not local SQLite, not Turso/libSQL, not Durable Objects.
 */
export const D1_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "cloudflare-d1",
  contracts: {
    idempotency: true,
    webhookInbox: true,
    reconciliation: true,
  },
  consistency: {
    claims: "strong",
    /** Session-scoped sequential consistency when using D1 Sessions API; see notes. */
    readAfterWrite: "session",
    staleReadsPossible: true,
  },
  coordinationScope: "multi-host",
  durability: "durable",
  supportsTransactions: true, // via batch() atomic multi-statement
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "Workers/Pages D1 binding store for multi-instance Worker deployments (shared D1 database).",
    "Not the same as packages/store-sqlite local single-host file databases.",
    "Not the same as packages/store-turso Turso/libSQL clients.",
    "Normal operation uses D1 Workers binding only — no Cloudflare REST API required.",
    "Claims prefer single-statement ON CONFLICT/RETURNING UPSERTs; multi-statement only via D1 batch().",
    "Never unprotected get-then-set across round-trips for claim correctness.",
    "Uses prepared statements (prepare/bind/first|all|run) — no string interpolation of user values.",
    "Correctness-critical claims are writes against the primary; use withSession('first-primary') or bookmarks for read-after-write when read replication is enabled.",
    "Without sessions, stale replica reads are possible under D1 read replication.",
    "Migration SQL must not wrap statements in BEGIN/COMMIT for D1 apply path; use explicit migrateD1Adapter.",
    "Never auto-migrate on package import or default createD1PaymentStores construction.",
    "Injectable clock: lease reclaim uses injected now; FakeClock works in conformance tests.",
    "Identifiers, lease tokens, hashes, and exact financial values stored as TEXT for JS precision safety.",
    "Async D1 API only — no local sync SQLite transaction callbacks (BEGIN IMMEDIATE).",
    "D1 batch() is a SQL transaction: on statement failure the entire sequence aborts/rolls back.",
    "D1 plain writes may return empty results; claim classification uses UPSERT/UPDATE RETURNING via .all()/.first().",
    "Pin verification date against Cloudflare D1 Workers Binding API docs: verified 2026-08-03 (https://developers.cloudflare.com/d1/worker-api/).",
    "Workers-only deployment surface; do not import cloudflare:workers into portable packages (core/webhooks/testkit).",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(D1_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getD1StorageAdapterManifest(): StorageAdapterManifest {
  return D1_STORAGE_ADAPTER_MANIFEST;
}
