# Cloudflare D1 adapter overview (Phase 16)

**Package:** `@paykernel/store-d1`  
**Path:** `packages/store-d1`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/store-contracts`](../../store-contracts/docs/contracts.md)  
**Foundation:** publishable [`@paykernel/sql-foundation`](../../sql-foundation/docs/relational-foundation.md) (dialect **`sqlite`**)

This package is the **multi-host Workers-native D1** production storage adapter for **shared** Cloudflare D1 databases. It implements durable **idempotency**, **webhook inbox**, and **reconciliation** stores via the **Workers/Pages D1 binding**.

> **Not** local single-host SQLite (`packages/store-sqlite`).  
> **Not** Turso/libSQL (`packages/store-turso`).  
> **Not** Durable Objects ([`packages/store-durable-objects`](../../store-durable-objects/README.md) — Phase 17, separate package).  
> **Not** a generic `packages/adapter-cloudflare` umbrella.

## Purpose

| Concern | What this package provides |
| ------- | -------------------------- |
| Durable multi-host claims | Engine-level `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` (async D1) |
| Shared D1 store | Safe when all Workers bind the **same** D1 database |
| Explicit schema | `migrateD1Adapter` / `verifyD1AdapterSchema` — never on import or default factory |
| Workers binding | `createD1PaymentStores({ db })` — no REST/account token for normal operation |
| Sessions | Defaults to `withSession('first-primary')` when the binding supports Sessions; pass `session: false` to opt out |
| Conformance | Testkit suites + mock D1 (bun:sqlite test-only) CI path |

## When to use

| Adapter | Scope | Typical surface |
| ------- | ----- | --------------- |
| **`@paykernel/store-d1`** | **Multi-host shared D1** | Workers `env.PAYMENTS_DB` binding |
| `@paykernel/store-durable-objects` | Multi-host **partitioned** SQLite-backed DO | Workers `env.PAYMENTS_DO` + sharding — [separate package](../../store-durable-objects/docs/overview.md) |
| `@paykernel/store-sqlite` | Single-host local only | `file:./app.db`, Bun/Node embedded |
| `@paykernel/store-turso` | Multi-host shared remote Turso | `libsql://…`, Turso HTTPS |
| `@paykernel/store-postgres` | Multi-host shared PostgreSQL | `postgres://…` |

Do **not** use this adapter as a drop-in for local SQLite `BEGIN IMMEDIATE` sync claims. D1 is **async** (Workers Binding API); claims prefer **single-statement UPSERT**, not local reserved-lock multi-step without `batch()`.

## Entry points

| Import | Contents |
| ------ | -------- |
| `@paykernel/store-d1` | Factories, migrate, manifest, types, error mapping, sessions |

Single root export. No REST subpath required. Root entry does **not** static-import `cloudflare:workers`.

### Factories

```ts
import {
  createD1PaymentStores,       // primary ergonomic API
  createD1IdempotencyStore,
  createD1WebhookInboxStore,
  createD1ReconciliationStore,
  createD1Stores,              // bundle from executor
  migrateD1Adapter,
  D1_STORAGE_ADAPTER_MANIFEST,
} from "@paykernel/store-d1";

// Explicit migrate — NEVER automatic on import or factory construction.
await migrateD1Adapter(env.PAYMENTS_DB);

const stores = createD1PaymentStores({
  db: env.PAYMENTS_DB,
  // clock?, namespace?
  // session defaults to "first-primary" when db.withSession exists
});
```

## Lifecycle

1. Bind D1 in Wrangler (`[[d1_databases]]`) — see [wrangler.md](./wrangler.md).
2. Call `migrateD1Adapter(env.PAYMENTS_DB)` **explicitly** (ops/CI / one-shot Worker).
3. `createD1PaymentStores({ db, clock?, session?, namespace? })` — factories never migrate.
4. Use testkit contracts; inject `FakeClock` for lease tests.

## D1 Binding API (pin)

Verified against Cloudflare docs: **2026-08-03**  
https://developers.cloudflare.com/d1/worker-api/

Surface used: `prepare` / `bind` / `first` / `all` / `run` / `batch` / `withSession`.  
Details: [binding.md](./binding.md).

## Docs map

| Doc | Topic |
| --- | ----- |
| [guarantees.md](./guarantees.md) | Manifest honesty |
| [binding.md](./binding.md) | D1 prepare/bind/batch/withSession; no REST required |
| [claims.md](./claims.md) | Atomic UPSERT / batch strategy |
| [sessions-and-replication.md](./sessions-and-replication.md) | RAW + stale replica risk |
| [migrations.md](./migrations.md) | Explicit migrate only; no BEGIN/COMMIT wrappers |
| [crash-boundaries.md](./crash-boundaries.md) | Crash / lease / isolate restart |
| [numeric-portability.md](./numeric-portability.md) | TEXT IDs/tokens/hashes; ISO timestamps |
| [limits.md](./limits.md) | Batch/CPU/multi-region; vs DO |
| [testing.md](./testing.md) | Mock D1, FakeClock, skip-without-env |
| [wrangler.md](./wrangler.md) | Binding + deploy notes |

## Boundaries

- `paymentsSdk.runtime: "cloudflare-only"` (non-portable).
- Must not be depended on by core / webhooks / testkit / other adapters.
- May depend on testkit + `@paykernel/sql-foundation` only among workspace packages.
- Optional peer `@cloudflare/workers-types` for DX — structural types work without it.
