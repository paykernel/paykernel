# Bun + Hono + Postgres checkout

Thin Hono `fetch` adapter over `@paykernel/example-checkout-kernel`. The kernel owns checkout, inbox, and reconciliation. This host's **test suite uses real Postgres stores** (single-host mock gateway + real Postgres via `PAYMENTS_SDK_PG_URL`); `bun src/index.ts` is in-memory SQLite unless you inject a factory.
## Tests

From this directory (requires Postgres):

```bash
docker compose -f ../../packages/store-postgres/docker-compose.yml up -d
PAYMENTS_SDK_PG_URL=postgres://payments:payments@127.0.0.1:54329/payments_sdk bun test
```

From the monorepo root (no PG env: suite is skipped):

```bash
bun test examples/bun-hono-postgres
```

Tests construct `createHonoCheckoutApp(kernel)` and call `app.fetch`. They do not start a listener. When `PAYMENTS_SDK_PG_URL` (or `DATABASE_URL`) is not set, the Postgres suite is skipped (`describe.skipIf`), same honesty as `packages/store-postgres/docs/testing.md`.

## Postgres is durable + multi-host

The kernel's Postgres tests migrate explicitly before the kernel (ops/CI only, never on import/request): `createPgPostgresExecutor(pool)` → `await migratePostgresAdapter(executor)` → `createPostgresStoresFromPg({ executor, namespace: { tablePrefix: prefix } })` → `createCheckoutKernel({ storeFactory })`, matching `docs/getting-started.md:140-142` and `src/app.test.ts:21`. `close` ends the pool. This host is the Postgres-backed RC host; sqlite hosts remain single-host in-memory.

## HTTP mapping is app-owned

`@paykernel/webhooks` does not choose status codes. This app returns statuses from the checkout kernel (`mapInboxOutcome`). Stripe signatures are verified on the **raw** request body (`request.text()`), never after `c.req.json()` or another body parser.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/payments` | Create order + charge |
| `POST` | `/webhooks/stripe` | Raw body + `stripe-signature` |
| `POST` | `/internal/reconcile` | **Test hook only** (unauthenticated). Process due recon jobs when `enableTestHooks: true`. Do not deploy. |
| `GET` | `/orders/:orderId` | Order book lookup |
| `POST` | `/internal/provider-paid` | **Test hook only** (unauthenticated). Injects a paid provider snapshot for local recon tests. Do not deploy. |
| `GET` | `/internal/create-count` | **Test hook only** (unauthenticated). `createPayment` call count when `enableTestHooks: true`. Do not deploy. |

## Listen (optional) — PG required

```bash
PAYMENTS_SDK_PG_URL=postgres://payments:payments@127.0.0.1:54329/payments_sdk bun src/index.ts
# or for in-memory fallback (dev only):
ALLOW_MEMORY_FALLBACK=1 bun src/index.ts
```

Without `PAYMENTS_SDK_PG_URL`/`DATABASE_URL` the process exits. Set `ALLOW_MEMORY_FALLBACK=1` explicitly to run the in-memory fallback (not for production PG RC).

Not used by tests. Local listen does **not** enable test hooks (`enableTestHooks` stays off). Do not deploy this example as-is.
