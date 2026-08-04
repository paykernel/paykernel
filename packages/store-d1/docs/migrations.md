# Migrations (explicit only)

**Package:** `@paykernel/store-d1`  
**Foundation:** `@paykernel/internal-sql-store` dialect **`sqlite`**

---

## Rules

1. **Never** auto-migrate on package import.
2. **Never** migrate inside default `createD1PaymentStores` / `createD1Stores`.
3. Operators and tests call `migrateD1Adapter` explicitly.
4. DDL must **not** wrap statements in `BEGIN`/`COMMIT` for the D1 apply path.
5. Dialect is **`sqlite`** via `@paykernel/internal-sql-store` (statement-split foundation SQL).

Import-time and factory no-migrate behavior is covered by `import-no-migrate.test.ts`.

---

## API

```ts
import {
  migrateD1Adapter,
  verifyD1AdapterSchema,
} from "@paykernel/store-d1";

// Accepts D1Executor or D1DatabaseLike binding
await migrateD1Adapter(env.PAYMENTS_DB, {
  namespace: { tablePrefix: "prod_" }, // optional
});

const verify = await verifyD1AdapterSchema(env.PAYMENTS_DB);
if (!verify.ok) throw new Error("schema invalid");
```

Prefer a **one-shot Worker**, CI step, or ops script — not every request.

---

## Packaging

| Artifact | Role |
| -------- | ---- |
| sql-store `FOUNDATION_SQL_SQLITE` | Authoritative DDL + ledger apply path used by `migrateD1Adapter` |
| `migrations/0001_foundation.sql` | Full foundation table/index DDL snapshot for Wrangler `d1 migrations`; **no BEGIN/COMMIT** (keep in sync with `FOUNDATION_SQL_SQLITE`) |
| `examples/wrangler.toml` | Binding example (`[[d1_databases]]`) |

---

## Wrangler `d1 migrations apply`

If you use Wrangler’s migration directory:

```bash
# Example — adjust paths to your Worker project
npx wrangler d1 migrations apply payments --local
npx wrangler d1 migrations apply payments --remote
```

Requirements:

- Each statement must be D1-compatible SQLite.
- **Omit** `BEGIN` / `COMMIT` wrappers (D1 apply path and this adapter’s packaging reject them).
- Prefer `migrateD1Adapter` in a controlled job for schema parity with other relational adapters (postgres/sqlite/turso all use sql-store migrate helpers).

See also [wrangler.md](./wrangler.md) and [binding.md](./binding.md).

---

## Related

- [overview.md](./overview.md)  
- [testing.md](./testing.md) — migrate suite  
- sql-store [migrations.md](../../../internal/sql-store/docs/migrations.md)  
