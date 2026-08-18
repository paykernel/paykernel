/**
 * Worker-side client: async Phase 9 stores via DO stub RPC + sharding.
 *
 * createDoPaymentStores({ namespace, sharding }) routes each op to the correct
 * partition via resolveDoShardName → idFromName/getByName → stub method.
 *
 * Discovery / cleanup (`listDue`, `listRetryable`, `deleteExpired`):
 * - hash (and static tenant): fan-out to every enumerable partition, merge/sum.
 * - key / dynamic tenant: hard-fail with StoreUnsupportedFeatureError (no
 *   silent sentinel `__list__` / `__cleanup__` partial success).
 *
 * Does **not** migrate. Does **not** default to a global Durable Object.
 * Does **not** require Cloudflare REST / account credentials.
 */

import type {
  ClaimReconciliationInput,
  ClaimResult,
  ClaimWebhookInput,
  ClaimWebhookResult,
  CleanupInput,
  CleanupResult,
  CompleteIdempotencyInput,
  CompleteReconciliationInput,
  CompleteWebhookInput,
  FailReconciliationInput,
  FailWebhookInput,
  IdempotencyKey,
  IdempotencyRecord,
  IdempotencyReservation,
  IdempotencyStore,
  ListDueInput,
  ListRetryableInput,
  MarkIndeterminateInput,
  MarkManualReviewInput,
  ReconciliationKey,
  ReconciliationRecord,
  ReconciliationStore,
  RenewIdempotencyReservationInput,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  RenewReservationResult,
  RenewWebhookLeaseInput,
  RenewWebhookLeaseResult,
  ReserveIdempotencyInput,
  ScheduleReconciliationInput,
  ScheduleResult,
  WebhookEventKey,
  WebhookInboxRecord,
  WebhookInboxStore,
} from "@paykernel/store-contracts";
import { StoreUnsupportedFeatureError } from "@paykernel/store-contracts";
import { createSchemaNamespace } from "@paykernel/sql-foundation";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";
import type {
  DoClientStoreOptions,
  DoFromStorageOptions,
  DoNamespaceLike,
  DoStorageLike,
  DoStoresBundle,
  DoStubLike,
} from "./types";
import { createSystemClock } from "./clock";
import type { StoreClock } from "./clock";
import {
  assertDoShardingStrategy,
  getDoStub,
  resolveDoDiscoveryPartitions,
  resolveDoHashLayoutMetaShardName,
  resolveDoShardName,
  type DoShardingStrategy,
  type DoShardInput,
  type ResolveDoShardNameOptions,
} from "./sharding";
import { createDoExecutor } from "./sql-executor";
import { createDoIdempotencyStore } from "./stores/idempotency-store";
import { createDoWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createDoReconciliationStore } from "./stores/reconciliation-store";
import { DO_STORAGE_ADAPTER_MANIFEST } from "./manifest";
import { PaymentsStoreObject } from "./object/payments-store-object";
import { withMappedErrors } from "./errors";
import type { ShardOccupancyHint } from "./occupancy";

export type { ShardOccupancyHint } from "./occupancy";

/** Worker-stub stores cannot offer multi-mutation atomicity across DO boundaries. */
const WORKER_CLIENT_TX_UNSUPPORTED =
  "Worker-client withTransaction is not supported: Durable Object stores cannot provide cross-object multi-mutation atomicity. Use single-statement claims, or withTransaction on in-object stores (createDo*Store / PaymentsStoreObject).";

function rejectWorkerClientTransaction(): never {
  throw new StoreUnsupportedFeatureError(WORKER_CLIENT_TX_UNSUPPORTED);
}

const DEFAULT_LIST_LIMIT = 100;

function resolveStub(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  input: DoShardInput,
  objectNamePrefix?: string,
): DoStubLike {
  const nameOpts =
    objectNamePrefix !== undefined ? { prefix: objectNamePrefix } : {};
  const shardName = resolveDoShardName(sharding, input, nameOpts);
  return getDoStub(namespace, shardName) as DoStubLike;
}

function nameOptsForPrefix(
  objectNamePrefix: string | undefined,
): ResolveDoShardNameOptions {
  return objectNamePrefix !== undefined && objectNamePrefix.length > 0
    ? { prefix: objectNamePrefix }
    : {};
}

