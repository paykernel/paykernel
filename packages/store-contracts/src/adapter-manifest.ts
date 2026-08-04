/**
 * Machine-readable storage adapter guarantees (roadmap §9.5 / A3).
 *
 * Every adapter that implements lease-aware store contracts SHOULD publish a
 * {@link StorageAdapterManifest}. Guarantees are not optional to omit: clients
 * and conformance harnesses use this object to refuse unsafe deployments
 * (e.g. single-process ephemeral memory on production payment paths).
 *
 * ## Honesty rules
 *
 * - `consistency.claims` MUST be `"strong"` for production adapters, and only
 *   when claims use **engine-level atomic ops** (conditional INSERT/UPDATE,
 *   SET NX + token, transactional write). Adapters that only do get-then-set
 *   MUST NOT publish a conforming manifest with strong claims.
 * - Memory may declare `claims: "strong"` **only** with
 *   `coordinationScope: "single-process"` and notes that scope the claim.
 * - Do not advertise multi-host / durable guarantees for process-local Maps.
 */

// ─── Enum-like string unions ─────────────────────────────────────────────────

/** How widely the adapter coordinates leases/claims safely. */
export type StorageCoordinationScope =
  | "single-process"
  | "single-host"
  | "multi-host"
  | "multi-region";

/** Whether stored state survives process/host failure. */
export type StorageDurability =
  | "durable"
  | "configuration-dependent"
  | "ephemeral";

/** Read-your-writes / visibility after a successful write. */
export type StorageReadAfterWrite = "strong" | "session" | "eventual";

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Declared capabilities and consistency model for a storage adapter.
 *
 * All fields are required. Adapters must not silently omit guarantee fields.
 */
export interface StorageAdapterManifest {
  /** Stable adapter id (e.g. `"memory"`, `"postgres"`). */
  name: string;
  contracts: {
    idempotency: boolean;
    webhookInbox: boolean;
    reconciliation: boolean;
  };
  consistency: {
    /**
     * Claim/reserve atomicity model. Production adapters MUST use `"strong"`
     * via engine atomic ops — never get-then-set races.
     */
    claims: "strong";
    readAfterWrite: StorageReadAfterWrite;
    staleReadsPossible: boolean;
  };
  coordinationScope: StorageCoordinationScope;
  durability: StorageDurability;
  supportsTransactions: boolean;
  supportsLeases: boolean;
  supportsRetentionCleanup: boolean;
  /** Human notes (crash boundaries, NON-PRODUCTION banners, scope caveats). */
  notes: readonly string[];
}

// ─── Const tables for runtime validation ─────────────────────────────────────

const COORDINATION_SCOPES: readonly StorageCoordinationScope[] = [
  "single-process",
  "single-host",
  "multi-host",
  "multi-region",
] as const;

const DURABILITIES: readonly StorageDurability[] = [
  "durable",
  "configuration-dependent",
  "ephemeral",
] as const;

const READ_AFTER_WRITE: readonly StorageReadAfterWrite[] = [
  "strong",
  "session",
  "eventual",
] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(path: string, detail: string): never {
  throw new TypeError(`StorageAdapterManifest invalid at ${path}: ${detail}`);
}

/**
 * Runtime shape/enum validation for {@link StorageAdapterManifest}.
 * Throws `TypeError` when required fields are missing or enums are wrong.
 * Does not mutate input.
 */
