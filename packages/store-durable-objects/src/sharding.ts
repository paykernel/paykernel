/**
 * Deterministic sharding for Durable Object partitions (Phase 17.2).
 *
 * NEVER default to a single global Durable Object for all payment work.
 *
 * Strategies:
 * - `key`: one object per idempotency/event key (strongest per-key serialization)
 * - `hash`: bounded hash partitions (partitions >= 1; recommend >= 16)
 * - `tenant`: one object per tenant id
 *
 * Ordering: within a shard/object, requests serialize (single-threaded DO).
 * Across shards, there is no global total order.
 *
 * Hot-key: many ops for the same key/tenant hit the same object → latency/cost
 * concentration. Prefer hash partitions when a single key would become a hotspot
 * (rare for pure idempotency keys; more relevant for tenant strategy).
 */

export type DoShardingStrategy =
  | { kind: "key" }
  | { kind: "hash"; partitions: number }
  | {
      kind: "tenant";
      tenantId: string | ((input: DoShardInput) => string);
    };

export type DoShardInput = {
  /** Primary routing key (idempotency key, webhook event key, recon job key). */
  key: string;
  /** Optional tenant for tenant strategy or dual-aware hashing. */
  tenantId?: string;
};

export type ResolveDoShardNameOptions = {
  /**
   * Optional prefix prepended to the shard name (e.g. `"payments-v1"`).
   * Does not create a global singleton — each resolve still yields a distinct
   * suffix for different keys/partitions/tenants.
   */
  prefix?: string;
};

/**
 * FNV-1a 32-bit hash for stable partition assignment (portable, no crypto dep).
 */
export function hashStringToUint32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function assertNonBlank(value: string, label: string): string {
  const t = value.trim();
  if (!t) {
    throw new TypeError(`sharding: ${label} must be a non-empty string`);
  }
  return t;
}

function validateStrategy(strategy: DoShardingStrategy): void {
  if (strategy === null || typeof strategy !== "object" || !("kind" in strategy)) {
    throw new TypeError("sharding: strategy is required (key | hash | tenant)");
  }
  if (strategy.kind === "hash") {
    if (
      typeof strategy.partitions !== "number" ||
      !Number.isInteger(strategy.partitions) ||
      strategy.partitions < 1
    ) {
      throw new TypeError(
        "sharding: hash partitions must be an integer >= 1 (recommend >= 16)",
      );
    }
  } else if (strategy.kind === "tenant") {
    if (
      typeof strategy.tenantId !== "string" &&
      typeof strategy.tenantId !== "function"
    ) {
      throw new TypeError(
        "sharding: tenant strategy requires tenantId string or function",
      );
    }
  } else if (strategy.kind !== "key") {
    // Forbid silent global / unknown kinds
    throw new TypeError(
      `sharding: unsupported kind "${String((strategy as { kind: string }).kind)}"; use key | hash | tenant (never global)`,
    );
  }
}

/**
 * Resolve the Durable Object name for a given key/tenant under the strategy.
 *
 * Names are opaque stable strings suitable for `idFromName` / `getByName`.
 */
export function resolveDoShardName(
  strategy: DoShardingStrategy,
  input: DoShardInput,
  options: ResolveDoShardNameOptions = {},
): string {
  validateStrategy(strategy);
  const key = assertNonBlank(input.key, "key");
  const prefix =
    options.prefix !== undefined && options.prefix.length > 0
      ? `${options.prefix}:`
      : "";

  if (strategy.kind === "key") {
    // One object per key — strongest per-key serialization.
    return `${prefix}key:${key}`;
  }

  if (strategy.kind === "hash") {
    const h = hashStringToUint32(key);
    const part = h % strategy.partitions;
    return `${prefix}hash:${strategy.partitions}:${part}`;
  }

  // tenant
  let tenant: string;
  if (typeof strategy.tenantId === "function") {
    tenant = assertNonBlank(strategy.tenantId(input), "tenantId");
  } else if (input.tenantId !== undefined && input.tenantId.trim() !== "") {
    tenant = assertNonBlank(input.tenantId, "tenantId");
  } else {
    tenant = assertNonBlank(strategy.tenantId, "tenantId");
  }
  return `${prefix}tenant:${tenant}`;
}

/**
 * Resolve a DO stub from a namespace using the shard name.
 */
export function getDoStub(
  namespace: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): unknown;
    getByName?(name: string): unknown;
  },
  shardName: string,
): unknown {
  if (typeof namespace.getByName === "function") {
    return namespace.getByName(shardName);
  }
  const id = namespace.idFromName(shardName);
  return namespace.get(id);
}

/** Recommended defaults documentation helper (not silent global). */
export const RECOMMENDED_HASH_PARTITIONS = 16;

/**
 * Factory helper: validate strategy at construction time.
 * Throws if strategy is missing or invalid (including forbidden "global").
 */
export function assertDoShardingStrategy(
  strategy: unknown,
): asserts strategy is DoShardingStrategy {
  if (strategy === null || typeof strategy !== "object") {
    throw new TypeError(
      "createDoPaymentStores requires explicit sharding (key | hash | tenant); never defaults to a global Durable Object",
    );
  }
  const kind = (strategy as { kind?: unknown }).kind;
  if (kind === "global" || kind === "singleton") {
    throw new TypeError(
      'sharding: kind "global" / "singleton" is forbidden — never route all payment work through one Durable Object',
    );
  }
  validateStrategy(strategy as DoShardingStrategy);
}