function stubForShardName(
  namespace: DoNamespaceLike,
  shardName: string,
): DoStubLike {
  return getDoStub(namespace, shardName) as DoStubLike;
}

async function callStub<T>(
  stub: DoStubLike,
  method: string,
  ...args: unknown[]
): Promise<T> {
  // Cloudflare DO RPC stubs are special proxies — call methods directly.
  // Do NOT use Function.prototype.apply/call (Workers treats "apply" as RPC).
  const fn = stub[method];
  if (typeof fn !== "function") {
    throw new TypeError(`DO stub missing RPC method: ${method}`);
  }
  return (await fn(...args)) as T;
}

type FanOutStoreContext = {
  namespace: DoNamespaceLike;
  sharding: DoShardingStrategy;
  objectNamePrefix: string | undefined;
  /** Shared once-promise for DO-1 hash layout pin (optional). */
  ensureHashLayout?: () => Promise<void>;
  /** Forwarded on every RPC so the DO applies the Worker table prefix. */
  tableNamespace?: SchemaNamespaceConfig;
  /** Rotate bounded deleteExpired start so later partitions are not starved. */
  cleanupCursor: { next: number };
};

/** Extra RPC args after the store input (tableNamespace when the Worker sent one). */
function rpcTail(tableNamespace?: SchemaNamespaceConfig): unknown[] {
  return tableNamespace !== undefined ? [tableNamespace] : [];
}

/**
 * Pin hash partitions on a stable layout meta DO (DO-1).
 * First writer seals N; later configs with a different N hard-throw.
 */
export async function ensureDoHashPartitionLayout(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  objectNamePrefix?: string,
): Promise<void> {
  if (sharding.kind !== "hash") return;
  const metaName = resolveDoHashLayoutMetaShardName(
    sharding,
    nameOptsForPrefix(objectNamePrefix),
  );
  const stub = stubForShardName(namespace, metaName);
  await callStub<void>(stub, "bindHashPartitionLayout", sharding.partitions);
}

function createHashLayoutGate(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  objectNamePrefix: string | undefined,
): () => Promise<void> {
  if (sharding.kind !== "hash") {
    return async () => {};
  }
  let once: Promise<void> | undefined;
  return () => {
    if (!once) {
      once = ensureDoHashPartitionLayout(
        namespace,
        sharding,
        objectNamePrefix,
      ).catch((err) => {
        once = undefined;
        throw err;
      });
    }
    return once;
  };
}

/**
 * Resolve enumerable partitions for listDue/listRetryable/deleteExpired, or hard-fail.
 * Never falls back to sentinel keys (`__list__` / `__cleanup__`).
 */
function requireDiscoveryShardNames(ctx: FanOutStoreContext): readonly string[] {
  const resolved = resolveDoDiscoveryPartitions(
    ctx.sharding,
    nameOptsForPrefix(ctx.objectNamePrefix),
  );
  if (resolved.kind === "unsupported") {
    throw new StoreUnsupportedFeatureError(resolved.reason);
  }
  return resolved.shardNames;
}

type FanOutListOptions<T extends { key: string }> = FanOutStoreContext & {
  method: string;
  /** Occupancy RPC; full `method` runs only on shards that can beat earliest-N. */
  peekMethod: string;
  input: { limit?: number; now?: string };
  sortKey: (row: T) => string;
};

type OccupiedShard = {
  shardName: string;
  hint: ShardOccupancyHint;
};

type PeekShardOptions = {
  namespace: DoNamespaceLike;
  shardName: string;
  peekMethod: string;
  input: { now?: string };
  tableNamespace?: SchemaNamespaceConfig;
};

function occupancyFromPeekPayload(payload: unknown): ShardOccupancyHint {
  if (payload === false) return { occupied: false };
  if (payload === true) return { occupied: true };
  if (payload !== null && typeof payload === "object") {
    const hint = payload as { occupied?: unknown; earliest?: unknown };
    // Only an explicit `false` is empty. `1` / `"yes"` / missing must list.
    if (hint.occupied === false) return { occupied: false };
    const earliest =
      typeof hint.earliest === "string" && hint.earliest.length > 0
        ? hint.earliest
        : undefined;
    return earliest !== undefined ? { occupied: true, earliest } : { occupied: true };
  }
  // Unexpected peek result: fail-closed to occupied (unknown earliest).
  return { occupied: true };
}

