# Bun + Hono + SQLite checkout

Thin Hono `fetch` adapter over `@paykernel/example-checkout-kernel`. The kernel owns checkout, inbox, and reconciliation. This package only maps HTTP.

## Tests

From this directory:

```bash
bun test
```

From the monorepo root:

```bash
bun test examples/bun-hono-sqlite
```

Tests construct `createHonoCheckoutApp(kernel)` and call `app.fetch`. They do not start a listener.

## `:memory:` is process-local

The kernel uses in-memory Bun SQLite (`:memory:`) after an explicit `migrateSqliteAdapter`. That database is **single-host and process-local**. It is not multi-host coordination and must not be shared across machines.

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

## Listen (optional)

```bash
bun src/index.ts
```

Not used by tests. Local listen does **not** enable test hooks (`enableTestHooks` stays off). Do not deploy this example as-is.
