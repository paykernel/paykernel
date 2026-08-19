# Driver subpaths

Root entry `@paykernel/store-sqlite` exports factories that accept a narrow `SqliteExecutor`. Drivers are **only** imported from subpaths.

## `/bun` — `bun:sqlite`

- Runtime-provided; no npm peer
- First-class for Bun single-host apps and tests
- Prepared statements via `db.prepare` (fallback `db.query`)
- Claims use `BEGIN IMMEDIATE` inside depth-tracked sync transactions
- Helpers:
  - `createBunSqliteStores` / `createBunSqliteExecutor`
  - `createBunSqliteIdempotencyStore` / webhook / reconciliation
  - `createInMemoryBunSqliteStores` (`createBunSqliteStoresInMemory` alias)
  - `createInMemoryBunSqliteExecutor`, `openBunSqliteDatabase(path)` (path required; pass `":memory:"` explicitly — ephemeral / process-local)
  - File-backed `open*Database` applies `PRAGMA busy_timeout` (default 5000 ms)
  - `applyRecommendedPragmas`, `migrateSqliteAdapter`

```ts
import { Database } from "bun:sqlite";
import {
  createBunSqliteStores,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "@paykernel/store-sqlite/bun";

const db = new Database("payments.db");
const stores = createBunSqliteStores({ db });
applyRecommendedPragmas(stores.executor, { busyTimeoutMs: 5_000, wal: true });
await migrateSqliteAdapter(stores.executor);
```

## `/node` — `node:sqlite` (`DatabaseSync`)

Package `engines.node` is `>=18` because `/better-sqlite3` and the root types run on Node 18. **This subpath** (`@paykernel/store-sqlite/node`) requires **Node >= 22.5.0**. See `NODE_SQLITE_SUPPORT` and `package.json` `paymentsSdk.nodeSqliteMinimum`.

### Supported Node version matrix

| Node line | Module status | Notes |
|-----------|---------------|--------|
| **22.5.0+** (22.x) | **Experimental** | `DatabaseSync` available; optional subpath only |
| **23.x** | **Experimental** | Confirm flags/docs for the exact minor |
| **24.x / 25.x+** | **Experimental** (verify release notes) | Prefer `better-sqlite3` until Node marks stable |

| Item | Value |
|------|--------|
| Minimum Node | **22.5.0** |
| Module | `node:sqlite` |
| API | `DatabaseSync` (sync prepared statements) |
| Stability | **Experimental** — not part of portable core baseline |

- Isolated optional subpath; root never imports `node:sqlite`
- BigInt `changes` / INTEGER columns normalized in executor + store layer
- Export `NODE_SQLITE_SUPPORT` for programmatic matrix access
- Prefer `better-sqlite3` for mature Node production until `node:sqlite` is stable
- Helpers: `createNodeSqliteStores`, `createNodeSqliteExecutor`, `createInMemoryNodeSqliteStores`

```ts
import { DatabaseSync } from "node:sqlite";
import {
  createNodeSqliteStores,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
  NODE_SQLITE_SUPPORT,
} from "@paykernel/store-sqlite/node";

const db = new DatabaseSync("payments.db");
const stores = createNodeSqliteStores({ db });
applyRecommendedPragmas(stores.executor, { busyTimeoutMs: 5_000, wal: true });
await migrateSqliteAdapter(stores.executor);
```

## `/better-sqlite3`

- Optional peer dependency (`peerDependenciesMeta.optional`)
- Prepared statements + depth-tracked `BEGIN IMMEDIATE` (equivalent to `.transaction(fn).immediate()` for top-level claims, with safe nesting)
- `defaultSafeIntegers(true)` when supported; store layer normalizes BigInt
- Helpers: `createBetterSqlite3Stores`, `createBetterSqlite3Executor`, `createInMemoryBetterSqlite3Stores`
- Native bindings may fail under Bun’s Node ABI — tests **skip cleanly**

```ts
import Database from "better-sqlite3";
import {
  createBetterSqlite3Stores,
  migrateSqliteAdapter,
  applyRecommendedPragmas,
} from "@paykernel/store-sqlite/better-sqlite3";

const db = new Database("payments.db");
const stores = createBetterSqlite3Stores({ db });
applyRecommendedPragmas(stores.executor, { busyTimeoutMs: 5_000, wal: true });
await migrateSqliteAdapter(stores.executor);
```

## Executor port

```ts
type SqliteExecutor = {
  query<T>(sql: string, params?: readonly unknown[]): T[];
  run(sql: string, params?: readonly unknown[]): { changes: number };
  transaction<T>(
    fn: () => T,
    options?: { mode?: "deferred" | "immediate" | "exclusive" },
  ): T;
  runInTransaction?<T>(
    fn: () => Promise<T> | T,
    options?: { mode?: "deferred" | "immediate" | "exclusive" },
  ): Promise<T>;
};
```

Callbacks to `transaction` **must** be synchronous (no `async`/`await` inside). Prefer `{ mode: "immediate" }` for contested write claims.

## Pragmas (single-host)

```ts
applyRecommendedPragmas(executor, {
  busyTimeoutMs: 5_000, // PRAGMA busy_timeout
  wal: true,            // file-backed multi-connection same host
  foreignKeys: true,
});
```

Do **not** treat local SQLite as multi-host coordination. See [deployment-limits.md](./deployment-limits.md).
