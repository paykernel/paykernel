# Migrations (Phase 11)

**Package:** `@paykernel/sql-foundation`  
**API:** `migrate`, `verifySchema`, `MIGRATIONS`, `CURRENT_SCHEMA_VERSION`  
**Overview:** [relational-foundation.md](./relational-foundation.md)

---

## Policy (non-negotiable)

1. **Explicit invocation only.** Call `migrate(executor, { dialect, namespace })` from install scripts, operator tooling, or adapter setup docs.
2. **Never auto-run on package import.** Importing `@paykernel/sql-foundation` does not touch a database (covered by `import-no-migrate.test.ts`).
3. **Never auto-run on production store construction.** Creating a store adapter must not apply DDL as a side effect.
4. **Append-only versions.** Do not renumber migrations that may already be applied in the field.
5. **Dialect-honest SQL.** Share intent; provide `postgres` / `sqlite` bodies when syntax diverges. Do not pretend dialects are identical.
6. **Validated identifiers only.** Table qualification goes through `createSchemaNamespace` / known logical tables — never raw user table names.
7. **Bound params** for user values when migrations need them; DDL identifiers are validated before quoting.
8. **Serialize multi-host migrate.** See [Concurrent migrate](#concurrent-migrate-n10) — no portable advisory lock.

---

## Schema versions

| Constant                 | Meaning                                                   |
| ------------------------ | --------------------------------------------------------- |
| `SCHEMA_FAMILY`          | `"payments-storage"` (logical family id, not npm version) |
| `SCHEMA_VERSION_V1`      | `1` — foundation four tables                              |
| `SCHEMA_VERSION_V2`      | `2` — composite list/cleanup indexes (`IF NOT EXISTS`)    |
| `CURRENT_SCHEMA_VERSION` | Highest defined migration version (currently `2`)         |

Bump `CURRENT_SCHEMA_VERSION` when appending a new entry to `MIGRATIONS`.

---

## Migration ledger table

Logical name: `payment_storage_migrations`.

| Column       | Intent                                           |
| ------------ | ------------------------------------------------ |
| `version`    | Primary key; integer migration version           |
| `name`       | Stable migration name string                     |
| `applied_at` | ISO-8601 text timestamp of apply                 |
| `checksum`   | Optional content fingerprint for drift detection |

Physical name respects namespace prefix/schema like domain tables.

---

## Defined migrations

### v1 — `create_payment_storage_foundation`

Creates:

- `payment_idempotency` (+ indexes for lease/status/`tenant_id`)
- `payment_webhook_inbox` (+ lease/available/status/`tenant_id`/payload_hash indexes)
- `payment_reconciliation_jobs` (+ lease/due/status/`tenant_id` indexes)
- `payment_storage_migrations`

When `sqlSchema` is set, `migrate()` also issues `CREATE SCHEMA IF NOT EXISTS` for that validated identifier (PostgreSQL). Operators still need `CREATE` privilege.

**Tenant (v1):** `tenantColumn` enables a nullable `tenant_id` column + index **only**. Foundation v1 DDL always emits that column and a `tenant_id` index (the flag does not omit them). v1 does **not** isolate tenants, does **not** write `tenant_id` from stores, and does **not** use a custom column name in DDL (always `tenant_id`). Primary key remains `key`. Operators who need isolation must prefix keys or wait for a later schema. Do not claim isolation.

**Statuses (CHECK-legal vs adapter writes):** DDL CHECKs allow idempotency `expired` and webhook `failed`. Official postgres stores never write idempotency `expired` (reclaim uses `lease_expires_at`); webhook `fail` writes `pending` / `dead_letter`, not `failed`. Those statuses remain legal for operator SQL and memory expire-on-read.

**Webhook operator columns:** `gateway`, `provider_event_id`, `first_received_at`, `last_received_at` exist for operator/index use. Store `claim()` does not populate them (`ClaimWebhookInput` has no `gateway`).

DDL is dialect-tagged:

| Export                                            | Role                                   |
| ------------------------------------------------- | -------------------------------------- |
| `FOUNDATION_SQL_POSTGRES`                         | PostgreSQL DDL                         |
| `FOUNDATION_SQL_SQLITE`                           | SQLite DDL                             |
| `FOUNDATION_SQL_PORTABLE`                         | Documented portable intent             |
| `buildFoundationMigrationSql(dialect, namespace)` | Resolved SQL for a dialect + namespace |

Metadata: `MIGRATION_001` in `MIGRATIONS` (append-only array).

### v2 — `create_payment_storage_list_indexes` (PERF-3)

Already-applied v1 is **not** rewritten. `migrate()` applies v2 as:

- `CREATE INDEX IF NOT EXISTS` `(status, available_at)` and `(status, lease_expires_at)` on webhook inbox
- `CREATE INDEX IF NOT EXISTS` `(status, due_at)` and `(status, lease_expires_at)` on reconciliation jobs

New installs that ran current v1 DDL already have these indexes; v2 is a no-op. Databases that applied an older v1 (single-column indexes only) gain the composite list/cleanup indexes. Builder: `buildListIndexMigrationSql(qualify)` (dialect-independent `CREATE INDEX IF NOT EXISTS`). Metadata: `MIGRATION_002`.

Index names use `indexLabel(qualifiedTable)` (keeps the **end** of long names so long `tablePrefix` values do not collide shared suffixes like `_lease_expires` across tables). Colliding index names fail closed at SQL build time rather than silently skipping via `IF NOT EXISTS`.

---

## `migrate(executor, options)`

```ts
import {
  migrate,
  createSchemaNamespace,
  type SqlExecutor,
} from "@paykernel/sql-foundation";

const executor: SqlExecutor = {
  async execute(sql, params) {
    // adapter: prepared statement / bound params
  },
  async query(sql, params) {
    // optional; used to read applied versions
  },
};

const ns = createSchemaNamespace({ tablePrefix: "pay_" });

const result = await migrate(executor, {
  dialect: "postgres", // | "sqlite" | "generic"
  namespace: ns,
  // targetVersion?: number  — inclusive; default CURRENT_SCHEMA_VERSION
  // nowIso?: string         — applied_at clock
});

// result.applied, result.alreadyApplied, result.currentVersion
```

### Behavior

1. When `sqlSchema` is set, `CREATE SCHEMA IF NOT EXISTS` for that validated identifier (PostgreSQL). Operators still need `CREATE` privilege — migrate does not grant it.
2. Ensure migrations ledger table exists (or create as part of foundation apply path).
3. Read already-applied versions.
4. Apply pending migrations in version order up to `targetVersion`.
5. Record each apply in `payment_storage_migrations` with name/checksum/`applied_at`.
6. Return which versions were newly applied vs already present.

Failures throw `MigrationError` (`code: "migration_error"`).

### Concurrent migrate (N10)

`migrate()` does **not** acquire a portable cross-dialect advisory lock.

| Concern | Residual honesty |
| ------- | ---------------- |
| Why no lock? | Cheap portable locks are not available on every supported dialect/executor. PostgreSQL has `pg_advisory_lock`; SQLite/D1/generic executors do not share an equivalent that this package can require without driver-specific branching and false safety. |
| Ops requirement | **Serialize migrate across hosts** — one migrator job, deploy lock, leader election, or operator procedure. Do not run concurrent `migrate()` from multiple app instances as a substitute for ops control. |
| Foundation v1 | DDL is `CREATE TABLE/INDEX IF NOT EXISTS` and the ledger uses PK `version`. Concurrent runs are *usually* fail-closed or no-ops, but the **version INSERT after multi-statement DDL can still race** (two hosts both observe “not applied”, both run DDL, one INSERT wins / one fails). |
| Future migrations | **Non-idempotent DDL inherits this window.** When appending migrations that rename/drop/alter, concurrent migrate is **not** safe even if v1 happened to tolerate races. |

Adapters may wrap `migrate()` with dialect-specific locks (e.g. Postgres `pg_advisory_lock`) at the adapter boundary if desired; the foundation stays dialect-honest and portable.

### `SqlExecutor`

Narrow adapter-facing interface — **not** a full ORM:

```ts
type SqlExecutor = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  query?<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> | T[];
};
```

Prefer prepared statements. Identifier qualification is done only via validated namespace helpers inside this package.

---

## `verifySchema(executor, options)`

Non-mutating check:

- Reports current applied version vs `CURRENT_SCHEMA_VERSION`
- Can confirm expected physical table names for a namespace
- Suitable for adapter startup **fail-fast** (then operator runs migrate out-of-band)

Does **not** apply migrations.

---

## Fixtures and tests

| Asset                                      | Role                               |
| ------------------------------------------ | ---------------------------------- |
| `createFakeDbState` / sample records       | Unit-test row helpers (root export) |
| `createFakeExecutor`                       | **Test-only** (`src/testing.ts`); always-succeed fake — do not import next to `migrate()` |
| `expectedTablesForNamespace`               | Physical names for a namespace     |
| `DIALECT_SAMPLES`                          | Dialect sample payloads            |
| `import-no-migrate.test.ts`                | Import does not migrate            |
| `migrate.test.ts`                          | Apply / idempotent re-run / ledger |
| `namespace.test.ts` / `definitions.test.ts`| Prefix length + index-label uniqueness |

Adapters should add multi-connection and real-driver migration tests in Phase 12+.

---

## Operator checklist

1. Validate namespace config for the environment (prefix / schema / tenant). `tablePrefix` must leave room for the longest logical table (`payment_reconciliation_jobs`, 27 chars) under identifier max 63 → safe max prefix **36** (`MAX_SAFE_TABLE_PREFIX_LENGTH`).
2. Run `migrate` against a maintenance connection with DDL privileges — **one host / serialized**. When `sqlSchema` is set, the migrator role also needs `CREATE` so `CREATE SCHEMA IF NOT EXISTS` can succeed.
3. Run `verifySchema` in deploy health checks if desired.
4. Never grant application workers blind DDL if policy forbids it — split migrator role from runtime role.
5. On upgrade, deploy code that understands new schema **after** or **with** explicit migrate (document order per adapter).
6. Do **not** treat `tenantColumn` as isolation. v1 DDL always includes nullable `tenant_id` + index (never a custom name); stores do not write it; PK remains `key`. Prefix keys (or wait for a later schema) if you need isolation.

---

## Related

- [relational-foundation.md](./relational-foundation.md)
- [atomic-claims.md](./atomic-claims.md)
- Source: `src/migrations/{metadata,definitions,migrate,verify}.ts`
