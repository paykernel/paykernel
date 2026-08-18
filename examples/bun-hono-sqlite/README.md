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
| `POST` | `/internal/reconcile` | Process due reconciliation jobs |
| `GET` | `/orders/:orderId` | Order book lookup |
| `POST` | `/internal/provider-paid` | Test helper: mark provider paid |
| `GET` | `/internal/create-count` | `createPayment` call count |

## Listen (optional)

```bash
bun src/index.ts
```

Not used by tests.
