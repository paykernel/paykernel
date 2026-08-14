# @paykernel/sql-foundation

Shared **relational foundation** for PayKernel durable SQL store adapters:

| Area       | Contents                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Schema     | Canonical logical tables/columns for idempotency, webhook inbox, reconciliation jobs, migrations ledger. Webhook `gateway` / `provider_event_id` / receive timestamps are operator columns — store `claim()` does not populate them. Idempotency `expired` and webhook `failed` are CHECK-legal; official postgres stores do not write them. |
| Namespace  | Validated table prefix, PostgreSQL schema, optional `tenantColumn` flag. v1 enables a nullable `tenant_id` column + index **only** — it does **not** isolate tenants, does **not** write `tenant_id` from stores, and does **not** use a custom column name in DDL (always `tenant_id`). PK remains `key`. Prefix keys or wait for a later schema if you need isolation. |
| Codecs     | Row ↔ record mapping + shared validation (ISO timestamps, opaque tokens, max error size)                |
| Migrations | Versioned DDL + explicit `migrate()` / `verifySchema()` (never auto on import). When `sqlSchema` is set, `migrate()` issues `CREATE SCHEMA IF NOT EXISTS`; operators still need `CREATE` privilege. |
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
