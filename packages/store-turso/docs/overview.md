# Turso adapter overview (Phase 15)

**Package:** `@paykernel/store-turso`  
**Path:** `packages/store-turso`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/store-contracts`](../../store-contracts/docs/contracts.md)  
**Foundation:** publishable [`@paykernel/sql-foundation`](../../sql-foundation/docs/relational-foundation.md) (dialect **`sqlite`**; private shim: `internal/sql-store`)

This package is the **multi-host remote SQLite-compatible** production storage adapter for **shared** Turso Cloud / libSQL remote databases. It implements durable **idempotency**, **webhook inbox**, and **reconciliation** stores.

> **Not** local single-host SQLite. That is [`packages/store-sqlite`](../../store-sqlite/docs/overview.md). Do not conflate the two.

## Purpose

| Concern | What this package provides |
| ------- | -------------------------- |
| Durable multi-host claims | Engine-level `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` (async remote) |
| Shared remote store | Safe when all workers share one remote Turso / libSQL primary |
| Explicit schema | `migrateTursoAdapter` / `verifyTursoAdapterSchema` — never on import or default factory |
| Driver choice | Optional peers + isolated subpaths; **root entry imports no drivers** |
| Conformance | Testkit suites + file: libsql CI path + env-gated live multi-connection proofs |

## When to use

| Adapter | Scope | Typical URL |
| ------- | ----- | ----------- |
| **`adapter-turso`** | **Multi-host shared remote** | `libsql://…`, Turso HTTPS, remote libSQL |
| `adapter-sqlite` | Single-host local only | `file:./app.db`, Bun/Node embedded |
| `adapter-postgres` | Multi-host shared PostgreSQL | `postgres://…` |
| `adapter-redis` | Optional multi-host coordination | Redis/Valkey/Upstash |

Do **not** use this adapter as a drop-in for local SQLite `BEGIN IMMEDIATE` sync claims. Remote clients are **async** (HTTP/fetch); multi-statement writes use `client.transaction("write")`. `BEGIN IMMEDIATE` is **local `file:` only**. Claims prefer **single-statement UPSERT**. An embedded replica is **not** multi-host.

## Entry points

| Import | Drivers? | Contents |
| ------ | -------- | -------- |
| `@paykernel/store-turso` | **No** | Factories, migrate, manifest, types, error mapping |
| `@paykernel/store-turso/libsql` | `@libsql/client` | Remote URL, `file:`, `:memory:` for CI |
| `@paykernel/store-turso/serverless` | `@tursodatabase/serverless` | Fetch-based remote Turso Cloud |

There is **no** `./sync` export. Embedded replica / `@tursodatabase/sync` modes are **not** shipped, **not** multi-host, and **not** advertised as true local-first multi-writer. See [embedded-replicas.md](./embedded-replicas.md).

`@tursodatabase/serverless` and `@libsql/client` are **not interchangeable** — use the matching subpath and test each path independently. Details: [drivers.md](./drivers.md).

## What you get

```ts
import {
  createTursoIdempotencyStore,
  createTursoWebhookInboxStore,
  createTursoReconciliationStore,
  createTursoStores,
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
  TURSO_STORAGE_ADAPTER_MANIFEST,
} from "@paykernel/store-turso";
```

- Factories take a narrow `TursoExecutor` + optional injectable `clock` / namespace.
- Honest manifest: `multi-host`, `durable`, `claims: "strong"` (see [guarantees.md](./guarantees.md)).
- Auth tokens never appear in `StoreError` messages.

## Lifecycle

1. Build a `TursoExecutor` (manually or via a subpath binding).
2. Call `migrateTursoAdapter(executor)` **explicitly**.
3. `createTurso*Store({ executor, clock? })` — factories never migrate.
4. Use testkit contracts; inject `FakeClock` for lease tests.

## Claims (summary)

Prefer engine-level single-statement:

```sql
INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING …
```

Multi-statement only inside a write transaction / transactional `batch`. **Remote:** `client.transaction("write")`. **Local `file:`:** `BEGIN IMMEDIATE` on the same connection. **Never** unprotected get-then-set across round-trips. Details: [claims.md](./claims.md).

## Boundaries

| Package | Relation to adapter-turso |
| ------- | ------------------------- |
| `packages/core` | **Must not** depend on it |
| `packages/webhooks` | **Must not** depend on it (inject store at app layer) |
| `packages/testkit` | Contracts + conformance only |
| `internal/sql-store` | Adapter **may** depend (`workspace:*`; dialect `sqlite`) |
| `adapter-postgres` / `redis` / `sqlite` | **Must not** depend on turso (and vice versa for production edges) |

## Non-goals (this phase)

- `/sync` subpath or advertising untested embedded-replica local-first
- Cloudflare D1 binding stores (sibling Phase 16 package `@paykernel/store-d1` — not this package)
- Durable Objects (Phase 17)
- `packages/reconciliation` domain package
- Auto-migrate on import or default `createTurso*Stores`
- Making Drizzle or any driver mandatory
- Conflating multi-host remote Turso with single-host local SQLite or Workers D1

## Related docs

| Doc | Topic |
| --- | ----- |
| [README](../README.md) | Quick start |
| [drivers.md](./drivers.md) | `/serverless` vs `/libsql`; versions; remote vs `file:` |
| [claims.md](./claims.md) | UPSERT / batch; no get-then-set |
| [concurrency.md](./concurrency.md) | Multi-instance, rollback, reconnect |
| [crash-boundaries.md](./crash-boundaries.md) | Crash / reclaim / network indeterminate |
| [migrations.md](./migrations.md) | Explicit migrate policy |
| [testing.md](./testing.md) | Env gates, file: CI, FakeClock |
| [guarantees.md](./guarantees.md) | Manifest honesty notes |
| [embedded-replicas.md](./embedded-replicas.md) | Why `/sync` is not shipped |
| [drizzle.md](./drizzle.md) | Optional ORM schema notes (claims stay on adapter path) |
| [store-contracts.md](../../store-contracts/docs/contracts.md) | Phase 9 contracts |
| [workspace-boundaries.md](../../../docs/workspace-boundaries.md) | Monorepo matrix |
