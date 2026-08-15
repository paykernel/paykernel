/**
 * Deterministic sharding for Durable Object partitions (Phase 17.2).
 *
 * NEVER default to a single global Durable Object for all payment work.
 *
 * Strategies:
 * - `key`: one object per idempotency/event key (strongest per-key serialization)
 * - `hash`: bounded hash partitions (partitions >= 1; recommend >= 16).
 *   `partitions = 1` is a **single partition** (not a silent global DO) —
 *   all keys share one object (hot-key risk). Prefer >= 16.
 * - `tenant`: one object per tenant id. Worker client store contracts have
 *   **no** `tenantId` field — use a static `tenantId` string, or a function
 *   of **key only** (`(input) => fromKey(input.key)`).
 *
 * Ordering: within a shard/object, requests serialize (single-threaded DO).
 * Across shards, there is no global total order.
 *
 * Hot-key: many ops for the same key/tenant hit the same object → latency/cost
 * concentration. Prefer hash partitions when a single key would become a hotspot
 * (rare for pure idempotency keys; more relevant for tenant strategy).
 *
 * Discovery / cleanup (`listDue`, `listRetryable`, `deleteExpired`):
 * - `hash` (and static `tenant`): Worker client fans out to every enumerable
 *   partition (see {@link resolveDoDiscoveryPartitions}).
 * - `key` / dynamic `tenant`: unbounded object set — global list is unsupported
 *   without an external index (hard-fail, not silent sentinel miss).
 */

/**
 * Hash partition strategy.
 *
 * - `partitions`: modulo bucket count for routing (`h % partitions`).
 * - `layoutId` (optional): stable layout identity for object names. When set,
 *   shard names are `hash:{layoutId}:{part}` (N not embedded). When omitted,
 *   legacy names `hash:{partitions}:{part}` are kept for back-compat.
 *
 * **DO-1:** Changing `partitions` under the same layout identity orphans or
 * re-routes state. A durable layout meta object (see
 * {@link resolveDoHashLayoutMetaShardName}) pins the first-seen partition
 * count and hard-throws on mismatch. Changing N requires a new `layoutId`
 * and/or `objectNamePrefix` plus an explicit migration — never silent empty DOs.
 */
export type DoHashShardingStrategy = {
  kind: "hash";
  partitions: number;
  /**
   * Stable layout seal independent of a bare partition integer rename.
   * Prefer an explicit id (e.g. `"payments-v1"`). Omit only for legacy
   * `hash:{N}:{part}` name compatibility.
   */
  layoutId?: string;
};

export type DoShardingStrategy =
  | { kind: "key" }
  | DoHashShardingStrategy
  | {
      kind: "tenant";
      /**
       * Worker tenant strategy: a static tenant id, or a function of `input.key`
       * only. Store RPCs never pass `tenantId` — `input.tenantId` is unset on
       * the Worker client path.
       */
      tenantId: string | ((input: DoShardInput) => string);
    };

/** Meta shard suffix that pins hash partition count (never includes N alone as the only key). */
export const DO_HASH_LAYOUT_META_SUFFIX = "__pk_layout__";

