# PostgreSQL adapter overview (Phase 12)

**Package:** `@paykernel/store-postgres`  
**Path:** `packages/store-postgres`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/testkit`](../../testkit/docs/store-contracts.md)  
**Foundation:** publishable [`@paykernel/sql-foundation`](../../sql-foundation/docs/relational-foundation.md) (private shim: `internal/sql-store`)

This package is the **first production storage adapter**. It implements durable, multi-host-safe **idempotency**, **webhook inbox**, and **reconciliation** stores against a shared PostgreSQL cluster.

## Purpose

| Concern | What this package provides |
| ------- | -------------------------- |
| Durable claims | Engine-level `INSERT … ON CONFLICT` / conditional `UPDATE … RETURNING` (sql-store postgres templates) |
| Multi-process safety | Safe when all workers share one PostgreSQL primary/cluster |
| Explicit schema | `migratePostgresAdapter` / `verifyPostgresAdapterSchema` — never on import or default factory construction |
| Driver choice | Optional peers + isolated subpaths; **root entry imports no drivers** |
| Conformance | Wired to testkit suites + multi-connection live PG proofs (env-gated) |

## What you get

```ts
import {
  createPostgresIdempotencyStore,
  createPostgresWebhookInboxStore,
  createPostgresReconciliationStore,
  createPostgresStores,
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
  POSTGRES_STORAGE_ADAPTER_MANIFEST,
} from "@paykernel/store-postgres";
```

- Factories take a narrow `PostgresExecutor` + optional injectable `clock` / namespace.
- Driver bindings: `/pg`, `/postgres-js`, `/bun-sql`, `/drizzle` (see [drivers.md](./drivers.md)).
- Honest manifest: `multi-host`, `durable`, `claims: "strong"` (see [guarantees.md](./guarantees.md)).

## Multi-process durability

1. **Row is the work record.** Claims, leases, and terminal outcomes live in PostgreSQL tables from the sql-store foundation.
2. **Atomic claims** serialize at the engine, not in application get-then-set races.
3. **Lease fencing** uses opaque `leaseToken` + monotonic `generation`. Stale mutators fail with `StoreLeaseLostError`.
4. **Advisory locks / `SKIP LOCKED`** may assist batch fairness; they are **never** the only durable record of work.
5. Process crash mid-handler leaves a leased row until expiry; another worker reclaims with a new token.

Details: [crash-boundaries.md](./crash-boundaries.md).

## Explicit migrate

```ts
await migratePostgresAdapter(executor);
const check = await verifyPostgresAdapterSchema(executor);
```

- Importing the package does **not** touch the database.
- `createPostgres*Store` does **not** migrate by default.
- Operators own upgrade windows.

Details: [migrations.md](./migrations.md).

## Driver subpaths

| Entry | Imports optional drivers? |
| ----- | ------------------------- |
| `@paykernel/store-postgres` (root) | **No** |
| `…/pg`, `…/postgres-js`, `…/bun-sql`, `…/drizzle` | Yes (isolated) |

Details: [drivers.md](./drivers.md).

## Boundaries

| Package | Relation to adapter-postgres |
| ------- | ---------------------------- |
| `packages/core` | **Must not** depend on it |
| `packages/webhooks` | **Must not** depend on it (inject store at app layer) |
| `packages/testkit` | Contracts + conformance only (no hard dep either way required for app code) |
| `internal/sql-store` | Adapter **may** depend (`workspace:*`; private foundation) |

## Non-goals (this phase)

- Implementing Redis / SQLite / Turso / D1 / Durable Object **inside this package**
- `packages/reconciliation` domain package
- New PSPs or gateway extraction
- Auto-migrate on import
- Making Drizzle or any driver mandatory

## Hybrid with Redis (optional, app-layer)

PostgreSQL alone satisfies all Phase 9 contracts. Apps that already run Redis/Valkey may compose **both** adapters at the application layer (e.g. Redis for low-latency leases + Postgres for long-term audit). Core and webhooks never import either adapter; this package does **not** depend on `@paykernel/store-redis`.

See Phase 13 hybrid patterns: [`packages/store-redis/docs/hybrid-examples.md`](../../store-redis/docs/hybrid-examples.md).

## Related docs

| Doc | Topic |
| --- | ----- |
| [README](../README.md) | Quick start |
| [crash-boundaries.md](./crash-boundaries.md) | Crash / reclaim / uncertain outcomes |
| [drivers.md](./drivers.md) | Subpath bindings |
| [migrations.md](./migrations.md) | Migrate / verify policy |
| [testing.md](./testing.md) | Unit + live PG + docker-compose |
| [guarantees.md](./guarantees.md) | Manifest honesty notes |
| [store-contracts.md](../../testkit/docs/store-contracts.md) | Phase 9 contracts |
| [workspace-boundaries.md](../../../docs/workspace-boundaries.md) | Monorepo matrix |
