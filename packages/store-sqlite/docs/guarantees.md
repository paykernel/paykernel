# Guarantees and storage manifest

**Export:** `SQLITE_STORAGE_ADAPTER_MANIFEST` / `getSqliteStorageAdapterManifest()`  
**Type:** `StorageAdapterManifest` from `@paykernel/store-contracts`  
**Validated at module load** via `assertStorageAdapterManifest`.

## Declared fields

| Field | Value | Honesty note |
| ----- | ----- | ------------ |
| `name` | `"sqlite"` | This adapter only |
| `contracts.idempotency` | `true` | Lease-aware Phase 9 idempotency store |
| `contracts.webhookInbox` | `true` | Assignable to webhooks dual `WebhookInboxStore` |
| `contracts.reconciliation` | `true` | Lease-aware reconciliation store |
| `consistency.claims` | `"strong"` | Only with `BEGIN IMMEDIATE` (or equivalent) + conditional writes (`@paykernel/sql-foundation` templates) |
| `consistency.readAfterWrite` | `"strong"` | Same process / same file after commit |
| `consistency.staleReadsPossible` | `false` | Under single-host local FS assumptions |
| `coordinationScope` | **`"single-host"`** | **Never** multi-host / multi-region for a local SQLite file |
| `durability` | `"durable"` | Assumes **file-backed** storage; `:memory:` is process-local only (ephemeral across restart) |
| `supportsTransactions` | `true` | Sync transactions via executor |
| `supportsLeases` | `true` | Token + generation fencing |
| `supportsRetentionCleanup` | `true` | `deleteExpired` paths |

## What single-host means

- All processes that open the **same database file** must share **one durable filesystem authority** on one host (or equivalent local volume).
- Multiple **connections on that host** are supported (with WAL + `busy_timeout` recommended).
- **Do not** open the same file for writes from multiple hosts or over unsupported network filesystems.
- Horizontal scale-out across machines requires PostgreSQL, Redis, Turso, D1, or another shared service — **not** this adapter sharing a file.

Advertising `coordinationScope: "multi-host"` or `"multi-region"` for local file SQLite is a **Phase 9 / Phase 14 honesty failure** (acceptance A3).

## Strong claims

Strong claims require:

1. Reserved lock via `BEGIN IMMEDIATE` (or driver immediate transaction) **or** verified single-statement ON CONFLICT claim.
2. Conditional SQL from `@paykernel/sql-foundation` sqlite templates inside that critical section.
3. **No** application get-then-set claim strategy across connections.
4. Token-gated mutators that fail when zero rows match (`StoreLeaseLostError`).

If an operator reimplements claim as non-atomic get-then-set, they must **not** advertise this manifest.

See [claims.md](./claims.md).

## Durability nuance

| Backend | Reality |
| ------- | ------- |
| File-backed path on local disk | Manifest `durable` — rows survive process restart (SQLite durability + your backup model) |
| `:memory:` | Process-local only; treat as **ephemeral** across restart despite the constant’s default field |
| Ephemeral serverless local disk | **Not** durable across invocations — see [deployment-limits.md](./deployment-limits.md) |

Manifest `notes` call out `:memory:` and serverless FS limits explicitly.

## Crash notes (summary)

- Mid-handler crash → lease until expiry → reclaim with new token + generation++.
- Uncertain external side effect → prefer indeterminate / at-least-once idempotent handlers — never invent terminal failure.
- Process restart with file-backed DB → rows remain; same path + namespace; migrate only for schema upgrades.
- Migrations explicit; never on import.

Full detail: [crash-boundaries.md](./crash-boundaries.md).

## Comparison with other adapters

| | Memory (testkit) | SQLite adapter | Postgres adapter | Redis adapter |
| - | ---------------- | -------------- | ---------------- | ------------- |
| Scope | `single-process` | **`single-host`** | `multi-host` | `multi-host` |
| Durability | `ephemeral` | `durable` (file) | `durable` | `configuration-dependent` |
| Production | **NON-PRODUCTION** | Production single-host | Production multi-host SQL | Optional coordination |
| Claims | In-process Map | IMMEDIATE + SQL | Conditional SQL | Lua |

## Related

- [overview.md](./overview.md)
- [deployment-limits.md](./deployment-limits.md)
- [store-contracts.md](../../testkit/docs/store-contracts.md) §7
- Package source: `src/manifest.ts`