/**
 * Occupancy probe for PERF-5. Missing peek RPCs (rolling old Workers) fail
 * closed to occupied + unknown earliest so discovery still full-lists.
 */
async function peekShardHint(
  options: PeekShardOptions,
): Promise<ShardOccupancyHint> {
  try {
    const payload = await callStub<unknown>(
      stubForShardName(options.namespace, options.shardName),
      options.peekMethod,
      options.input,
      ...rpcTail(options.tableNamespace),
    );
    return occupancyFromPeekPayload(payload);
  } catch (err) {
    if (
      err instanceof TypeError &&
      String(err.message).includes("missing RPC method")
    ) {
      return { occupied: true };
    }
    throw err;
  }
}

function compareListedRows<T extends { key: string }>(
  left: T,
  right: T,
  sortKey: (row: T) => string,
): number {
  const leftKey = sortKey(left);
  const rightKey = sortKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function compareOccupiedShards(left: OccupiedShard, right: OccupiedShard): number {
  if (left.hint.earliest === undefined && right.hint.earliest === undefined) {
    return left.shardName < right.shardName
      ? -1
      : left.shardName > right.shardName
        ? 1
        : 0;
  }
  if (left.hint.earliest === undefined) return -1;
  if (right.hint.earliest === undefined) return 1;
  if (left.hint.earliest !== right.hint.earliest) {
    return left.hint.earliest < right.hint.earliest ? -1 : 1;
  }
  return left.shardName < right.shardName
    ? -1
    : left.shardName > right.shardName
      ? 1
      : 0;
}

function collectOccupiedShards(
  shardNames: readonly string[],
  hints: readonly ShardOccupancyHint[],
): OccupiedShard[] {
  const occupied: OccupiedShard[] = [];
  for (let i = 0; i < shardNames.length; i++) {
    // Missing slot is fail-closed occupied so a short peek array cannot hide work.
    const hint = hints[i] ?? { occupied: true };
    if (!hint.occupied) continue;
    occupied.push({ shardName: shardNames[i]!, hint });
  }
  occupied.sort(compareOccupiedShards);
  return occupied;
}

function mergeFanOutRows<T extends { key: string }>(
  rows: T[],
  incoming: T[],
  seenKeys: Set<string>,
  limit: number,
  sortKey: (row: T) => string,
): void {
  for (const row of incoming) {
    if (seenKeys.has(row.key)) continue;
    seenKeys.add(row.key);
    rows.push(row);
  }
  rows.sort((left, right) => compareListedRows(left, right, sortKey));
  if (rows.length > limit) rows.length = limit;
}

function earliestNCutoff<T>(
  merged: T[],
  limit: number,
  sortKey: (row: T) => string,
): string | undefined {
  if (merged.length < limit) return undefined;
  return sortKey(merged[limit - 1]!);
}

function shardsForSecondWave(
  remaining: OccupiedShard[],
  cutoff: string | undefined,
): OccupiedShard[] {
  if (cutoff === undefined) return remaining;
  return remaining.filter((shard) => {
    const earliest = shard.hint.earliest;
    return earliest !== undefined && earliest <= cutoff;
  });
}

function firstWaveOccupiedShards(
  occupied: OccupiedShard[],
  limit: number,
): OccupiedShard[] {
  const unknownEarliest = occupied.filter(
    (shard) => shard.hint.earliest === undefined,
  );
  const knownEarliest = occupied.filter(
    (shard) => shard.hint.earliest !== undefined,
  );
  return [
    ...unknownEarliest,
    ...knownEarliest.slice(0, Math.min(limit, knownEarliest.length)),
  ];
}

type ListAndMergeFanOutRequest<T extends { key: string }> = {
  shards: OccupiedShard[];
  listShard: (shardName: string) => Promise<T[]>;
  merged: T[];
  seenKeys: Set<string>;
  limit: number;
  sortKey: (row: T) => string;
};

async function listAndMergeFanOut<T extends { key: string }>(
  request: ListAndMergeFanOutRequest<T>,
): Promise<void> {
  if (request.shards.length === 0) return;
  mergeFanOutRows(
    request.merged,
    (
      await Promise.all(
        request.shards.map((shard) => request.listShard(shard.shardName)),
      )
    ).flat(),
    request.seenKeys,
    request.limit,
    request.sortKey,
  );
}

/**
 * Fan-out listDue/listRetryable across enumerable partitions; merge, dedupe by
 * key, stable sort, then truncate to limit.
 *
 * PERF-5: peek every enumerable isolate when there is more than one
 * (no shared global occupancy index). A single isolate skips peek and lists
 * directly. Full list (bounded expired-lease UPDATE + SELECT) runs only on
 * shards that can contribute to the global earliest-N: occupied shards whose
 * earliest sort key is not strictly after the current cutoff. Later occupied
 * shards are skipped. Peek treats expired claimed as occupied so crash
 * recovery is not skipped. A boolean / missing-earliest peek is fail-closed
 * (must list).
 */
async function fanOutListByKey<T extends { key: string }>(
  options: FanOutListOptions<T>,
): Promise<T[]> {
  if (options.ensureHashLayout) await options.ensureHashLayout();
  const { namespace, method, peekMethod, input, sortKey } = options;
  const shardNames = requireDiscoveryShardNames(options);
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  const peekInput = input.now !== undefined ? { now: input.now } : {};
  const perPartitionInput = { ...input, limit };
  const nsArgs = rpcTail(options.tableNamespace);

  // PERF-5: a single enumerable isolate cannot lose earliest-N work — list it
  // directly and skip the occupancy peek RPC (still fail-closed for N>1).
  if (shardNames.length === 1) {
    const merged: T[] = [];
    mergeFanOutRows(
      merged,
      await callStub<T[]>(
        stubForShardName(namespace, shardNames[0]!),
        method,
        perPartitionInput,
        ...nsArgs,
      ),
      new Set<string>(),
      limit,
      sortKey,
    );
    return merged.slice(0, limit);
  }

  const occupancy = await Promise.all(
    shardNames.map((shardName) => {
      const peek: PeekShardOptions = {
        namespace,
        shardName,
        peekMethod,
        input: peekInput,
      };
      if (options.tableNamespace !== undefined) {
        peek.tableNamespace = options.tableNamespace;
      }
      return peekShardHint(peek);
    }),
  );

  const occupied = collectOccupiedShards(shardNames, occupancy);
  if (occupied.length === 0) return [];

  const listShard = (shardName: string) =>
    callStub<T[]>(
      stubForShardName(namespace, shardName),
      method,
      perPartitionInput,
      ...nsArgs,
    );

  const firstWave = firstWaveOccupiedShards(occupied, limit);
  const listedNames = new Set(firstWave.map((shard) => shard.shardName));
  const seenKeys = new Set<string>();
  const merged: T[] = [];
  await listAndMergeFanOut({
    shards: firstWave,
    listShard,
    merged,
    seenKeys,
    limit,
    sortKey,
  });
  await listAndMergeFanOut({
    shards: shardsForSecondWave(
      occupied.filter(
        (shard) =>
          !listedNames.has(shard.shardName) && shard.hint.earliest !== undefined,
      ),
      earliestNCutoff(merged, limit, sortKey),
    ),
    listShard,
    merged,
    seenKeys,
    limit,
    sortKey,
  });

  return merged.slice(0, limit);
}

type FanOutDeleteOptions = FanOutStoreContext & {
  method: string;
  input: CleanupInput;
};

/**
 * Fan-out deleteExpired across partitions; sum deleted counts.
 *
 * Unbounded: parallel all partitions.
 * Bounded: per-partition budget + rotating start so later hash partitions
 * are not starved when index 0 has more than `limit` eligible rows (P17-CLEAN).
 */
async function fanOutDeleteExpired(
  options: FanOutDeleteOptions,
): Promise<CleanupResult> {
  if (options.ensureHashLayout) await options.ensureHashLayout();
  const { namespace, method, input } = options;
  const shardNames = requireDiscoveryShardNames(options);
  const nsArgs = rpcTail(options.tableNamespace);
  const limit = input.limit;

  if (limit === undefined) {
    const results = await Promise.all(
      shardNames.map((name) =>
        callStub<CleanupResult>(
          stubForShardName(namespace, name),
          method,
          input,
          ...nsArgs,
        ),
      ),
    );
    let deleted = 0;
    for (const r of results) deleted += r.deleted;
    return { deleted };
  }

  const n = shardNames.length;
  if (n === 0) return { deleted: 0 };

  const start = options.cleanupCursor.next % n;
  options.cleanupCursor.next = (options.cleanupCursor.next + 1) % n;

  const base = Math.floor(limit / n);
  const extra = limit % n;
  let deleted = 0;

  for (let i = 0; i < n; i++) {
    const budget = base + (i < extra ? 1 : 0);
    if (budget <= 0) continue;
    const idx = (start + i) % n;
    const partInput: CleanupInput = { before: input.before, limit: budget };
    const r = await callStub<CleanupResult>(
      stubForShardName(namespace, shardNames[idx]!),
      method,
      partInput,
      ...nsArgs,
    );
    deleted += r.deleted;
  }

  return { deleted };
}

function createIdempotencyClient(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  objectNamePrefix: string | undefined,
  ensureHashLayout: () => Promise<void>,
  tableNamespace: SchemaNamespaceConfig | undefined,
  cleanupCursor: { next: number },
): IdempotencyStore {
  // Store contracts have no tenantId — tenant strategy is static or f(key).
  const shard = (key: string) =>
    resolveStub(namespace, sharding, { key }, objectNamePrefix);
  const nsArgs = rpcTail(tableNamespace);

  const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureHashLayout();
    return fn();
  };

  return {
    async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "reserveIdempotency", input, ...nsArgs),
        ),
      );
    },
    async renew(
      input: RenewIdempotencyReservationInput,
    ): Promise<RenewReservationResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "renewIdempotency", input, ...nsArgs),
        ),
      );
    },
    async complete(input: CompleteIdempotencyInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "completeIdempotency", input, ...nsArgs),
        ),
      );
    },
    async markIndeterminate(input: MarkIndeterminateInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(
            shard(input.key),
            "markIdempotencyIndeterminate",
            input,
            ...nsArgs,
          ),
        ),
      );
    },
    async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
      return withMappedErrors(() =>
        gated(() => callStub(shard(key), "getIdempotency", key, ...nsArgs)),
      );
    },
    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() =>
        fanOutDeleteExpired({
          namespace,
          sharding,
          objectNamePrefix,
          ensureHashLayout,
          method: "deleteExpiredIdempotency",
          input,
          cleanupCursor,
          ...(tableNamespace !== undefined ? { tableNamespace } : {}),
        }),
      );
    },
    async withTransaction<T>(_fn: () => Promise<T> | T): Promise<T> {
      return rejectWorkerClientTransaction();
    },
  };
}

