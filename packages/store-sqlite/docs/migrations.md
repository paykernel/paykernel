# Migrations — SQLite adapter

**Package:** `@paykernel/store-sqlite`  
**Foundation:** `@paykernel/internal-sql-store` dialect **`sqlite`**  
**Policy:** Explicit migrate only — **never** on package import or default `create*Stores` construction.

---

## Explicit only

```ts
import {
  migrateSqliteAdapter,
  verifySqliteAdapterSchema,
} from "@paykernel/store-sqlite";

await migrateSqliteAdapter(executor, {
  namespace: { tablePrefix: "pay_" }, // optional; validated
});

const check = await verifySqliteAdapterSchema(executor, {
  namespace: { tablePrefix: "pay_" },
});
```

| Rule | Detail |
| ---- | ------ |
| Dialect | Always `"sqlite"` (wired inside helpers; uses sql-store foundation migrations) |
| Import | Loading `@paykernel/store-sqlite` does **not** open a DB or migrate |
| Factories | `createSqlite*Store` / `createBunSqliteStores` / etc. do **not** migrate by default |
| Operator ownership | Call migrate in bootstrap, deploy hooks, or ops — never silently |

---

## What runs

- SQL from `@paykernel/internal-sql-store` foundation migration builders (`buildFoundationMigrationSql` / dialect sqlite).
- Versioned schema for idempotency, webhook inbox, and reconciliation tables (lease columns, generation, ISO timestamps as TEXT, etc.).
- Idempotent apply: re-running migrate on an already-current schema is safe.

---

## Namespace

Table prefixes and optional SQL schema identifiers are **validated** by sql-store helpers. Never interpolate untrusted strings into SQL identifiers.

---

## Verify

`verifySqliteAdapterSchema` checks expected tables/columns for the configured namespace. Use it:

- After migrate in CI
- At process start (optional hard-fail) before accepting traffic
- When diagnosing `StoreInvalidSchemaError`

---

## Relation to NON_PRODUCTION sql-store reference

The private `internal/sql-store` **bun reference** store may apply schema on create for tests. That path is **NON_PRODUCTION**. This adapter’s production factories **do not** auto-migrate; always call `migrateSqliteAdapter` explicitly.

---

## Related

- [overview.md](./overview.md)
- [testing.md](./testing.md) — import-no-migrate tests
- sql-store [migrations.md](../../../internal/sql-store/docs/migrations.md)
