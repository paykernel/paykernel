# SQLite adapter overview (Phase 14)

**Package:** `@paykernel/store-sqlite`  
**Path:** `packages/store-sqlite`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/testkit`](../../testkit/docs/store-contracts.md)  
**Manifest type:** `StorageAdapterManifest` from `@paykernel/store-contracts`  
**Foundation:** publishable [`@paykernel/sql-foundation`](../../sql-foundation/docs/relational-foundation.md) — **not** `internal/sql-store`

This package is the **local/embedded single-host** production storage adapter. It implements durable (file-backed) **idempotency**, **webhook inbox**, and **reconciliation** stores against SQLite for Bun, Node, desktop, and single-host deployments.

> **Not distributed.** Local SQLite files are **never** multi-host or multi-region coordination. For multi-host, use PostgreSQL, Redis, Turso, D1, or another shared service.

## Purpose

| Concern | What this package provides |
| ------- | -------------------------- |
| Single-host claims | `BEGIN IMMEDIATE` (or equivalent) + `@paykernel/sql-foundation` sqlite templates in **one sync transaction** |
| File durability | Rows survive process restart when the DB is file-backed (WAL recommended) |
| Explicit schema | `migrateSqliteAdapter` / `verifySqliteAdapterSchema` — never on import or default factory construction |
| Driver choice | Isolated subpaths; **root entry imports no drivers** |
| Conformance | Testkit suites + Bun memory/file proofs; node/better-sqlite3 `describe.skip` / `it.skip` when unavailable |

## What you get

```ts
import {
  createSqliteIdempotencyStore,
  createSqliteWebhookInboxStore,
  createSqliteReconciliationStore,
  createSqliteStores,
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
  applyRecommendedPragmas,
  SQLITE_STORAGE_ADAPTER_MANIFEST,
} from "@paykernel/store-sqlite";
```

- Factories take a narrow `SqliteExecutor` + optional injectable `clock` / namespace.
- Driver bindings: `/bun`, `/node`, `/better-sqlite3` (see [drivers.md](./drivers.md)).
- Honest manifest: `single-host`, `durable`, `claims: "strong"` (see [guarantees.md](./guarantees.md)).

## Design

| Concern | Approach |
| ------- | -------- |
| Claims | `BEGIN IMMEDIATE` + `@paykernel/sql-foundation` sqlite templates (`INSERT OR IGNORE` + conditional `UPDATE`) in **one sync transaction** |
| Drivers | Isolated subpaths (`/bun`, `/node`, `/better-sqlite3`); root imports **none** |
| Migrate | Explicit `migrateSqliteAdapter` only |
| Clock | Injectable (`FakeClock` works in conformance) |
| Lease tokens | `crypto.getRandomValues` opaque `lt_*` strings |
| Coordination | **`single-host`** — never multi-host for a local file |
| Pragmas | `applyRecommendedPragmas` for `busy_timeout`, optional WAL, `foreign_keys` |

## Quick path

1. Open a driver `Database` on a **subpath** (or wrap your own `SqliteExecutor`).
2. `applyRecommendedPragmas(executor, { busyTimeoutMs: 5_000, wal: true })` for file-backed DBs.
3. `await migrateSqliteAdapter(executor)`.
4. `createSqliteStores({ executor })` or driver-specific `createBunSqliteStores({ db })`.

```ts
import { Database } from "bun:sqlite";
import {
  createBunSqliteStores,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "@paykernel/store-sqlite/bun";

const db = new Database("payments.db");
const stores = createBunSqliteStores({ db });
applyRecommendedPragmas(stores.executor, { busyTimeoutMs: 5_000, wal: true });
await migrateSqliteAdapter(stores.executor);
```

## Explicit migrate

```ts
await migrateSqliteAdapter(executor);
const check = await verifySqliteAdapterSchema(executor);
```

- Importing the package does **not** touch the database.
- `createSqlite*Store` / `create*SqliteStores` do **not** migrate by default.
- Operators own upgrade windows.

Details: [migrations.md](./migrations.md).

## Driver subpaths

| Entry | Imports optional drivers? |
| ----- | ------------------------- |
| `@paykernel/store-sqlite` (root) | **No** |
| `…/bun`, `…/node`, `…/better-sqlite3` | Yes (isolated to that subpath) |

Details: [drivers.md](./drivers.md).

## Boundaries

| Package | Relation to adapter-sqlite |
| ------- | -------------------------- |
| `packages/core` | **Must not** depend on it |
| `packages/webhooks` | **Must not** depend on it (inject store at app layer) |
| `packages/testkit` | Contracts + conformance only |
| `@paykernel/sql-foundation` | Adapter **depends** (sqlite dialect templates + migrate) |
| `internal/sql-store` | Private shim only — **not** the foundation this adapter uses |
| `adapter-postgres` / `adapter-redis` | **Must not** depend on adapter-sqlite (and vice versa for postgres/redis deps) |

## Not this package

- **Not** the `internal/sql-store` NON_PRODUCTION bun reference store (test-only). Foundation is `@paykernel/sql-foundation`.
- **Not** Turso (`adapter-turso`), Cloudflare D1 (`adapter-cloudflare-d1`), or Durable Objects (Phase 17).
- **Not** multi-host / multi-region coordination.
- **Not** auto-migrate on import.
- **Not** a requirement to use the core SDK — optional app-layer injection.

## When to use what

| Need | Prefer |
| ---- | ------ |
| Single process / host, local file or embedded | **This adapter** |
| Multi-host durable SQL | `@paykernel/store-postgres` |
| Multi-host remote SQLite-compatible | `@paykernel/store-turso` |
| Multi-host Workers D1 | `@paykernel/store-d1` |
| Optional multi-host coordination (config-dependent durability) | `@paykernel/store-redis` |
| Unit tests without a DB file | Testkit memory stores **or** Bun `:memory:` via this adapter’s helpers |

## Related docs

| Doc | Topic |
| --- | ----- |
| [README](../README.md) | Quick start |
| [claims.md](./claims.md) | BEGIN IMMEDIATE / no get-then-set |
| [crash-boundaries.md](./crash-boundaries.md) | Crash / reclaim / restart |
| [drivers.md](./drivers.md) | Subpath bindings, Node matrix |
| [deployment-limits.md](./deployment-limits.md) | Phase 14.5 four limits |
| [migrations.md](./migrations.md) | Explicit migrate / verify |
| [testing.md](./testing.md) | Conformance + skips |
| [guarantees.md](./guarantees.md) | Manifest honesty |
| [store-contracts.md](../../testkit/docs/store-contracts.md) | Phase 9 contracts |
| [workspace-boundaries.md](../../../docs/workspace-boundaries.md) | Monorepo matrix |