export type DoShardInput = {
  /** Primary routing key (idempotency key, webhook event key, recon job key). */
  key: string;
  /**
   * Optional tenant for standalone `resolveDoShardName` callers.
   * Worker `createDoPaymentStores` never sets this (store contracts have no
   * tenantId) — prefer strategy `tenantId` string or `f(key)`.
   */
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
 * Result of resolving which partitions discovery/cleanup must visit.
 *
 * - `partitions`: fan-out to every listed shard name (stable order).
 * - `unsupported`: strategy has no finite partition set (hard-fail on list/cleanup).
 */
export type DoDiscoveryPartitions =
  | { kind: "partitions"; shardNames: readonly string[] }
  | { kind: "unsupported"; reason: string };

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

/**
 * Resolve the stable layout id used in hash shard / meta names.
 * Legacy (no layoutId): id is String(partitions) → names `hash:N:part`.
 */
export function resolveDoHashLayoutId(
  strategy: DoHashShardingStrategy,
): string {
  if (strategy.layoutId !== undefined) {
    return assertNonBlank(strategy.layoutId, "layoutId");
  }
  return String(strategy.partitions);
}

/**
 * Durable Object name for the hash layout meta record (pins partitions).
 *
 * **Must not embed `partitions`** — otherwise N-change renames the meta object
 * and the seal is lost (DO-1). Scope is `layoutId` or `"default"` (legacy) plus
 * optional `objectNamePrefix`.
 */
export function resolveDoHashLayoutMetaShardName(
  strategy: DoHashShardingStrategy,
  options: ResolveDoShardNameOptions = {},
): string {
  validateStrategy(strategy);
  const prefix = namePrefix(options);
  // Independent of partitions so config N change still hits the same meta DO.
  const layoutScope =
    strategy.layoutId !== undefined
      ? assertNonBlank(strategy.layoutId, "layoutId")
      : "default";
  return `${prefix}hash:${layoutScope}:${DO_HASH_LAYOUT_META_SUFFIX}`;
}

/**
 * Pure guard: same layout identity with different partition counts is forbidden.
 * Use when comparing previous vs next deploy config (DO-1).
 *
 * - Explicit `layoutId`: mismatch of partitions under the same id throws.
 * - Legacy (both omit layoutId): any partitions change throws — same durable
 *   meta scope (`default`) would pin the first-seen N at runtime.
 */
export function assertDoHashPartitionLayoutStable(
  previous: DoShardingStrategy,
  next: DoShardingStrategy,
): void {
  if (previous.kind !== "hash" || next.kind !== "hash") return;
  if (previous.partitions === next.partitions) return;

  const prevExplicit = previous.layoutId !== undefined;
  const nextExplicit = next.layoutId !== undefined;

  if (prevExplicit && nextExplicit) {
    const prevId = assertNonBlank(previous.layoutId!, "layoutId");
    const nextId = assertNonBlank(next.layoutId!, "layoutId");
    if (prevId === nextId) {
      throw new TypeError(
        `sharding DO-1: partitions changed ${previous.partitions} → ${next.partitions} under layoutId "${nextId}". ` +
          `This re-routes keys and orphans Durable Object state. Keep partitions fixed, or use a new layoutId/objectNamePrefix and migrate — never silently route to empty DOs.`,
      );
    }
    return;
  }

  if (!prevExplicit && !nextExplicit) {
    throw new TypeError(
      `sharding DO-1: partitions changed ${previous.partitions} → ${next.partitions} under legacy hash layout (no layoutId). ` +
        `Object names embed N so this orphans all prior Durable Object state. Keep partitions fixed, or set a new layoutId/objectNamePrefix and migrate — never silently route to empty DOs.`,
    );
  }
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
    if (strategy.layoutId !== undefined) {
      assertNonBlank(strategy.layoutId, "layoutId");
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

function namePrefix(options: ResolveDoShardNameOptions = {}): string {
  return options.prefix !== undefined && options.prefix.length > 0
    ? `${options.prefix}:`
    : "";
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
  const prefix = namePrefix(options);

  if (strategy.kind === "key") {
    // One object per key — strongest per-key serialization.
    return `${prefix}key:${key}`;
  }

  if (strategy.kind === "hash") {
    const h = hashStringToUint32(key);
    const part = h % strategy.partitions;
    // layoutId (or legacy String(partitions)) is the identity seal — not a free
    // rename when operators only bump N without migration (DO-1).
    const layoutId = resolveDoHashLayoutId(strategy);
    return `${prefix}hash:${layoutId}:${part}`;
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
 * Enumerate every partition shard name for discovery/cleanup fan-out.
 *
 * - `hash`: `hash:<N>:0` … `hash:<N>:(N-1)` (bounded; N=1 is a single partition).
 * - `tenant` with a static string `tenantId`: one `tenant:<id>` partition.
 * - `key` or dynamic `tenantId` function: `{ kind: "unsupported" }` — no silent
 *   sentinel (`__list__` / `__cleanup__`) partial success.
 *
 * Order is stable (ascending partition index / single tenant name).
 */
export function resolveDoDiscoveryPartitions(
  strategy: DoShardingStrategy,
  options: ResolveDoShardNameOptions = {},
): DoDiscoveryPartitions {
  validateStrategy(strategy);
  const prefix = namePrefix(options);

  if (strategy.kind === "hash") {
    const layoutId = resolveDoHashLayoutId(strategy);
    const names: string[] = [];
    for (let i = 0; i < strategy.partitions; i++) {
      names.push(`${prefix}hash:${layoutId}:${i}`);
    }
    return { kind: "partitions", shardNames: names };
  }

  if (strategy.kind === "tenant") {
    if (typeof strategy.tenantId === "function") {
      return {
        kind: "unsupported",
        reason:
          'listDue/listRetryable/deleteExpired cannot fan out under sharding kind "tenant" with a dynamic tenantId function (unbounded tenants). Use a static tenantId string, kind "hash", or address work by known key.',
      };
    }
    const tenant = assertNonBlank(strategy.tenantId, "tenantId");
    return {
      kind: "partitions",
      shardNames: [`${prefix}tenant:${tenant}`],
    };
  }

  // kind === "key"
  return {
    kind: "unsupported",
    reason:
      'listDue/listRetryable/deleteExpired cannot fan out under sharding kind "key" (unbounded key:<id> objects; no global index). Prefer kind "hash" for recovery schedulers, or claim/list by known key. Sentinel shards (__list__/__cleanup__) are not used.',
  };
}

/**
 * Convenience: shard names for discovery, or throw TypeError when unsupported.
 * Prefer {@link resolveDoDiscoveryPartitions} when you need a soft result.
 */
export function enumerateDoPartitionShardNames(
  strategy: DoShardingStrategy,
  options: ResolveDoShardNameOptions = {},
): readonly string[] {
  const resolved = resolveDoDiscoveryPartitions(strategy, options);
  if (resolved.kind === "unsupported") {
    throw new TypeError(resolved.reason);
  }
  return resolved.shardNames;
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
