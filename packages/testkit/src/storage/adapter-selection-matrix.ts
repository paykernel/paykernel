/**
 * Phase 18 frozen adapter selection matrix (honesty-guarded).
 *
 * Source of truth for **manifest field values** remains each package’s
 * `*STORAGE_ADAPTER_MANIFEST` + conformance suites. This matrix freezes the
 * **selection-guide rows** (roadmap Initial Matrix, expanded by subpath) so
 * tests can refuse overclaims without importing adapter packages into testkit.
 *
 * Human guide: monorepo `docs/adapter-selection.md`
 * Optional JSON twin: monorepo `docs/adapter-capability-matrix.json`
 *
 * Live cross-check (matrix cells vs real manifests) lives in
 * `scripts/check-adapter-selection-honesty.test.ts` at the monorepo root.
 */

import type {
  StorageCoordinationScope,
  StorageDurability,
  StorageReadAfterWrite,
} from "./adapter-manifest";

// ─── Types ───────────────────────────────────────────────────────────────────

/** How the selection guide answers the roadmap “Distributed?” column. */
export type SelectionDistributed =
  | "yes"
  | "no"
  | "yes-partitioned"
  /** Multi-host when shared Redis is up; Bun Cluster/Sentinel unsupported. */
  | "yes-except-bun-cluster-sentinel"
  /**
   * Remote Turso/libSQL is multi-host; the same binding may open `file:`,
   * which is single-host testing only — never a flat distributed yes.
   */
  | "yes-remote-local-file-single-host";

/** How the selection guide answers the roadmap “Durable audit?” column. */
export type SelectionDurableAudit = "yes" | "no" | "configuration-dependent";

/**
 * One published row of the Phase 18 capability / selection matrix.
 *
 * `manifestName` groups subpath rows that share one `StorageAdapterManifest`
 * (e.g. all sqlite bindings → `"sqlite"`).
 */
