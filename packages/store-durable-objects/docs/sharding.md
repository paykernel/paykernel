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

### `tenant`

One object per tenant (`tenant:<id>`).

- **Pros:** tenant isolation; simpler ops for B2B multi-tenant.
- **Cons:** **hot-key / hot-tenant** risk if one tenant dominates traffic.
- **Use when:** tenant isolation outweighs single-tenant hotspot risk.
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
| `hash` (`partitions = N`) | **Fan-out** to all N partitions (`hash:N:0` … `hash:N:(N-1)`). Lists merge, dedupe by key, sort stably (`dueAt` / `availableAt` then key), then truncate to `limit`. Cleanup sums `deleted` (with a global `limit` budget walked in partition order). Soft-release of expired claims still runs **inside** each partition SQL store. |
| `hash` (`partitions = 1`) | Single partition — same fan-out path with size 1 (fast). |
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

**Cost note:** hash fan-out may touch cold empty partitions (DO materialization). Prefer a modest `partitions` count (e.g. 16–64) and a bounded list `limit`.

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
