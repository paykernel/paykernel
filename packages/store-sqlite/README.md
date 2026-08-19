# @paykernel/store-sqlite

Local/embedded **SQLite** stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** contracts (Phase 9).

> **Phase 14 production adapter.** Single-host only: one database file must have one durable filesystem authority. Claims use `BEGIN IMMEDIATE` (or equivalent) + conditional writes inside one synchronous transaction — never unprotected get-then-set. **Not** multi-host / multi-region distributed coordination.

## Install

```bash
bun add @paykernel/store-sqlite
# optional Node native binding:
bun add better-sqlite3
```

## Quick start (root + executor)

```ts
import {
  createSqliteIdempotencyStore,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
  type SqliteExecutor,
} from "@paykernel/store-sqlite";

// Build a narrow executor via a driver subpath (or your own adapter):
const executor: SqliteExecutor = /* … */;

applyRecommendedPragmas(executor, { busyTimeoutMs: 5_000, wal: true });

// Explicit migrate — NEVER automatic on import or factory construction.
await migrateSqliteAdapter(executor);

const store = createSqliteIdempotencyStore({ executor });
const r = await store.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
```

### Driver subpaths

Root entry **never** statically imports SQLite drivers. Bindings live on isolated subpaths:

| Subpath | Driver |
|---------|--------|
| `@paykernel/store-sqlite/bun` | `bun:sqlite` (runtime-provided) |
| `@paykernel/store-sqlite/node` | `node:sqlite` (`DatabaseSync`; Node 22.5+; experimental stability) |
| `@paykernel/store-sqlite/better-sqlite3` | `better-sqlite3` (optional peer) |

Example with Bun:

```ts
import { Database } from "bun:sqlite";
import {
  createBunSqliteStores,
  createBunSqliteExecutor,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "@paykernel/store-sqlite/bun";

const db = new Database("payments.db");
const stores = createBunSqliteStores({ db });
applyRecommendedPragmas(stores.executor, { busyTimeoutMs: 5_000, wal: true });
await migrateSqliteAdapter(stores.executor);

// Or a bare executor:
// const executor = createBunSqliteExecutor(db);
```

### Node version matrix (`/node`)

`package.json` `engines.node` is **`>=18`** for `/better-sqlite3` and root types. **`@paykernel/store-sqlite/node` requires Node `>=22.5.0`.**

| Node | `node:sqlite` status |
|------|----------------------|
| 22.5.0+ | Experimental (`DatabaseSync`) |
| 23.x | Experimental |
| 24+ / 25+ | Experimental — verify release notes; prefer `better-sqlite3` until stable |

See [docs/drivers.md](./docs/drivers.md) and export `NODE_SQLITE_SUPPORT`.

## Guarantees

See [`SQLITE_STORAGE_ADAPTER_MANIFEST`](./src/manifest.ts) and [docs/guarantees.md](./docs/guarantees.md):

- `coordinationScope: "single-host"` — **not** multi-host / multi-region
- `durability: "durable"` for file-backed DBs (`:memory:` is process-local only)
- Strong claims via `BEGIN IMMEDIATE` + conditional writes
- Explicit migrations only

## Deployment limits (14.5)

1. One database file → one durable filesystem authority  
2. Do **not** share the file over unsupported network filesystems (NFS, etc.)  
3. Ephemeral serverless filesystems lose state — not suitable for durable inbox/idempotency  
4. Horizontal multi-host scaling requires PostgreSQL, Redis, Turso, D1, or another shared service  

Full detail: [docs/deployment-limits.md](./docs/deployment-limits.md).

## Docs

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

- [overview](./docs/overview.md)
- [claims](./docs/claims.md)
- [drivers](./docs/drivers.md)
- [guarantees](./docs/guarantees.md)
- [deployment-limits](./docs/deployment-limits.md)
- [crash-boundaries](./docs/crash-boundaries.md)
- [migrations](./docs/migrations.md)
- [testing](./docs/testing.md)

## Boundaries

- Core and webhooks must **not** depend on this package; inject stores at the application layer.
- This is **not** the sql-store NON_PRODUCTION bun reference store.
- `adapter-postgres` / `adapter-redis` must not depend on this package.

## License

MIT
