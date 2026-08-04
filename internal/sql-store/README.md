# @paykernel/internal-sql-store

**Private** monorepo package (`"private": true`). **Not published to npm.**

Shared **relational foundation** for Phase 12+ durable adapters:

| Area       | Contents                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Schema     | Canonical logical tables/columns for idempotency, webhook inbox, reconciliation jobs, migrations ledger |
| Namespace  | Validated table prefix, PostgreSQL schema, optional tenant column                                       |
| Codecs     | Row ↔ record mapping + shared validation (ISO timestamps, opaque tokens, max error size)                |
| Migrations | Versioned DDL + explicit `migrate()` / `verifySchema()` (never auto on import)                          |
| Claims     | Pure `evaluateClaim` / `decide*` + dialect SQL templates + complete/fail fencing + A3 harness           |
| Reference  | Memory-relational (mutex) + optional `reference/bun-sqlite-store` (sync txn; not on main export)        |

**Phase 12+ consumers now include** [`packages/store-postgres`](../../packages/store-postgres/README.md) (`@paykernel/store-postgres`) — production PostgreSQL stores built on these templates and migrations; [`packages/store-sqlite`](../../packages/store-sqlite/README.md) (Phase 14, single-host); [`packages/store-turso`](../../packages/store-turso/README.md) (Phase 15, multi-host remote Turso/libSQL, dialect `sqlite`); [`packages/store-d1`](../../packages/store-d1/README.md) (Phase 16, multi-host Workers D1 binding, dialect `sqlite`); and [`packages/store-durable-objects`](../../packages/store-durable-objects/README.md) (Phase 17, multi-host partitioned SQLite-backed Durable Objects, dialect `sqlite`).

## Not a public SQL abstraction

This package is intentionally narrow: schemas, codecs, migrations, claim intent/templates, and test reference helpers. It does **not** export a general query builder or ORM. Production adapters live under `packages/adapter-*` (Phase 12: `adapter-postgres`; Phase 14: `adapter-sqlite`; Phase 15: `adapter-turso`; Phase 16: `adapter-cloudflare-d1`; Phase 17: `adapter-cloudflare-do`; further adapters later).

## Documentation

| Doc                                                              | Topic                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [docs/relational-foundation.md](./docs/relational-foundation.md) | Purpose, tables, namespace, migration policy, adapter consumption, crash boundaries |
| [docs/migrations.md](./docs/migrations.md)                       | Explicit migrate/verify, versions, ledger, operator checklist                       |
| [docs/atomic-claims.md](./docs/atomic-claims.md)                 | Atomic claim rules, dialect templates, dual fencing, contention scope               |
| [CHANGELOG.md](./CHANGELOG.md)                                   | In-repo history (package never published)                                           |

Phase 9 contracts (authoritative store interfaces):  
[`packages/testkit/docs/store-contracts.md`](../../packages/testkit/docs/store-contracts.md)

## Dependencies

Zero runtime workspace dependencies. Field names align with Phase 9 lease-aware store contracts in `@paykernel/testkit` by **convention** (not a hard import). This package must not depend on core or the webhooks engine.

## Boundaries

| May depend on sql-store                            | Must not depend on sql-store                          |
| -------------------------------------------------- | ----------------------------------------------------- |
| `packages/store-postgres` (Phase 12; present)    | `packages/core` (`@paykernel/core`)            |
| `packages/store-sqlite` (Phase 14; single-host)  | `packages/webhooks` (storage is injected)             |
| `packages/store-turso` (Phase 15; multi-host remote) | `packages/store-redis` (Phase 13; Lua, not SQL) |
| `packages/store-d1` (Phase 16; multi-host D1) | —                                              |
| `packages/store-durable-objects` (Phase 17; multi-host partitioned DO) | —                                      |
| Other relational `packages/adapter-*` (later)      | —                                                     |
| In-repo tooling / adapter tests                    | —                                                     |

Enforced by `bun run check:boundaries` (`internal/*` requires `private: true`).

## Usage notes

```ts
import {
  createSchemaNamespace,
  resolveTableName,
  migrate,
  verifySchema,
  CURRENT_SCHEMA_VERSION,
  evaluateClaim,
  decideIdempotencyReserve,
  idempotencyReserveTemplates,
  runClaimContentionHarness,
} from "@paykernel/internal-sql-store";

const ns = createSchemaNamespace({ tablePrefix: "pay_", sqlSchema: "payments" });
const table = resolveTableName("payment_idempotency", ns);
const templates = idempotencyReserveTemplates(ns);
// adapters: prepare templates.postgres.sql / templates.sqlite.sql with bound params

// Explicit only — never runs on import:
// await migrate(executor, { dialect: "postgres", namespace: ns });
// await verifySchema(executor, { dialect: "postgres", namespace: ns });
```

bun:sqlite reference is **not** on the main export (avoids pulling `bun:sqlite` into portable consumers):

```ts
import { createBunSqliteRelationalStore } from "./reference/bun-sqlite-store";
```

### Local scripts

```bash
cd internal/sql-store
bun run typecheck
bun test
bun run build
```

From monorepo root (after workspace wiring):

```bash
bun run typecheck   # includes this package
bun test            # includes internal/sql-store
bun run build       # builds sql-store after publishable packages
bun run check:boundaries
```

## Engineering rules (summary)

1. Atomic claims = single conditional write / engine-level transaction — **never** get-then-set across connections.
2. Prepared statements / bound params for user values; validated identifiers only for tables/schemas.
3. Do not pretend PostgreSQL and SQLite share identical claim/DDL syntax.
4. Never store raw provider payloads or secrets in error/payload columns by default.
5. Portable ISO-8601 timestamp strings and opaque string lease tokens.
6. Do not run migrations automatically on import or production construction.
