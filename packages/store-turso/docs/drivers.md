# Driver bindings

Root entry never imports drivers. Use isolated subpaths.

Env vars for live tests (all optional; suites skip cleanly when unset):

| Variable | Alias / fallback |
|----------|------------------|
| `TURSO_DATABASE_URL` | `PAYMENTS_SDK_TURSO_URL`, `LIBSQL_URL` |
| `TURSO_AUTH_TOKEN` | `PAYMENTS_SDK_TURSO_AUTH_TOKEN`, `LIBSQL_AUTH_TOKEN` |

Local secrets may live in `packages/store-turso/.env` (gitignored); process env wins.

## `@paykernel/store-turso/libsql`

Peer: `@libsql/client` (tested ~0.17.x).

```ts
import { createClient } from "@libsql/client";
import {
  createLibsqlExecutor,
  createLibsqlStores,
  migrateTursoAdapter,
} from "@paykernel/store-turso/libsql";

const client = createClient({
  url: process.env.LIBSQL_URL ?? process.env.TURSO_DATABASE_URL ?? "file:./payments.db",
  authToken: process.env.LIBSQL_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
});
const executor = createLibsqlExecutor(client);
await migrateTursoAdapter(executor);
const stores = createLibsqlStores({ client });
```

Also exported (aliases):

- `createExecutorFromLibsql` / `createLibsqlTursoExecutor` → same as `createLibsqlExecutor`
- `createTursoStoresFromLibsql` → same as `createLibsqlStores`
- `createLibsqlIdempotencyStore` / `createLibsqlWebhookInboxStore` / `createLibsqlReconciliationStore`

Notes:

- Supports remote URLs (`libsql://`, `https://`), `file:`, and `:memory:` for CI.
- Write transactions use `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on the same client.
- Optional `client.batch(..., "write")` for transactional multi-statement batches.
- Interactive `client.transaction()` is avoided for `:memory:` catalog quirks on some libsql versions.
- **Embedded replicas / legacy `syncUrl`:** reads may be local and writes go to cloud primary. This is **not** true offline multi-writer local-first sync. Do not advertise untested conflict resolution. Prefer a shared remote primary for multi-host claims.

## `@paykernel/store-turso/serverless`

Peer: `@tursodatabase/serverless` (tested ~1.4.x; fetch-only remote).

```ts
import { connect } from "@tursodatabase/serverless";
import {
  createTursoServerlessExecutor,
  createTursoServerlessStores,
  migrateTursoAdapter,
} from "@paykernel/store-turso/serverless";

const conn = connect({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const executor = createTursoServerlessExecutor(conn);
await migrateTursoAdapter(executor);
const stores = createTursoServerlessStores({ client: conn /* or connection: conn */ });
```

Also exported (aliases):

- `createExecutorFromServerless` / `createServerlessTursoExecutor` → same as `createTursoServerlessExecutor`
- `createTursoStoresFromServerless` → same as `createTursoServerlessStores`
- `createTursoServerlessIdempotencyStore` / Webhook / Reconciliation factories

Notes:

- Fetch-only remote client; works in serverless/edge runtimes with `fetch`.
- Connection is **single-stream**; use multiple `connect()` calls for parallel multi-client tests.
- Optional `transactionAsync` (prefer `.immediate()`) and atomic `batch(..., "immediate")`.
- Remote-only — no `file:` path on this subpath.
- Timeout: `TimeoutError` / code `TIMEOUT` maps to `StoreTimeoutError`. Connection/fetch failures map to `StoreUnavailableError` (retryable). Reconnect is driver-level (`connection.reconnect()`); stores do not auto-reconnect mid-claim.

## Not interchangeable

`@tursodatabase/serverless` and `@libsql/client` have different concurrency and API models (e.g. serverless MVCC vs libSQL concurrent-write limits). Use the matching subpath and test each path independently (Phase 15.3).

## Not shipped

- `/sync` subpath
- `@tursodatabase/sync` advertising as local-first multi-writer
- Embedded-replica offline conflict resolution guarantees