function createWebhookClient(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  objectNamePrefix: string | undefined,
  ensureHashLayout: () => Promise<void>,
  tableNamespace: SchemaNamespaceConfig | undefined,
  cleanupCursor: { next: number },
): WebhookInboxStore {
  const shard = (key: string) =>
    resolveStub(namespace, sharding, { key }, objectNamePrefix);
  const nsArgs = rpcTail(tableNamespace);

  const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureHashLayout();
    return fn();
  };

  const fanCtx = {
    namespace,
    sharding,
    objectNamePrefix,
    ensureHashLayout,
    cleanupCursor,
    ...(tableNamespace !== undefined ? { tableNamespace } : {}),
  };

  return {
    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "claimWebhook", input, ...nsArgs),
        ),
      );
    },
    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "renewWebhook", input, ...nsArgs),
        ),
      );
    },
    async complete(input: CompleteWebhookInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "completeWebhook", input, ...nsArgs),
        ),
      );
    },
    async fail(input: FailWebhookInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "failWebhook", input, ...nsArgs),
        ),
      );
    },
    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      return withMappedErrors(() =>
        gated(() => callStub(shard(key), "getWebhook", key, ...nsArgs)),
      );
    },
    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      return withMappedErrors(() =>
        fanOutListByKey<WebhookInboxRecord>({
          ...fanCtx,
          method: "listRetryableWebhooks",
          peekMethod: "peekRetryableWebhooks",
          input,
          sortKey: (row) => row.availableAt,
        }),
      );
    },
    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() =>
        fanOutDeleteExpired({
          ...fanCtx,
          method: "deleteExpiredWebhooks",
          input,
        }),
      );
    },
    async withTransaction<T>(_fn: () => Promise<T> | T): Promise<T> {
      return rejectWorkerClientTransaction();
    },
  };
}

