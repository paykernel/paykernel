# @paykernel/store-durable-objects

Cloudflare **SQLite-backed Durable Object** stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** contracts (Phase 9).

> **Phase 17 production adapter.** Multi-host via **partitioned** Durable Objects with deterministic sharding. Strong coordination is **per partition (per DO instance)** — not a global multi-primary store.
>
> This is **not** `packages/store-d1` (shared D1).  
> This is **not** `packages/store-sqlite` (local single-host file DB).  
> This is **not** `packages/store-turso` (Turso / libSQL clients).  
> There is **no** generic `packages/adapter-cloudflare` umbrella.

## Install

```bash
bun add @paykernel/store-durable-objects
# optional DX types (not required at runtime):
bun add -d @cloudflare/workers-types
```

## Quick start (Worker client + sharding)

```ts
import {
  createDoPaymentStores,
} from "@paykernel/store-durable-objects";

// Explicit sharding required — NEVER a silent global Durable Object.
const stores = createDoPaymentStores({
  namespace: env.PAYMENTS_DO,
  sharding: { kind: "hash", partitions: 32 }, // or { kind: "key" }
});

const r = await stores.idempotency.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
// 1) claim  2) exit storage txn  3) external provider work  4) complete with leaseToken
```

### Direct storage path (tests / in-object)

```ts
import {
  createDoPaymentStoresFromStorage,
  createDoExecutor,
  createDoStores,
  migrateDoAdapter,
  PaymentsStoreObject,
} from "@paykernel/store-durable-objects";

// Explicit migrate — NEVER automatic on import or default createDoPaymentStores.
await migrateDoAdapter(storage); // DoStorageLike or DoExecutor

const bundle = createDoPaymentStoresFromStorage({ storage });
// or
const object = new PaymentsStoreObject({ storage });
await object.ensureSchema();
```

Normal operation uses the **Workers DO binding only** — no Cloudflare REST API or account token is required for store construction.

## Wrangler (SQLite-backed DO)

See [`examples/wrangler.toml`](./examples/wrangler.toml):

```toml
[[durable_objects.bindings]]
name = "PAYMENTS_DO"
class_name = "PaymentsStoreDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["PaymentsStoreDurableObject"]
```

Use **`new_sqlite_classes`** (not legacy KV-only `new_classes`) so `storage.sql` / `transactionSync` are available.

## Sharding

| Strategy | Behavior |
| -------- | -------- |
| `key` | One object per key — strongest per-key serialization |
| `hash` | Bounded partitions (`partitions >= 1`, recommend ≥ 16) |
| `tenant` | One object per tenant |

- **Within a shard:** requests serialize (single-threaded DO).
- **Across shards:** no global total order.
- **Hot-key risk:** many ops for the same key/tenant hit the same object → latency/cost concentration.
- **Forbidden:** defaulting all payment work to one global Durable Object.

Details: [docs/sharding.md](./docs/sharding.md).

## Claims (summary)

Prefer engine-level single-statement (sync `storage.sql.exec`):

```sql
INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING …
```

Multi-statement only inside `storage.transactionSync(() => { … })` — **sync callback, no await**.  
**Never** `BEGIN`/`COMMIT` via `sql.exec`. **Never** unprotected get-then-set.

Pattern: **claim → commit → external work → complete with lease token**.

Details: [docs/claims.md](./docs/claims.md).

## Guarantees (honest)

| Field | Value |
| ----- | ----- |
| `coordinationScope` | `multi-host` (partitioned DO) |
| `durability` | `durable` |
| `consistency.claims` | `strong` (within partition) |
| `consistency.readAfterWrite` | `strong` (within single DO instance) |
| `staleReadsPossible` | `false` (within partition) |

Cross-partition: no global order. Full notes: `DO_STORAGE_ADAPTER_MANIFEST` / [docs/guarantees.md](./docs/guarantees.md).

## Optional alarms (default-off)

One alarm **per DO** + due queue table; handlers are **at-least-once** and must re-check lease/claim state. Bounded retries + backoff/jitter. See [docs/alarms.md](./docs/alarms.md).

## Docs

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

| Doc | Topic |
| --- | ----- |
| [docs/overview.md](./docs/overview.md) | Architecture & when to use |
| [docs/sharding.md](./docs/sharding.md) | Strategies, ordering, hot keys |
| [docs/guarantees.md](./docs/guarantees.md) | Manifest honesty |
| [docs/claims.md](./docs/claims.md) | Atomic claims |
| [docs/transactions.md](./docs/transactions.md) | `transactionSync` sync-only; no external I/O in txn |
| [docs/crash-boundaries.md](./docs/crash-boundaries.md) | Crash / lease reclaim / eviction |
| [docs/wrangler.md](./docs/wrangler.md) | Binding + `new_sqlite_classes` |
| [docs/migrations.md](./docs/migrations.md) | Explicit ensure/migrate |
| [docs/testing.md](./docs/testing.md) | Mock DO SQL, FakeClock, partitions, alarms |
| [docs/alarms.md](./docs/alarms.md) | Optional partition alarms (at-least-once) |
| [docs/limits.md](./docs/limits.md) | DO CPU/storage limits; hot partitions; vs D1 |

## License

MIT