export function assertStorageAdapterManifest(m: unknown): void {
  if (!isObject(m)) {
    fail("$", "expected a non-null object");
  }

  if (typeof m.name !== "string" || m.name.length === 0) {
    fail("name", "expected non-empty string");
  }

  if (!isObject(m.contracts)) {
    fail("contracts", "expected object");
  }
  for (const key of ["idempotency", "webhookInbox", "reconciliation"] as const) {
    if (typeof m.contracts[key] !== "boolean") {
      fail(`contracts.${key}`, "expected boolean");
    }
  }

  if (!isObject(m.consistency)) {
    fail("consistency", "expected object");
  }
  if (m.consistency.claims !== "strong") {
    fail(
      "consistency.claims",
      'expected literal "strong" (production adapters must use engine-level atomic claims)',
    );
  }
  if (
    typeof m.consistency.readAfterWrite !== "string" ||
    !(READ_AFTER_WRITE as readonly string[]).includes(m.consistency.readAfterWrite)
  ) {
    fail(
      "consistency.readAfterWrite",
      `expected one of ${READ_AFTER_WRITE.join(" | ")}`,
    );
  }
  if (typeof m.consistency.staleReadsPossible !== "boolean") {
    fail("consistency.staleReadsPossible", "expected boolean");
  }

  if (
    typeof m.coordinationScope !== "string" ||
    !(COORDINATION_SCOPES as readonly string[]).includes(m.coordinationScope)
  ) {
    fail(
      "coordinationScope",
      `expected one of ${COORDINATION_SCOPES.join(" | ")}`,
    );
  }

  if (
    typeof m.durability !== "string" ||
    !(DURABILITIES as readonly string[]).includes(m.durability)
  ) {
    fail("durability", `expected one of ${DURABILITIES.join(" | ")}`);
  }

  for (const key of [
    "supportsTransactions",
    "supportsLeases",
    "supportsRetentionCleanup",
  ] as const) {
    if (typeof m[key] !== "boolean") {
      fail(key, "expected boolean");
    }
  }

  if (!Array.isArray(m.notes)) {
    fail("notes", "expected readonly string[]");
  }
  for (let i = 0; i < m.notes.length; i++) {
    if (typeof m.notes[i] !== "string") {
      fail(`notes[${i}]`, "expected string");
    }
  }
}

/**
 * Heuristic: false when the adapter is process-local and/or ephemeral.
 * Does not imply full production readiness (durability, multi-host, ops).
 */
export function isProductionSafeCoordination(m: StorageAdapterManifest): boolean {
  if (m.coordinationScope === "single-process") return false;
  if (m.durability === "ephemeral") return false;
  return true;
}

/**
 * True when the adapter advertises strong claims **and** lease fencing support.
 * Get+set-only adapters must not set `claims: "strong"`.
 */
export function isStrongClaimAdapter(m: StorageAdapterManifest): boolean {
  return m.consistency.claims === "strong" && m.supportsLeases === true;
}

// ─── Memory adapter declaration ──────────────────────────────────────────────

/**
 * Machine-readable guarantees for the testkit in-memory multi-store.
 *
 * @remarks NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.
 */
export const MEMORY_STORAGE_ADAPTER_MANIFEST: StorageAdapterManifest = {
  name: "memory",
  contracts: {
    idempotency: true,
    webhookInbox: true,
    reconciliation: true,
  },
  consistency: {
    // Strong only within a single isolate — see notes.
    claims: "strong",
    readAfterWrite: "strong",
    staleReadsPossible: false,
  },
  coordinationScope: "single-process",
  durability: "ephemeral",
  /** Clone-on-enter {@link WithTransaction} Map snapshot/restore. */
  supportsTransactions: true,
  supportsLeases: true,
  supportsRetentionCleanup: true,
  notes: [
    "NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.",
    "Atomicity is process-local Map mutation (single isolate), not multi-process locking.",
    "claims: strong applies only within a single isolate after a successful write; not multi-process.",
    "Crash or process restart loses all state (ephemeral).",
    "Process exit is the real crash model; simulateCrash only injects StoreUnavailableError for tests.",
    "Do not use on payment production paths.",
    "Do not store raw provider payloads or secrets by default.",
    "Adapters that only implement get+set races MUST NOT publish claims: strong.",
  ],
};

/**
 * Accessor for the memory multi-store manifest (stable reference).
 * Prefer this when you only need discoverability without constructing stores.
 */
export function getMemoryStorageAdapterManifest(): StorageAdapterManifest {
  return MEMORY_STORAGE_ADAPTER_MANIFEST;
}
