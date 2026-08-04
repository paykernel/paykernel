# @paykernel/store-postgres

PostgreSQL durable stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** contracts (Phase 9).

> **Phase 12 production adapter.** Multi-host safe when pointed at a shared PostgreSQL cluster. Claims use engine-level conditional writes (`INSERT … ON CONFLICT` / `UPDATE … RETURNING`), not application get-then-set.

## Install

```bash
bun add @paykernel/store-postgres
# optional drivers (pick one binding):
bun add pg
# or
bun add postgres
```

## Quick start

```ts
import {
  createPostgresIdempotencyStore,
  migratePostgresAdapter,
  type PostgresExecutor,
} from "@paykernel/store-postgres";

// Build a narrow executor for your driver (or use a subpath binding):
const executor: PostgresExecutor = /* … */;

// Explicit migrate — NEVER automatic on import or factory construction.
await migratePostgresAdapter(executor);

const store = createPostgresIdempotencyStore({ executor });
const r = await store.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
```

### Driver subpaths

Root entry **never** statically imports optional drivers. Bindings live on isolated subpaths:

| Subpath | Package |
|---------|---------|
| `@paykernel/store-postgres/pg` | `pg` (node-postgres) |
| `@paykernel/store-postgres/postgres-js` | `postgres` (postgres.js) |
| `@paykernel/store-postgres/bun-sql` | Bun SQL (`bun:sql`) — runtime-provided |
| `@paykernel/store-postgres/drizzle` | Optional Drizzle notes / thin helpers |

Example with `pg`:

```ts
import { Pool } from "pg";
import {
  createPostgresStoresFromPg,
  createPgPostgresExecutor,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/pg";

const pool = new Pool({
  connectionString: process.env.PAYMENTS_SDK_PG_URL ?? process.env.DATABASE_URL,
});
const executor = createPgPostgresExecutor(pool);
await migratePostgresAdapter(executor);
const stores = createPostgresStoresFromPg({ client: pool });
```

Example with `postgres` (postgres.js):

```ts
import postgres from "postgres";
import {
  createPostgresJsPostgresExecutor,
  createPostgresStoresFromPostgresJs,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/postgres-js";

const sql = postgres(process.env.PAYMENTS_SDK_PG_URL!);
const executor = createPostgresJsPostgresExecutor(sql);
await migratePostgresAdapter(executor);
const stores = createPostgresStoresFromPostgresJs({ sql });
```

Full binding examples: [docs/drivers.md](./docs/drivers.md).

## Migrations

```ts
import {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
} from "@paykernel/store-postgres";

await migratePostgresAdapter(executor);
const check = await verifyPostgresAdapterSchema(executor);
if (!check.ok) throw new Error(check.errors.join("; "));
```

- Migrations are **opt-in and explicit**.
- Factories do **not** migrate by default.
- Importing the package never touches the database.

See [docs/migrations.md](./docs/migrations.md).

## Timestamps

Foundation schema stores lease and audit timestamps as **TEXT ISO-8601** strings (compatible with injectable `FakeClock` and lexical comparison). Lease reclaim predicates bind injectable `now` into SQL — they do **not** hard-depend on `SQL NOW()` for test paths.

## Atomic claims

- Reserve/claim: single-statement Postgres templates from `@paykernel/internal-sql-store` (`INSERT ON CONFLICT DO UPDATE … WHERE … RETURNING` / conditional `UPDATE … RETURNING`).
- Mutators (`complete`, `fail`, `renew`, …): conditional `UPDATE … WHERE lease_token = $n` — zero rows → `StoreLeaseLostError`.
- `listDue` / batch paths may use `FOR UPDATE SKIP LOCKED` **only** for multi-worker fairness over durable rows. Advisory locks are never the only durable record of work.

## Manifest

```ts
import {
  POSTGRES_STORAGE_ADAPTER_MANIFEST,
  getPostgresStorageAdapterManifest,
} from "@paykernel/store-postgres";
```

| Field | Value |
|-------|--------|
| coordinationScope | `multi-host` (shared PG cluster) |
| durability | `durable` |
| consistency.claims | `strong` |
| supportsLeases / Transactions / RetentionCleanup | `true` |

See [docs/guarantees.md](./docs/guarantees.md).

## Documentation

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

| Doc | Topic |
| --- | ----- |
| [docs/overview.md](./docs/overview.md) | Purpose, multi-process durability, boundaries |
| [docs/crash-boundaries.md](./docs/crash-boundaries.md) | Crash before/after side effect vs complete |
| [docs/drivers.md](./docs/drivers.md) | bun-sql / postgres-js / pg / drizzle |
| [docs/migrations.md](./docs/migrations.md) | Explicit migrate / verify |
| [docs/testing.md](./docs/testing.md) | `PAYMENTS_SDK_PG_URL`, docker-compose, conformance |
| [docs/guarantees.md](./docs/guarantees.md) | Manifest honesty notes |

## Testing

```bash
# unit / public-api / driver smoke (no live PG required)
bun test packages/store-postgres

# optional local Postgres (docker compose)
docker compose -f packages/store-postgres/docker-compose.yml up -d
export PAYMENTS_SDK_PG_URL=postgres://payments:payments@127.0.0.1:54329/payments_sdk
# DATABASE_URL is also accepted when PAYMENTS_SDK_PG_URL is unset

# live PG (conformance × bindings, multi-connection, txn rollback, migrate)
bun test packages/store-postgres
```

When the URL is unset, integration/conformance tests **skip** cleanly (`ok` / green CI).

See [docs/testing.md](./docs/testing.md).

## Non-goals

- This package does **not** implement Redis / SQLite / Turso / D1 / Durable Object adapters.
- Core and webhooks must **not** depend on this adapter; inject stores at the app layer.
- Does not publish or re-export private `internal/sql-store` as a public ORM.