export interface AdapterSelectionMatrixRow {
  /** Stable row id (unique across the matrix). */
  rowId: string;
  /** Human label (matches selection-guide / roadmap wording). */
  label: string;
  /** Published npm package (root). */
  packageName: string;
  /**
   * Optional import subpath without leading slash (e.g. `"bun"`, `"upstash"`).
   * Empty string = package root.
   */
  subpath: string;
  /**
   * `StorageAdapterManifest.name` for the package that owns this row.
   * Memory uses `"memory"`.
   */
  manifestName: string;
  /** Roadmap “Distributed” cell (honest, not marketing). */
  distributed: SelectionDistributed;
  /**
   * Declared `coordinationScope` on the owning manifest.
   * DO remains `"multi-host"` with `partitioned: true` — never invent multi-region.
   */
  coordinationScope: StorageCoordinationScope;
  /** True only for Durable Objects (strong coordination is per partition). */
  partitioned: boolean;
  /** Declared `durability` on the owning manifest. */
  durability: StorageDurability;
  /** Roadmap “Durable audit” cell derived from durability. */
  durableAudit: SelectionDurableAudit;
  /** Roadmap “Atomic claim” — true when claims are strong engine-level ops. */
  atomicClaim: boolean;
  /** Declared `consistency.readAfterWrite`. */
  readAfterWrite: StorageReadAfterWrite;
  /** Declared `consistency.staleReadsPossible`. */
  staleReadsPossible: boolean;
  /**
   * Redis is never required infrastructure for the SDK.
   * True for every redis/upstash row; false elsewhere.
   */
  redisOptional: boolean;
  /**
   * Local file SQLite bindings only (`store-sqlite` subpaths).
   * Must never claim multi-host / multi-region.
   */
  isLocalSqlite: boolean;
  /** NON-PRODUCTION memory / single-process ephemeral only. */
  isMemory: boolean;
  /** Safe for production payment paths under declared assumptions. */
  productionRecommended: boolean;
  /** Short limitation string (selection-guide “Important limitation”). */
  importantLimitation: string;
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

/**
 * Frozen Phase 18 selection matrix.
 *
 * Order matches `docs/adapter-selection.md` capability matrix (production first,
 * memory last). Do not add multi-region rows without a matching tested manifest.
 */
export const ADAPTER_SELECTION_MATRIX: readonly AdapterSelectionMatrixRow[] = [
  {
    rowId: "postgres",
    label: "PostgreSQL",
    packageName: "@paykernel/store-postgres",
    subpath: "",
    manifestName: "postgres",
    distributed: "yes",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Needs managed/self-hosted DB; multi-primary without consensus is out of scope",
  },
  {
    rowId: "redis-native",
    label: "Redis/Valkey (Bun, ioredis, node-redis)",
    packageName: "@paykernel/store-redis",
    // Aggregate roadmap row spanning three subpaths (not a single import path).
    subpath: "bun|ioredis|node-redis",
    manifestName: "redis",
    distributed: "yes-except-bun-cluster-sentinel",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "configuration-dependent",
    durableAudit: "configuration-dependent",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: true,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Optional infra; not automatic long-term audit alone; Bun rejects Cluster/Sentinel",
  },
  {
    rowId: "redis-upstash",
    label: "Upstash Redis",
    packageName: "@paykernel/store-redis",
    subpath: "upstash",
    manifestName: "redis",
    distributed: "yes",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "configuration-dependent",
    durableAudit: "configuration-dependent",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: true,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "HTTP/network model + platform persistence policy; hybrid audit caveats apply",
  },
  {
    rowId: "sqlite-bun",
    label: "Bun SQLite",
    packageName: "@paykernel/store-sqlite",
    subpath: "bun",
    manifestName: "sqlite",
    distributed: "no",
    coordinationScope: "single-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: true,
    isMemory: false,
    productionRecommended: true,
    importantLimitation: "Not cross-host; no network FS sharing of the file",
  },
  {
    rowId: "sqlite-node",
    label: "Node SQLite",
    packageName: "@paykernel/store-sqlite",
    subpath: "node",
    manifestName: "sqlite",
    distributed: "no",
    coordinationScope: "single-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: true,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "node:sqlite stability varies by Node line; optional subpath only",
  },
  {
    rowId: "sqlite-better-sqlite3",
    label: "better-sqlite3",
    packageName: "@paykernel/store-sqlite",
    subpath: "better-sqlite3",
    manifestName: "sqlite",
    distributed: "no",
    coordinationScope: "single-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: true,
    isMemory: false,
    productionRecommended: true,
    importantLimitation: "Native dependency; synchronous API",
  },
  {
    rowId: "turso-serverless",
    label: "Turso serverless",
    packageName: "@paykernel/store-turso",
    subpath: "serverless",
    manifestName: "turso",
    distributed: "yes",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Remote/async txn semantics; not local @paykernel/store-sqlite; no /sync export",
  },
  {
    rowId: "turso-libsql",
    label: "libSQL",
    packageName: "@paykernel/store-turso",
    subpath: "libsql",
    manifestName: "turso",
    distributed: "yes-remote-local-file-single-host",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Remote multi-host; local file: is single-host testing only; embedded-replica/offline multi-writer not advertised; no /sync",
  },
  {
    rowId: "cloudflare-d1",
    label: "Cloudflare D1",
    packageName: "@paykernel/store-d1",
    subpath: "",
    manifestName: "cloudflare-d1",
    distributed: "yes",
    coordinationScope: "multi-host",
    partitioned: false,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "session",
    staleReadsPossible: true,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Not local SQLite/Turso/DO; readAfterWrite session; staleReadsPossible without Sessions under replication",
  },
  {
    rowId: "cloudflare-do",
    label: "Cloudflare Durable Objects",
    packageName: "@paykernel/store-durable-objects",
    subpath: "",
    manifestName: "cloudflare-do",
    distributed: "yes-partitioned",
    coordinationScope: "multi-host",
    partitioned: true,
    durability: "durable",
    durableAudit: "yes",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: false,
    productionRecommended: true,
    importantLimitation:
      "Requires sharding; never one global DO; no global total order across partitions; not D1",
  },
  {
    rowId: "memory",
    label: "Memory (testkit)",
    packageName: "@paykernel/testkit",
    subpath: "",
    manifestName: "memory",
    distributed: "no",
    coordinationScope: "single-process",
    partitioned: false,
    durability: "ephemeral",
    durableAudit: "no",
    atomicClaim: true,
    readAfterWrite: "strong",
    staleReadsPossible: false,
    redisOptional: false,
    isLocalSqlite: false,
    isMemory: true,
    productionRecommended: false,
    importantLimitation:
      "NON-PRODUCTION. Never on a production payment path. Restart loses all state.",
  },
] as const;

/** Roadmap Initial Matrix production row ids (memory is extra honesty row). */
export const ROADMAP_PRODUCTION_MATRIX_ROW_IDS: readonly string[] = [
  "postgres",
  "redis-native",
  "redis-upstash",
  "sqlite-bun",
  "sqlite-node",
  "sqlite-better-sqlite3",
  "turso-serverless",
  "turso-libsql",
  "cloudflare-d1",
  "cloudflare-do",
] as const;

/** Unique production adapter package names covered by the matrix. */
export const PRODUCTION_ADAPTER_PACKAGE_NAMES: readonly string[] = [
  "@paykernel/store-postgres",
  "@paykernel/store-redis",
  "@paykernel/store-sqlite",
  "@paykernel/store-turso",
  "@paykernel/store-d1",
  "@paykernel/store-durable-objects",
] as const;

/** Manifest `name` values for production adapters (one per package). */
export const PRODUCTION_MANIFEST_NAMES: readonly string[] = [
  "postgres",
  "redis",
  "sqlite",
  "turso",
  "cloudflare-d1",
  "cloudflare-do",
] as const;

/**
 * Map selection-guide durable-audit wording → manifest durability enum.
 * Used by honesty tests / live cross-checks.
 */
export function durableAuditFromDurability(
  d: StorageDurability,
): SelectionDurableAudit {
  if (d === "durable") return "yes";
  if (d === "ephemeral") return "no";
  return "configuration-dependent";
}

/**
 * True when the row must never be marketed as multi-host / multi-region distributed.
 */
export function forbidsMultiHostMarketing(row: AdapterSelectionMatrixRow): boolean {
  return (
    row.isLocalSqlite ||
    row.isMemory ||
    row.coordinationScope === "single-host" ||
    row.coordinationScope === "single-process"
  );
}
