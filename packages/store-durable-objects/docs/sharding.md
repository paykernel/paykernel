# Sharding strategies (Durable Objects)

**Package:** `@paykernel/store-durable-objects`

Deterministic routing of store operations to Durable Object partitions.  
**Never** default all payment work to one global Durable Object.

## Strategies

### `key`

One object per idempotency/event key (`resolveDoShardName` → `key:<key>`).

- **Pros:** strongest per-key serialization; natural isolation.
- **Cons:** unbounded object count; many cold starts if keys are high-cardinality and short-lived.
- **Use when:** pure per-key lease work and object count is acceptable.

### `hash`

Bounded partitions: `hash:<N>:<index>` with `partitions >= 1` (recommend **≥ 16**).

- **Pros:** caps object count; spreads load.
- **Cons:** keys on the same partition share a single-threaded queue; hot partitions possible if hash clusters.
- **Use when:** high volume with many distinct keys.

### `tenant`

One object per tenant (`tenant:<id>`).

- **Pros:** tenant isolation; simpler ops for B2B multi-tenant.
- **Cons:** **hot-key / hot-tenant** risk if one tenant dominates traffic.
- **Use when:** tenant isolation outweighs single-tenant hotspot risk.

## Ordering guarantees

| Scope | Ordering |
| ----- | -------- |
| Within one DO (partition) | Single-threaded serialization of storage ops |
| Across partitions | **No** global total order |

## Hot-key risks

- Many concurrent ops for the **same key** (key strategy) or **same tenant** hit one object → latency and cost concentration.
- Hash partitions mitigate per-key hotspots only when keys are diverse; a single popular key still maps to one partition.

## API

```ts
import {
  resolveDoShardName,
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