function createReconciliationClient(
  namespace: DoNamespaceLike,
  sharding: DoShardingStrategy,
  objectNamePrefix: string | undefined,
  ensureHashLayout: () => Promise<void>,
  tableNamespace: SchemaNamespaceConfig | undefined,
  cleanupCursor: { next: number },
): ReconciliationStore {
  const shard = (key: string) =>
    resolveStub(namespace, sharding, { key }, objectNamePrefix);
  const nsArgs = rpcTail(tableNamespace);

  const gated = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureHashLayout();
    return fn();
  };

  const fanCtx = {
    namespace,
    sharding,
    objectNamePrefix,
    ensureHashLayout,
    cleanupCursor,
    ...(tableNamespace !== undefined ? { tableNamespace } : {}),
  };

  return {
    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "scheduleReconciliation", input, ...nsArgs),
        ),
      );
    },
    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "claimReconciliation", input, ...nsArgs),
        ),
      );
    },
    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "renewReconciliation", input, ...nsArgs),
        ),
      );
    },
    async complete(input: CompleteReconciliationInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(
            shard(input.key),
            "completeReconciliation",
            input,
            ...nsArgs,
          ),
        ),
      );
    },
    async fail(input: FailReconciliationInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(shard(input.key), "failReconciliation", input, ...nsArgs),
        ),
      );
    },
    async markManualReview(input: MarkManualReviewInput): Promise<void> {
      return withMappedErrors(() =>
        gated(() =>
          callStub(
            shard(input.key),
            "markReconciliationManualReview",
            input,
            ...nsArgs,
          ),
        ),
      );
    },
    async get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined> {
      return withMappedErrors(() =>
        gated(() => callStub(shard(key), "getReconciliation", key, ...nsArgs)),
      );
    },
    async listDue(input: ListDueInput): Promise<ReconciliationRecord[]> {
      return withMappedErrors(() =>
        fanOutListByKey<ReconciliationRecord>({
          ...fanCtx,
          method: "listDueReconciliation",
          peekMethod: "peekDueReconciliation",
          input,
          sortKey: (row) => row.dueAt,
        }),
      );
    },
    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() =>
        fanOutDeleteExpired({
          ...fanCtx,
          method: "deleteExpiredReconciliation",
          input,
        }),
      );
    },
    async withTransaction<T>(_fn: () => Promise<T> | T): Promise<T> {
      return rejectWorkerClientTransaction();
    },
  };
}

