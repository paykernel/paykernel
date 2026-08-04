# Guarantees and storage manifest

**Export:** `REDIS_STORAGE_ADAPTER_MANIFEST` / `getRedisStorageAdapterManifest()`  
**Type:** `StorageAdapterManifest` from `@paykernel/testkit`  
**Validated at module load** via `assertStorageAdapterManifest`.

## Declared fields

| Field | Value | Honesty note |
| ----- | ----- | ------------ |
| `name` | `"redis"` | This adapter only |
| `contracts.idempotency` | `true` | Lease-aware Phase 9 idempotency store |
| `contracts.webhookInbox` | `true` | Assignable to webhooks dual `WebhookInboxStore` |
| `contracts.reconciliation` | `true` | Lease-aware reconciliation store |
| `consistency.claims` | `"strong"` | Only with atomic Lua (never get-then-set) |
| `consistency.readAfterWrite` | `"strong"` | Same Redis instance / primary semantics for normal deployments |
| `consistency.staleReadsPossible` | `false` | Under single-primary / consistent service assumptions |
| `coordinationScope` | `"multi-host"` | **All workers must share one Redis/Valkey** |
| `durability` | `"configuration-dependent"` | AOF/RDB / managed persistence required for Redis restart survival |
| `supportsTransactions` | `false` | Claim path is Lua, not optional multi-statement SQL tx |
| `supportsLeases` | `true` | Token + generation fencing |
| `supportsRetentionCleanup` | `true` | `deleteExpired` (+ optional TTL) |

## Manifest notes (summary)

Source notes emphasize:

1. Coordination-safe multi-worker operation against shared Redis/Valkey.
2. Durable across **process** restart only if Redis still holds keys.
3. Durable across **Redis** restart only with correct AOF/RDB (or cloud persistence).
4. **Not** automatically suitable as the only long-term audit store — prefer hybrid SQL.
5. Atomic Lua; injectable clock via ARGV; Bun rejects Cluster/Sentinel; no Pub/Sub correctness; control offline queues; root has no drivers.

## Four durability distinctions

See [persistence.md](./persistence.md) for the full operator checklist. Do **not** advertise this adapter as blindly `durable` without configuration.

## What multi-host means

- Multiple processes / hosts may call the same stores concurrently.
- Safety comes from **server-side Lua**, not process-local mutexes.
- Point every worker at the **same** Redis/Valkey logical dataset.
- Redis Cluster requires hash-tag co-location (`clusterKeys`) on cluster-capable bindings; **Bun rejects** Cluster.

## Strong claims

Strong claims require:

1. Single Lua script per ownership transition.
2. No application get-then-set claim strategy across connections.
3. Token-gated mutators that return `lease_lost` when fencing fails.
4. Tagged script results mapped correctly (not ambiguous integers alone).

If an operator reimplements claim as non-atomic get-then-set, they must **not** advertise this manifest.

## Crash notes (summary)

- Mid-handler crash → lease until expiry → reclaim with new token + generation++.
- Uncertain external side effect → prefer indeterminate / at-least-once idempotent handlers — never invent terminal failure.
- Redis restart without persistence → keys gone; not a durable audit trail.

Full detail: [crash-boundaries.md](./crash-boundaries.md).

## Comparison

| | Memory (testkit) | Redis adapter | Postgres adapter |
| - | ---------------- | ------------- | ---------------- |
| Scope | `single-process` | `multi-host` | `multi-host` |
| Durability | `ephemeral` | `configuration-dependent` | `durable` |
| Production | **NON-PRODUCTION** | Production-oriented coordination (when operated correctly) | Production-oriented durable rows |
| Required? | Dev/test | **Optional** | **Optional** (but preferred durable default for many apps) |
| Conformance | Same-isolate + FakeClock | Same suites + live Redis (env-gated) | Same suites + live PG |

## Related

- [overview.md](./overview.md)
- [persistence.md](./persistence.md)
- [hybrid-examples.md](./hybrid-examples.md)
- [store-contracts.md](../../testkit/docs/store-contracts.md) §7
- Package source: `src/manifest.ts`
