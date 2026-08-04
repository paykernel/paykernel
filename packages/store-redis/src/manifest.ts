/**
 * Machine-readable guarantees for the Redis/Valkey storage adapter.
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/testkit";

/**
 * Declared guarantees when using a shared Redis/Valkey with this adapter.
 *
 * Honesty notes:
 * - `coordinationScope: "multi-host"` assumes all workers share one Redis/Valkey.
 * - `durability: "configuration-dependent"` — AOF/RDB / managed persistence required
 *   for survival across Redis restarts; never advertise blindly durable.
 * - Not automatically suitable as the only long-term audit store.
 */
export const REDIS_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "redis",
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
  durability: "configuration-dependent",
  supportsTransactions: false,
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "Coordination-safe during normal multi-worker operation against shared Redis/Valkey.",
    "Durable across process restart only if Redis still holds keys (service up).",
    "Durable across Redis service restart ONLY with AOF/RDB (or cloud persistence) configured correctly.",
    "Not automatically suitable as the only long-term audit store — prefer hybrid with PostgreSQL/D1/Turso.",
    "Claims use atomic Lua scripts; never get-then-set in JS.",
    "Injectable clock: now passed as script ARGV for FakeClock conformance.",
    "Bun binding does not support Cluster/Sentinel; rejects cluster config.",
    "Do not use Pub/Sub for webhook correctness.",
    "Offline command queue should be disabled/controlled for correctness-critical ops.",
    "Root entry does not import optional peer drivers.",
    "Lua is atomic per script; MULTI/EXEC is not required for claim correctness.",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(REDIS_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getRedisStorageAdapterManifest(): StorageAdapterManifest {
  return REDIS_STORAGE_ADAPTER_MANIFEST;
}