/**
 * Primary ergonomic Worker factory: namespace + explicit sharding → three stores.
 *
 * ```ts
 * const stores = createDoPaymentStores({
 *   namespace: env.PAYMENTS_DO,
 *   sharding: { kind: "hash", partitions: 32 },
 * });
 * ```
 *
 * Does **not** migrate schema. Does **not** default to one global DO.
 *
 * Under `kind: "hash"`, `listDue` / `listRetryable` peek every enumerable
 * partition, then full-list only shards that can contribute to the global
 * earliest-N (PERF-5). `deleteExpired` still fans out. Under `kind: "key"`,
 * those methods throw {@link StoreUnsupportedFeatureError}.
 */
export function createDoPaymentStores(
  options: DoClientStoreOptions,
): DoStoresBundle {
  assertDoShardingStrategy(options.sharding);
  const clock = options.clock ?? createSystemClock();
  const ns = createSchemaNamespace(options.tableNamespace ?? {});
  const prefix = options.objectNamePrefix;
  const sharding = options.sharding;
  const tableNamespace = options.tableNamespace;
  const cleanupCursor = { next: 0 };
  const ensureHashLayout = createHashLayoutGate(
    options.namespace,
    sharding,
    prefix,
  );

  const idempotency = createIdempotencyClient(
    options.namespace,
    sharding,
    prefix,
    ensureHashLayout,
    tableNamespace,
    cleanupCursor,
  );
  const webhookInbox = createWebhookClient(
    options.namespace,
    sharding,
    prefix,
    ensureHashLayout,
    tableNamespace,
    cleanupCursor,
  );
  const reconciliation = createReconciliationClient(
    options.namespace,
    sharding,
    prefix,
    ensureHashLayout,
    tableNamespace,
    cleanupCursor,
  );

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    namespace: ns,
    clock,
    manifest: DO_STORAGE_ADAPTER_MANIFEST,
    sharding,
  };
}

/**
 * Test / single-partition path: build stores from DoStorageLike (or partition map).
 * Does **not** migrate.
 */
