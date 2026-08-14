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
| `listDue` default path | Soft-releases expired `claimed` rows, then a plain `SELECT` of due `scheduled` work. **Does not** use `FOR UPDATE SKIP LOCKED`. |
| `FOR UPDATE SKIP LOCKED` | Optional **batch fairness** only — not used on the default `listDue` scan |
| Advisory locks | Must **not** be the only durable record of work |

## Status write-path honesty

CHECK constraints allow more statuses than this adapter writes:

| Store | CHECK-legal extra | What postgres actually writes |
| ----- | ----------------- | ----------------------------- |
| Idempotency | `expired` | **Never** written. Reclaim uses `lease_expires_at`. `expired` remains legal for operator SQL and memory expire-on-read. |
| Webhook inbox | `failed` | `fail()` writes `pending` or `dead_letter`, **not** `failed`. `failed` remains legal for operator SQL. |

Webhook columns `gateway`, `provider_event_id`, `first_received_at`, `last_received_at` exist for operator/index use. `claim()` does not populate them (`ClaimWebhookInput` has no `gateway`).

## Tenant column honesty (v1)

`tenantColumn` enables a nullable `tenant_id` column + index **only**. Foundation v1 DDL always emits that column and a `tenant_id` index (the flag does not omit them). This adapter does **not** isolate tenants, does **not** write `tenant_id` from stores, and does **not** use a custom column name in DDL (always `tenant_id`). Primary key remains `key`. Operators who need isolation must prefix keys or wait for a later schema. Do not claim isolation.

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
