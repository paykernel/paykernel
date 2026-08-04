# Driver bindings

**Rule:** the package **root** entry must never statically import optional peer drivers (`pg`, `postgres`, `drizzle-orm`, `bun:sql`). Drivers live on **isolated subpath exports** and optional peerDependencies only.

Enforced by `bun run check:boundaries` (`ADAPTER_OPTIONAL_DRIVERS` includes `pg`, `postgres`, `drizzle-orm`, `bun:sql`, …).

## Subpaths

| Import path | Optional dependency | Binding helpers |
| ----------- | ------------------- | --------------- |
| `@paykernel/store-postgres` | none | `createPostgres*Store({ executor })`, migrate, manifest |
| `@paykernel/store-postgres/pg` | `pg` | `createExecutorFromPg` / `createPgPostgresExecutor`, `createPostgres*StoreFromPg` |
| `@paykernel/store-postgres/postgres-js` | `postgres` | `createExecutorFromPostgresJs` / `createPostgresJsPostgresExecutor`, `createPostgres*StoreFromPostgresJs` |
| `@paykernel/store-postgres/bun-sql` | Bun runtime (`bun:sql`) | `createExecutorFromBunSql` / `createBunSqlPostgresExecutor`, `createPostgres*StoreFromBunSql` |
| `@paykernel/store-postgres/drizzle` | `drizzle-orm` (optional) | thin helpers + notes; no top-level `drizzle-orm` import required for store factories |

Install peers as needed:

```bash
bun add @paykernel/store-postgres
bun add pg                 # node-postgres
# or
bun add postgres           # postgres.js
# optional
bun add drizzle-orm
```

## Narrow executor (root-friendly)

Any stack can implement `PostgresExecutor` and use the root factories without importing a driver subpath:

```ts
import {
  createPostgresStores,
  migratePostgresAdapter,
  type PostgresExecutor,
} from "@paykernel/store-postgres";

const executor: PostgresExecutor = {
  async query(sql, params) {
    /* prepared $1..$n */
    return rows;
  },
  async execute(sql, params) {
    return { rowCount };
  },
  // optional:
  // async withTransaction(fn) { … return fn(txExecutor); }
};

await migratePostgresAdapter(executor);
const stores = createPostgresStores({ executor });
```

- Placeholders are `$1..$n` with **bound** params only — never interpolate user values.
- `withTransaction` is optional; when present, store `withTransaction` uses it.

---

## `pg` (node-postgres)

```ts
import { Pool } from "pg";
import {
  createExecutorFromPg,
  createPostgresStoresFromPg,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executor = createExecutorFromPg(pool);

await migratePostgresAdapter(executor);

const stores = createPostgresStoresFromPg({
  client: pool,
  // clock, namespace optional
});

// Or individual factories:
// createPostgresIdempotencyStoreFromPg({ client: pool })
// createPostgresWebhookInboxStoreFromPg({ client: pool })
// createPostgresReconciliationStoreFromPg({ client: pool })
```

`createExecutorFromPg` enables `withTransaction` when the client exposes `connect()` (pool).

---

## postgres.js

```ts
import postgres from "postgres";
import {
  createExecutorFromPostgresJs,
  createPostgresStoresFromPostgresJs,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/postgres-js";

const sql = postgres(process.env.DATABASE_URL!);
const executor = createExecutorFromPostgresJs(sql);

await migratePostgresAdapter(executor);

const stores = createPostgresStoresFromPostgresJs({ sql });
```

Transactions use `sql.begin` when available.

---

## Bun SQL (`bun:sql`)

Only available under the Bun runtime. The **root** package must not import `bun:sql`.

```ts
import { SQL } from "bun:sql";
import {
  createExecutorFromBunSql,
  createPostgresStoresFromBunSql,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/bun-sql";

const sql = new SQL(process.env.DATABASE_URL!);
// Client must expose unsafe(query, params) for prepared $n statements.
const executor = createExecutorFromBunSql(sql);

await migratePostgresAdapter(executor);

const stores = createPostgresStoresFromBunSql({ sql });
```

---

## Drizzle (optional)

Drizzle is **not** required for stores. Prefer:

1. Run foundation DDL via `migratePostgresAdapter` (sql-store), not dual Drizzle push for payment tables.
2. Build a `PostgresExecutor` from the same `pg` / `postgres` / Bun client used under `drizzle(...)`.
3. Call root or drizzle-subpath factories with that executor.

```ts
import {
  createPostgresStoresWithDrizzleExecutor,
  DRIZZLE_ADAPTER_NOTES,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/drizzle";
import { createExecutorFromPg } from "@paykernel/store-postgres/pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executor = createExecutorFromPg(pool);

await migratePostgresAdapter(executor);

const stores = createPostgresStoresWithDrizzleExecutor({ executor });
// console.log(DRIZZLE_ADAPTER_NOTES);
```

Do **not** replace atomic claim SQL with multi-step Drizzle get-then-set.

---

## Error mapping

Driver failures are mapped into the Phase 9 `StoreErrorCode` taxonomy (`StoreUnavailableError`, `StoreTimeoutError`, `StoreLeaseLostError`, …). See package `mapDriverError` / `withMappedErrors`. Messages are sanitized — no secret leakage.

---

## Related

- [overview.md](./overview.md)
- [migrations.md](./migrations.md)
- [workspace-boundaries.md](../../../docs/workspace-boundaries.md)
