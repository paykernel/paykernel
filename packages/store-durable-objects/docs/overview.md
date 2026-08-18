# Cloudflare Durable Object adapter overview (Phase 17)

**Package:** `@paykernel/store-durable-objects`  
**Path:** `packages/store-durable-objects`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/store-contracts`](../../store-contracts/docs/contracts.md)  
**Foundation:** publishable [`@paykernel/sql-foundation`](../../sql-foundation/docs/relational-foundation.md) (dialect **`sqlite`**; private shim: `internal/sql-store`)

This package is the **multi-host partitioned Durable Object** production storage adapter using **SQLite-backed** DO storage (`new_sqlite_classes`). It implements durable **idempotency**, **webhook inbox**, and **reconciliation** stores via Worker → DO stub RPC and in-object sync SQL.

> **Not** shared D1 (`packages/store-d1`).  
> **Not** local single-host SQLite (`packages/store-sqlite`).  
> **Not** Turso/libSQL (`packages/store-turso`).  
> **Not** a generic `packages/adapter-cloudflare` umbrella.

## Architecture

1. **In-object store logic** — sync `storage.sql.exec` claims (UPSERT + RETURNING) and optional `transactionSync` multi-statement (sync only).
2. **Worker-side client** — async Phase 9 interfaces; routes each op via sharding → DO stub RPC.
3. **Deterministic sharding** — `key` | `hash` | `tenant`. Never one global DO for all payment work. `hash partitions=1` is a single partition (warn: singleton hot-key risk), not a global-default bypass.
4. **Explicit schema** — `ensureDoSchema` / `migrateDoAdapter` (DO lifecycle or ops), never on npm import.

## When to use

| Adapter | Scope | Typical surface |
| ------- | ----- | --------------- |
| **`store-durable-objects`** | **Multi-host partitioned DO** | Workers `env.PAYMENTS_DO` + sharding |
| `store-d1` | Multi-host shared D1 | Workers `env.PAYMENTS_DB` |
| `store-sqlite` | Single-host local only | `file:./app.db` |
| `store-turso` | Multi-host shared remote Turso | `libsql://…` |

Prefer DO when you want **per-key or per-partition single-threaded coordination** with strong local RAW. Prefer D1 when you want a **shared relational** multi-tenant DB without managing partitions.

## Entry points

| Import | Contents |
| ------ | -------- |
| `@paykernel/store-durable-objects` | Factories, client, sharding, migrate, manifest, types, PaymentsStoreObject |

| Factory | Role |
| ------- | ---- |
| `createDoPaymentStores` | Worker client bundle (requires `namespace` + **explicit** `sharding`) |
| `createDoIdempotencyStore` / `createDoWebhookInboxStore` / `createDoReconciliationStore` | Per-store factories |
| `createDoStores` / `createDoStoresFromStorage` / `createDoPaymentStoresFromStorage` | In-object / test storage path |
| `migrateDoAdapter` / `ensureDoSchema` | Explicit schema only — **never** on import or default client construct |

Single root export. Root entry does **not** static-import `cloudflare:workers`.  
Optional peer `@cloudflare/workers-types` is DX-only. Worker examples may subclass `DurableObject` from `cloudflare:workers` in **application** code — that import must not land in core/webhooks/testkit.

## Docs map

| Doc | Topic |
| --- | ----- |
| [sharding.md](./sharding.md) | key / hash / tenant; hot keys; never global DO |
| [claims.md](./claims.md) | UPSERT / claim → external → complete |
| [transactions.md](./transactions.md) | `transactionSync` sync-only; cursor-before-await |
| [crash-boundaries.md](./crash-boundaries.md) | Crash, eviction, lease reclaim |
| [guarantees.md](./guarantees.md) | Manifest honesty |
| [migrations.md](./migrations.md) | Explicit ensure/migrate |
| [wrangler.md](./wrangler.md) | Binding + `new_sqlite_classes` |
| [testing.md](./testing.md) | Mock DO SQL, FakeClock, skips |
| [alarms.md](./alarms.md) | Optional at-least-once alarms |
| [limits.md](./limits.md) | Platform limits vs D1/sqlite/turso |

Docs pin (CF DO SQLite + alarms): **2026-08-03**.
