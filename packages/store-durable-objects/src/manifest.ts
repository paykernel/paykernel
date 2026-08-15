/**
 * Machine-readable guarantees for the Cloudflare Durable Object storage adapter.
 *
 * DO SQLite storage + alarms verification pin: 2026-08-03
 * https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
 * https://developers.cloudflare.com/durable-objects/api/alarms/
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/store-contracts";

/**
 * Declared guarantees when using SQLite-backed Durable Objects with
 * deterministic sharding (per-partition strong coordination).
 *
 * Honesty notes:
 * - Strong claims and strong read-after-write apply **within a single DO
 *   instance (partition)** — not as a global multi-primary store.
 * - Cross-partition: no global total order.
 * - Never route all payment work through one global Durable Object.
 * - SQLite-backed only (`new_sqlite_classes`); not legacy KV-only DO storage.
 * - Not D1 shared DB, not local store-sqlite, not store-turso.
 */
export const DO_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "cloudflare-do",
  contracts: {
    idempotency: true,
    webhookInbox: true,
    reconciliation: true,
  },
  consistency: {
    claims: "strong",
    /** Strong RAW within a single DO instance; cross-partition no global order. */
    readAfterWrite: "strong",
    staleReadsPossible: false,
  },
  coordinationScope: "multi-host",
  durability: "durable",
  supportsTransactions: true, // in-object transactionSync + implicit SQL statement atomicity
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "SQLite-backed Durable Objects only (new_sqlite_classes). Not legacy KV-only DO storage.",
    "Strong per-partition coordination; not a shared multi-primary global store.",
    "Strong read-after-write within a single DO instance; cross-partition no global total order.",
    "Not packages/store-d1 (shared D1). Not store-sqlite local file. Not store-turso.",
    "Never route all payment work through one global Durable Object.",
    "Sharding strategies: key | hash-partitioned | tenant — document ordering and hot-key risks. hash partitions=1 is a single partition (not a silent global DO); prefer >= 16.",
    "DO-1: hash partitions are sealed on a stable layout meta DO (hash:{layoutId|default}:__pk_layout__). Changing N under the same layout hard-throws — never silently route to empty partition objects. Use a new layoutId/objectNamePrefix to reshard after migration.",
    "Claims use sql.exec UPSERT/RETURNING and/or transactionSync; never get-then-set.",
    "transactionSync callbacks must be synchronous; no await external I/O inside storage transactions.",
    "Correct pattern: claim → commit → external provider work → complete with lease token.",
    "SqlStorageCursor must be fully consumed (toArray) before any await — no snapshot isolation.",
    "Optional alarms are at-least-once; use partitioned queue + one alarm per DO; bounded retries + backoff/jitter.",
    "Injectable clock for FakeClock conformance; TEXT IDs/tokens/hashes; explicit schema ensure not import-time migrate.",
    "Worker client is async (stub RPC); DO-internal SQL is synchronous.",
    "supportsTransactions applies in-object (createDo*Store / PaymentsStoreObject transactionSync). Worker-client createDoPaymentStores.withTransaction hard-fails (StoreUnsupportedFeatureError) — no cross-object multi-mutation atomicity and no silent no-op.",
    "runInTransaction fails closed for async callbacks when BEGIN is rejected (no pretend multi-statement atomicity).",
    "Never auto-migrate on package import or default createDoPaymentStores construction.",
    "Workers-only deployment; do not import cloudflare:workers into portable packages (core/webhooks/testkit).",
    "Pin verification date against Cloudflare DO SQLite storage + alarms docs: verified 2026-08-03 (https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ , https://developers.cloudflare.com/durable-objects/api/alarms/).",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(DO_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getDoStorageAdapterManifest(): StorageAdapterManifest {
  return DO_STORAGE_ADAPTER_MANIFEST;
}
