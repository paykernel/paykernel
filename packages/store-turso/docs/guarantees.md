# Guarantees and storage manifest

**Export:** `TURSO_STORAGE_ADAPTER_MANIFEST` / `getTursoStorageAdapterManifest()`  
**Type:** `StorageAdapterManifest` from `@paykernel/testkit`  
**Validated at module load** via `assertStorageAdapterManifest`.  
**Source:** `src/manifest.ts`

## Declared fields

| Field | Value | Honesty note |
| ----- | ----- | ------------ |
| `name` | `"turso"` | This adapter only |
| `contracts.idempotency` | `true` | Lease-aware Phase 9 idempotency store |
| `contracts.webhookInbox` | `true` | Assignable to webhooks dual `WebhookInboxStore` |
| `contracts.reconciliation` | `true` | Lease-aware reconciliation store |
| `consistency.claims` | `"strong"` | Only with engine-level conditional UPSERT / txn-batch claims |
| `consistency.readAfterWrite` | `"strong"` | Same shared primary session semantics for normal remote deployments |
| `consistency.staleReadsPossible` | `false` | Under single-primary / consistent cluster assumptions |
| `coordinationScope` | **`"multi-host"`** | **All workers must share one remote Turso / libSQL primary** — not multi-primary without consensus |
| `durability` | `"durable"` | Rows survive process restart; service durability still depends on Turso/libSQL platform config |
| `supportsTransactions` | `true` | When executor provides `transaction` / transactional `batch` |
| `supportsLeases` | `true` | Token + generation fencing |
| `supportsRetentionCleanup` | `true` | `deleteExpired` paths |

## What multi-host means

- Multiple processes / hosts may call the same stores concurrently.
- Safety comes from **remote SQLite-compatible conditional writes**, not process-local mutexes.
- Point every worker at the **same** shared remote database.
- Local `file:` via `/libsql` is for CI and single-host testing — **not** a multi-host production model for a local file.
- Multi-region active-active without a single consensus leader is **out of scope** for this manifest’s `multi-host` claim.

## Strong claims

Strong claims require:

1. Single-statement (or engine-atomic batch/txn) reserve/claim SQL adapted from sql-store sqlite templates.
2. No application get-then-set claim strategy across round-trips.
3. Token-gated mutators that fail when zero rows match.

If an operator reimplements claim as non-atomic get-then-set (including via ORM builders alone), they must **not** advertise this manifest.

See [claims.md](./claims.md).

## What is NOT advertised

| Claim | Status |
| ----- | ------ |
| `/sync` subpath | **Not shipped** |
| Embedded-replica offline conflict resolution / true local-first multi-writer | **Not advertised** |
| Untested multi-region strong consistency without caveats | **Not advertised** |
| Interchangeability of `@tursodatabase/serverless` and `@libsql/client` | **False** — test independently |
| Equivalence to `adapter-sqlite` single-host local file | **False** — different scope and claim model |

See [embedded-replicas.md](./embedded-replicas.md).

## Crash notes (summary)

- Mid-handler crash → lease until expiry → reclaim with new token + generation++.
- Remote network uncertainty → re-read / re-claim; prefer indeterminate when appropriate — never invent terminal failure.
- Migrations explicit; never on import.
- Auth tokens redacted from store errors.

Full detail: [crash-boundaries.md](./crash-boundaries.md).

## Comparison with other adapters

| | Memory (testkit) | SQLite adapter | **Turso adapter** | Postgres adapter | Redis adapter |
| - | ---------------- | -------------- | ----------------- | ---------------- | ------------- |
| Scope | `single-process` | `single-host` | **`multi-host`** | `multi-host` | `multi-host` |
| Durability | `ephemeral` | `durable` (file) | **`durable`** (remote) | `durable` | `configuration-dependent` |
| Production | NON-PRODUCTION | Single-host local | Shared remote SQL | Shared PG | Optional coordination |
| Claims | In-process Map | IMMEDIATE + SQL | UPSERT / batch (async) | Conditional SQL | Lua |

## Related

- [overview.md](./overview.md)
- [store-contracts.md](../../testkit/docs/store-contracts.md) §7
- Package source: `src/manifest.ts`
