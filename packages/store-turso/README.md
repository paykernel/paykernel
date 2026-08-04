# @paykernel/store-turso

Turso serverless and libSQL durable stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** contracts (Phase 9).

> **Phase 15 production adapter.** Multi-host safe when pointed at a **shared remote** Turso / libSQL database. Claims use engine-level conditional writes (`INSERT … ON CONFLICT` / `UPDATE … RETURNING`), not application get-then-set.
>
> This is **not** `packages/store-sqlite` (local single-host file DB). Do **not** treat `/sync` or embedded replicas as true local-first multi-writer sync — those modes are **not** shipped or advertised here.

## Install

```bash
bun add @paykernel/store-turso
# optional drivers (pick one binding):
bun add @libsql/client
# or
bun add @tursodatabase/serverless
```

## Quick start

```ts
import {
  createTursoIdempotencyStore,
  migrateTursoAdapter,
  type TursoExecutor,
} from "@paykernel/store-turso";

// Build a narrow executor for your driver (or use a subpath binding):
const executor: TursoExecutor = /* … */;

// Explicit migrate — NEVER automatic on import or factory construction.
await migrateTursoAdapter(executor);

const store = createTursoIdempotencyStore({ executor });
const r = await store.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
```

### Driver subpaths

Root entry **never** statically imports optional drivers. Bindings live on isolated subpaths:

| Subpath | Package | Notes |
|---------|---------|-------|
| `@paykernel/store-turso/libsql` | `@libsql/client` | Remote URL or `file:` / `:memory:` for CI |
| `@paykernel/store-turso/serverless` | `@tursodatabase/serverless` | Fetch-based remote Turso Cloud |

These clients are **not interchangeable** — use the matching subpath and test each path independently. There is **no** `./sync` export.

Example with `@libsql/client` (local file for tests / CI):

```ts
import { createClient } from "@libsql/client";
import {
  createLibsqlStores,
  createLibsqlExecutor,
  migrateTursoAdapter,
} from "@paykernel/store-turso/libsql";

const client = createClient({ url: "file:./payments.db" });
const executor = createLibsqlExecutor(client);
await migrateTursoAdapter(executor);
const stores = createLibsqlStores({ client });
```

Example with `@tursodatabase/serverless`:

```ts
import { connect } from "@tursodatabase/serverless";
import {
  createTursoServerlessExecutor,
  createTursoServerlessStores,
  migrateTursoAdapter,
} from "@paykernel/store-turso/serverless";

const connection = connect({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const executor = createTursoServerlessExecutor(connection);
await migrateTursoAdapter(executor);
const stores = createTursoServerlessStores({ client: connection });
```

## Migrations

```ts
import {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
} from "@paykernel/store-turso";

await migrateTursoAdapter(executor);
const check = await verifyTursoAdapterSchema(executor);
if (!check.ok) throw new Error(check.errors.join("; "));
```

Dialect is sql-store **`sqlite`**. Never auto-migrate on import. See [docs/migrations.md](./docs/migrations.md).

## Guarantees (honest)

- **coordinationScope:** `multi-host` (shared remote primary)
- **durability:** `durable`
- **claims:** strong (engine-level single-statement UPSERT / conditional UPDATE)
- **Not advertised:** true multi-region strong consistency without caveats; `/sync`; embedded-replica offline conflict resolution
- **Auth tokens** never appear in `StoreError` messages

See [TURSO_STORAGE_ADAPTER_MANIFEST](./src/manifest.ts) and [docs/guarantees.md](./docs/guarantees.md).

## Drizzle (optional)

Drizzle is **not** required. If you mirror foundation tables for joins, keep correctness-critical claims on `createTurso*Store` — never raw ORM get-then-set. See [docs/drizzle.md](./docs/drizzle.md).

## Testing

- Unit tests use a mock `TursoExecutor` or `@libsql/client` `file:` / `:memory:`.
- Live remote tests skip cleanly unless env is set:
  - `TURSO_DATABASE_URL` / `PAYMENTS_SDK_TURSO_URL` / `LIBSQL_URL`
  - `TURSO_AUTH_TOKEN` / `PAYMENTS_SDK_TURSO_AUTH_TOKEN` / `LIBSQL_AUTH_TOKEN`
- Serverless and libsql paths are tested independently (not interchangeable).
- FakeClock lease reclaim is supported via injectable `clock`.

```bash
bun test packages/store-turso
# monorepo:
bun run test:adapter-turso
```

See [docs/testing.md](./docs/testing.md).

## Documentation

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

| Doc | Topic |
| --- | ----- |
| [docs/overview.md](./docs/overview.md) | Purpose, remote shared store, entry points |
| [docs/drivers.md](./docs/drivers.md) | `/serverless` vs `/libsql`; versions |
| [docs/claims.md](./docs/claims.md) | UPSERT / batch; no get-then-set |
| [docs/concurrency.md](./docs/concurrency.md) | Multi-instance, rollback, reconnect |
| [docs/crash-boundaries.md](./docs/crash-boundaries.md) | Crash / reclaim / network indeterminate |
| [docs/migrations.md](./docs/migrations.md) | Explicit migrate |
| [docs/testing.md](./docs/testing.md) | Env gates, file: CI, FakeClock |
| [docs/guarantees.md](./docs/guarantees.md) | Manifest honesty |
| [docs/embedded-replicas.md](./docs/embedded-replicas.md) | Why `/sync` is not shipped |
| [docs/drizzle.md](./docs/drizzle.md) | Optional schema mirrors |

## Related

- Local single-host SQLite: `@paykernel/store-sqlite`
- PostgreSQL multi-host: `@paykernel/store-postgres`
- Store contracts: `@paykernel/testkit`
