/**
 * Machine-readable guarantees for the SQLite storage adapter.
 */

import {
  assertStorageAdapterManifest,
  type StorageAdapterManifest,
} from "@paykernel/testkit";

/**
 * Declared guarantees for local/embedded SQLite with this adapter.
 *
 * Honesty notes:
 * - `coordinationScope: "single-host"` — one durable filesystem authority per file.
 * - NEVER multi-host / multi-region for a local SQLite file.
 * - `durability: "durable"` assumes file-backed storage; `:memory:` is process-local.
 * - Strong claims require BEGIN IMMEDIATE (or equivalent) + conditional writes.
 * - Schema must be applied via explicit migrate before production traffic.
 */
export const SQLITE_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "sqlite",
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
  coordinationScope: "single-host",
  durability: "durable",
  supportsTransactions: true,
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "Single-host only: one database file must have one durable filesystem authority.",
    "Do not share the SQLite file over unsupported network filesystems.",
    "Ephemeral serverless filesystems lose state — not suitable for durable inbox/idempotency there.",
    "Horizontal scaling across hosts requires D1, Turso, PostgreSQL, Redis, or another shared service.",
    "Claims use BEGIN IMMEDIATE (or equivalent) + conditional writes / ON CONFLICT in one sync transaction.",
    "Never unprotected get-then-set across connections for claim correctness.",
    "Recommend WAL mode and busy_timeout for persistent single-host applications.",
    "Migrations are explicit (migrateSqliteAdapter) — never on package import or default factory construction.",
    "Injectable clock: lease reclaim predicates use injected now; FakeClock works in conformance tests.",
    "Timestamps stored as TEXT ISO-8601; generation as INTEGER; lease tokens as TEXT.",
    "Root entry does not import bun:sqlite / node:sqlite / better-sqlite3; use isolated subpath bindings.",
    ":memory: databases are process-local only (ephemeral across process restart).",
  ],
};

// Validate at module load — fails fast if shape drifts.
assertStorageAdapterManifest(SQLITE_STORAGE_ADAPTER_MANIFEST);

/** Stable accessor for discoverability without constructing stores. */
export function getSqliteStorageAdapterManifest(): StorageAdapterManifest {
  return SQLITE_STORAGE_ADAPTER_MANIFEST;
}
