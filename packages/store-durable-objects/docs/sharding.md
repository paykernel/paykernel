# Sharding strategies (Durable Objects)

**Package:** `@paykernel/store-durable-objects`

Deterministic routing of store operations to Durable Object partitions.  
**Never** default all payment work to one global Durable Object.

## Strategies

### `key`

One object per idempotency/event key (`resolveDoShardName` → `key:<key>`).

- **Pros:** strongest per-key serialization; natural isolation.
- **Cons:** unbounded object count; many cold starts if keys are high-cardinality and short-lived; **no global list/cleanup** (see [Discovery / cleanup](#discovery--cleanup-listdue-listretryable-deleteexpired)).
- **Use when:** pure per-key lease work and object count is acceptable; recovery schedulers that need `listDue` / `listRetryable` should prefer `hash`.

### `hash`

Bounded partitions: `hash:<N>:<index>` with `partitions >= 1` (recommend **≥ 16**).

- **Pros:** caps object count; spreads load; **supports honest multi-partition discovery fan-out**.
- **Cons:** keys on the same partition share a single-threaded queue; hot partitions possible if hash clusters; list/cleanup touches all N partitions.
- **Use when:** high volume with many distinct keys, or when reconciliation/webhook recovery pollers need cross-key discovery.
- **`partitions = 1` warning:** this is a **single partition**, not “no sharding” and not a silent global DO. All keys share one object (singleton hot-key risk). Prefer ≥ 16.

### `tenant`

One object per tenant (`tenant:<id>`).

- **Pros:** tenant isolation; simpler ops for B2B multi-tenant.
- **Cons:** **hot-key / hot-tenant** risk if one tenant dominates traffic.
- **Use when:** tenant isolation outweighs single-tenant hotspot risk.
- **Worker tenant strategy:** store contracts have **no** `tenantId` on reserve/claim inputs. Use a **static** `tenantId` string, or a function of **key only**. `createDoPaymentStores` does not call `shard(key, tenantId)`.
- **Discovery:** static string `tenantId` → single-partition list/cleanup; dynamic `tenantId` function → unsupported (unbounded tenants).

## Ordering guarantees

| Scope | Ordering |
| ----- | -------- |
| Within one DO (partition) | Single-threaded serialization of storage ops |
| Across partitions | **No** global total order |

## Hot-key risks

- Many concurrent ops for the **same key** (key strategy) or **same tenant** hit one object → latency and cost concentration.
- Hash partitions mitigate per-key hotspots only when keys are diverse; a single popular key still maps to one partition.

## Discovery / cleanup (`listDue`, `listRetryable`, `deleteExpired`)

Worker clients built by `createDoPaymentStores` **do not** route discovery/cleanup to sentinel keys (`__list__` / `__cleanup__`). That path was a silent partial miss under real sharding.

| Strategy | Behavior |
| -------- | -------- |
| `hash` (`partitions = N`) | **Fan-out** to all N partitions (`hash:N:0` … `hash:N:(N-1)`). Lists merge, dedupe by key, sort stably (`dueAt` / `availableAt` then key), then truncate to `limit`. Cleanup sums `deleted` with a **per-partition budget** and rotating start so later partitions are not starved when index 0 has more than `limit` eligible rows. Soft-release of expired claims still runs **inside** each partition SQL store. |
| `hash` (`partitions = 1`) | **Single partition** (warn: all keys share one DO; not a global-default bypass). Same fan-out path with size 1. |
| `tenant` + static `tenantId` | One partition (`tenant:<id>`). |
| `key` | **Hard-fail** with `StoreUnsupportedFeatureError` — unbounded `key:<id>` objects; no global index. Key-addressed `claim` / `complete` / `get` remain correct. Prefer `hash` for recovery schedulers. |
| `tenant` + dynamic `tenantId` function | **Hard-fail** (same reason: unbounded set). |

Helpers:

```ts
import {
  resolveDoDiscoveryPartitions,
  enumerateDoPartitionShardNames,
} from "@paykernel/store-durable-objects";

const d = resolveDoDiscoveryPartitions({ kind: "hash", partitions: 16 });
// d.kind === "partitions" → d.shardNames
```

**PERF-5 cost:** hash partitions have no shared due/retry index. A **single** enumerable isolate skips occupancy peek and lists directly. When `partitions > 1`, a correct global earliest-N still **peeks** every enumerable isolate (`{ occupied, earliest }`). Full `listDue` / `listRetryable` (bounded expired-lease UPDATE + SELECT) run only on shards that can contribute to the global earliest-N — occupied shards whose earliest sort key is not after the current cutoff. Later occupied shards are skipped. Peek is read-only and treats expired `claimed` as occupied so crash recovery is not skipped. A boolean / missing-earliest peek (rolling old Workers) is fail-closed to “must list”. Cost is **O(partitions)** cheap peek RPCs plus full list on the contributing prefix, not a full list on every occupied shard. Prefer a modest `partitions` count (16–64) and a bounded `limit`. `kind: "key"` hard-fails instead of silently missing work.

## API

```ts
import {
  resolveDoShardName,
  resolveDoDiscoveryPartitions,
  assertDoShardingStrategy,
  createDoPaymentStores,
  RECOMMENDED_HASH_PARTITIONS,
} from "@paykernel/store-durable-objects";

createDoPaymentStores({
  namespace: env.PAYMENTS_DO,
  sharding: { kind: "hash", partitions: RECOMMENDED_HASH_PARTITIONS },
});
```

`kind: "global"` / `"singleton"` is **rejected**.
