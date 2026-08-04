# Migrations (Phase 11)

**Package:** `@paykernel/internal-sql-store`  
**API:** `migrate`, `verifySchema`, `MIGRATIONS`, `CURRENT_SCHEMA_VERSION`  
**Overview:** [relational-foundation.md](./relational-foundation.md)

---

## Policy (non-negotiable)

1. **Explicit invocation only.** Call `migrate(executor, { dialect, namespace })` from install scripts, operator tooling, or adapter setup docs.
2. **Never auto-run on package import.** Importing `@paykernel/internal-sql-store` does not touch a database (covered by `import-no-migrate.test.ts`).
3. **Never auto-run on production store construction.** Creating a store adapter must not apply DDL as a side effect.
4. **Append-only versions.** Do not renumber migrations that may already be applied in the field.
5. **Dialect-honest SQL.** Share intent; provide `postgres` / `sqlite` bodies when syntax diverges. Do not pretend dialects are identical.
6. **Validated identifiers only.** Table qualification goes through `createSchemaNamespace` / known logical tables — never raw user table names.
7. **Bound params** for user values when migrations need them; DDL identifiers are validated before quoting.

---

## Schema versions

| Constant                 | Meaning                                                   |
| ------------------------ | --------------------------------------------------------- |
| `SCHEMA_FAMILY`          | `"payments-storage"` (logical family id, not npm version) |
| `SCHEMA_VERSION_V1`      | `1` — foundation four tables                              |
| `CURRENT_SCHEMA_VERSION` | Highest defined migration version (currently `1`)         |

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

- `payment_idempotency` (+ indexes for lease/status/tenant)
- `payment_webhook_inbox` (+ lease/available/status/tenant/payload_hash indexes)
- `payment_reconciliation_jobs` (+ lease/due/status/tenant indexes)
- `payment_storage_migrations`

DDL is dialect-tagged:

| Export                                            | Role                                   |
| ------------------------------------------------- | -------------------------------------- |
| `FOUNDATION_SQL_POSTGRES`                         | PostgreSQL DDL                         |
| `FOUNDATION_SQL_SQLITE`                           | SQLite DDL                             |
| `FOUNDATION_SQL_PORTABLE`                         | Documented portable intent             |
| `buildFoundationMigrationSql(dialect, namespace)` | Resolved SQL for a dialect + namespace |

Metadata: `MIGRATION_001` in `MIGRATIONS` (append-only array).

---

## `migrate(executor, options)`

```ts
import {
  migrate,
  createSchemaNamespace,
  type SqlExecutor,
} from "@paykernel/internal-sql-store";

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

1. Ensure migrations ledger table exists (or create as part of foundation apply path).
2. Read already-applied versions.
3. Apply pending migrations in version order up to `targetVersion`.
4. Record each apply in `payment_storage_migrations` with name/checksum/`applied_at`.
5. Return which versions were newly applied vs already present.

Failures throw `MigrationError` (`code: "migration_error"`).

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
| `createFakeExecutor` / `createFakeDbState` | Unit tests without a real DB       |
| `expectedTablesForNamespace`               | Physical names for a namespace     |
| `DIALECT_SAMPLES`                          | Dialect sample payloads            |
| `import-no-migrate.test.ts`                | Import does not migrate            |
| `migrate.test.ts`                          | Apply / idempotent re-run / ledger |

Adapters should add multi-connection and real-driver migration tests in Phase 12+.

---

## Operator checklist

1. Validate namespace config for the environment (prefix / schema / tenant).
2. Run `migrate` against a maintenance connection with DDL privileges.
3. Run `verifySchema` in deploy health checks if desired.
4. Never grant application workers blind DDL if policy forbids it — split migrator role from runtime role.
5. On upgrade, deploy code that understands new schema **after** or **with** explicit migrate (document order per adapter).

---

## Related

- [relational-foundation.md](./relational-foundation.md)
- [atomic-claims.md](./atomic-claims.md)
- Source: `src/migrations/{metadata,definitions,migrate,verify}.ts`