export function createDoPaymentStoresFromStorage(
  options: DoFromStorageOptions,
): DoStoresBundle {
  const clock = options.clock ?? createSystemClock();
  const ns = createSchemaNamespace(options.tableNamespace ?? {});

  // Single storage: direct executor path
  if (
    options.storage !== null &&
    typeof options.storage === "object" &&
    "sql" in options.storage &&
    "transactionSync" in options.storage
  ) {
    const storage = options.storage as DoStorageLike;
    const executor = createDoExecutor(storage);
    const storeOpts = {
      executor,
      clock,
      ...(options.tableNamespace !== undefined
        ? { namespace: options.tableNamespace }
        : {}),
    };
    return {
      idempotency: createDoIdempotencyStore(storeOpts),
      webhookInbox: createDoWebhookInboxStore(storeOpts),
      reconciliation: createDoReconciliationStore(storeOpts),
      namespace: ns,
      clock,
      manifest: DO_STORAGE_ADAPTER_MANIFEST,
      executor,
      ...(options.sharding !== undefined ? { sharding: options.sharding } : {}),
    };
  }

  // Multi-partition map: structural namespace routing to PaymentsStoreObject per shard.
  // Pre-register every shard name used by resolveDoShardName (tests: mock-namespace).
  assertDoShardingStrategy(options.sharding);
  const sharding = options.sharding!;
  const map = normalizeStorageMap(options.storage);
  const objects = new Map<string, PaymentsStoreObject>();

  function getObject(shardName: string): PaymentsStoreObject {
    let obj = objects.get(shardName);
    if (!obj) {
      const storage = map.get(shardName);
      if (!storage) {
        throw new Error(
          `createDoPaymentStoresFromStorage: no storage for shard "${shardName}"`,
        );
      }
      const objOpts: {
        storage: DoStorageLike;
        clock: StoreClock;
        namespace?: typeof options.tableNamespace;
        alarms?: typeof options.alarms;
      } = { storage, clock };
      if (options.tableNamespace !== undefined) {
        objOpts.namespace = options.tableNamespace;
      }
      if (options.alarms !== undefined) {
        objOpts.alarms = options.alarms;
      }
      obj = new PaymentsStoreObject(objOpts);
      objects.set(shardName, obj);
    }
    return obj;
  }

  const namespace: DoNamespaceLike = {
    idFromName(name: string) {
      return { toString: () => name };
    },
    get(id: { toString(): string }) {
      return getObject(id.toString()) as unknown as DoStubLike;
    },
    getByName(name: string) {
      return getObject(name) as unknown as DoStubLike;
    },
  };

  const clientOpts: DoClientStoreOptions = {
    namespace,
    sharding,
    clock,
  };
  if (options.tableNamespace !== undefined) {
    clientOpts.tableNamespace = options.tableNamespace;
  }
  if (options.objectNamePrefix !== undefined) {
    clientOpts.objectNamePrefix = options.objectNamePrefix;
  }
  return createDoPaymentStores(clientOpts);
}

function normalizeStorageMap(
  storage:
    | DoStorageLike
    | Map<string, DoStorageLike>
    | Record<string, DoStorageLike>,
): Map<string, DoStorageLike> {
  if (storage instanceof Map) return storage;
  if (
    storage !== null &&
    typeof storage === "object" &&
    "sql" in storage &&
    "transactionSync" in storage
  ) {
    return new Map([["default", storage as DoStorageLike]]);
  }
  const m = new Map<string, DoStorageLike>();
  for (const [k, v] of Object.entries(storage as Record<string, DoStorageLike>)) {
    m.set(k, v);
  }
  return m;
}

/** Binding helper: idempotency store only. Does not migrate. */
export function createDoIdempotencyStoreFromNamespace(
  options: DoClientStoreOptions,
): IdempotencyStore {
  return createDoPaymentStores(options).idempotency;
}

/** Binding helper: webhook inbox store only. Does not migrate. */
export function createDoWebhookInboxStoreFromNamespace(
  options: DoClientStoreOptions,
): WebhookInboxStore {
  return createDoPaymentStores(options).webhookInbox;
}

/** Binding helper: reconciliation store only. Does not migrate. */
export function createDoReconciliationStoreFromNamespace(
  options: DoClientStoreOptions,
): ReconciliationStore {
  return createDoPaymentStores(options).reconciliation;
}
