# Guarantees and storage manifest

**Export:** `POSTGRES_STORAGE_ADAPTER_MANIFEST` / `getPostgresStorageAdapterManifest()`  
**Type:** `StorageAdapterManifest` from `@paykernel/testkit`  
**Validated at module load** via `assertStorageAdapterManifest`.

## Declared fields

| Field | Value | Honesty note |
| ----- | ----- | ------------ |
| `name` | `"postgres"` | This adapter only |
| `contracts.idempotency` | `true` | Lease-aware Phase 9 idempotency store |
| `contracts.webhookInbox` | `true` | Assignable to webhooks dual `WebhookInboxStore` |
| `contracts.reconciliation` | `true` | Lease-aware reconciliation store |
| `consistency.claims` | `"strong"` | Only with engine-level conditional writes (sql-store templates) |
| `consistency.readAfterWrite` | `"strong"` | Same primary session semantics for normal deployments |
| `consistency.staleReadsPossible` | `false` | Under single-primary / consistent cluster assumptions |
| `coordinationScope` | `"multi-host"` | **All workers must share one PostgreSQL cluster/primary** — not multi-primary without consensus |
| `durability` | `"durable"` | Rows survive process restart; service durability still depends on WAL / replication config |
| `supportsTransactions` | `true` | When executor provides `withTransaction` |
| `supportsLeases` | `true` | Token + generation fencing |
| `supportsRetentionCleanup` | `true` | `deleteExpired` paths |

## What multi-host means

- Multiple processes / hosts may call the same stores concurrently.
- Safety comes from **PostgreSQL row-level conditional writes**, not process-local mutexes.
- Point every worker at the **same** database (primary or HA setup that presents a consistent view for these tables).
- Multi-primary / multi-region active-active without a single consensus leader is **out of scope** for this manifest’s `multi-host` claim.

## Strong claims

Strong claims require:

1. Single-statement (or engine-atomic) reserve/claim SQL from sql-store postgres templates.
2. No application get-then-set claim strategy across connections.
3. Token-gated mutators that fail when zero rows match.

If an operator reimplements claim as non-atomic get-then-set, they must **not** advertise this manifest.

## Not sole durability: advisory locks / SKIP LOCKED

| Mechanism | Role |
| --------- | ---- |
| Durable table row | **Source of truth** for work, lease, and terminal outcome |
| `FOR UPDATE SKIP LOCKED` | Optional **batch fairness** for list/due workers |
| Advisory locks | Must **not** be the only durable record of work |

## Crash notes (summary)

- Mid-handler crash → lease until expiry → reclaim with new token + generation++.
- Uncertain external side effect → prefer indeterminate / at-least-once idempotent handlers — never invent terminal failure.
- Migrations explicit; never on import.

Full detail: [crash-boundaries.md](./crash-boundaries.md).

## Comparison with memory (testkit)

| | Memory (testkit) | Postgres adapter |
| - | ---------------- | ---------------- |
| Scope | `single-process` | `multi-host` |
| Durability | `ephemeral` | `durable` |
| Production | **NON-PRODUCTION** | Production-oriented (when operated correctly) |
| Conformance | Same-isolate + FakeClock | Same suites + multi-connection live PG |

## Related

- [overview.md](./overview.md)
- [store-contracts.md](../../testkit/docs/store-contracts.md) §7
- Package source: `src/manifest.ts`
