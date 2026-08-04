# @paykernel/sql-foundation

Shared **relational foundation** for PayKernel durable SQL store adapters:

| Area       | Contents                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Schema     | Canonical logical tables/columns for idempotency, webhook inbox, reconciliation jobs, migrations ledger |
| Namespace  | Validated table prefix, PostgreSQL schema, optional tenant column                                       |
| Codecs     | Row ↔ record mapping + shared validation (ISO timestamps, opaque tokens, max error size)                |
| Migrations | Versioned DDL + explicit `migrate()` / `verifySchema()` (never auto on import)                          |
| Claims     | Pure `evaluateClaim` / `decide*` + dialect SQL templates + complete/fail fencing + A3 harness           |
| Reference  | Memory-relational (mutex) + optional `reference/bun-sqlite-store.test` (sync txn; not on main export)        |

> **Publishable.** This package is the public packaging of the former private
> `@paykernel/internal-sql-store` foundation (ship-blocker B8 option B). Adapters
> depend on `@paykernel/sql-foundation` at runtime so published tarballs resolve
> on npm. The monorepo keeps `internal/sql-store` as a **thin re-export** for
> workspace compatibility.

## Not a general SQL abstraction

Intentionally narrow: schemas, codecs, migrations, claim intent/templates, and
test reference helpers. **Not** a query builder or ORM.

## Consumers

- [`@paykernel/store-postgres`](../store-postgres)
- [`@paykernel/store-sqlite`](../store-sqlite)
- [`@paykernel/store-turso`](../store-turso)
- [`@paykernel/store-d1`](../store-d1)
- [`@paykernel/store-durable-objects`](../store-durable-objects)

Redis adapter does **not** depend on this package.

## Install

Usually installed transitively via a store adapter:

```bash
bun add @paykernel/store-postgres
# pulls @paykernel/sql-foundation + @paykernel/store-contracts
```

## Boundaries

- **Must not** depend on `@paykernel/core`, `@paykernel/webhooks`, or
  `@paykernel/reconciliation` (field names align with store contracts by
  convention).
- Domain packages must not depend on sql-foundation (storage is injected).

## Documentation

| Doc | Topic |
| --- | --- |
| [docs/relational-foundation.md](./docs/relational-foundation.md) | Purpose, tables, namespace, migration policy |
| [docs/migrations.md](./docs/migrations.md) | Explicit migrate/verify |
| [docs/atomic-claims.md](./docs/atomic-claims.md) | Atomic claim rules |

Store contract types: [`@paykernel/store-contracts`](../store-contracts).
