# @paykernel/example-bun-elysia-sqlite

Thin Bun + Elysia `fetch` adapter over [`@paykernel/example-checkout-kernel`](../checkout-kernel). Private workspace example — not published, and **not** `@paykernel/integration-elysia`.

HTTP status codes live in the checkout kernel (`mapInboxOutcome`), **not** in `@paykernel/webhooks`. Fulfillment runs only after an inbox **claim**, and only when the rematched event is `payment.succeeded` / `capture.completed` with `payment.status === "paid"`. Never fulfill in `onWebhookVerified`. Never `createPayment` again after an indeterminate create — lookup + `decideReconciliationPolicy` only.

Local SQLite is **single-host only**. This example uses the kernel’s in-memory Bun SQLite after an explicit `migrateSqliteAdapter`. One process, one memory DB — not multi-host or multi-region coordination.

## Routes

`createElysiaCheckoutApp(kernel)` returns an `Elysia` instance that wires `createCheckoutHandlers` to:

- `POST /payments`
- `POST /webhooks/stripe` — `await request.text()` with Elysia `parse: "none"`, then the kernel Stripe path (`handleWebhook('stripe', raw, sig)`). Do not use a JSON body parser here; Stripe HMAC needs the original bytes.
- `POST /internal/reconcile`
- `GET /orders/:id`
- `POST /internal/provider-paid`
- `GET /internal/create-count`

Stripe signing fixtures live in the kernel. This package does not reimplement `mapInboxOutcome` or HMAC signing.

## Run

```bash
bun install
bun test
# optional listen (PORT, default 3000)
bun run start
```

Tests drive the app with `app.handle(req)` through the shared `runCheckoutHttpScenarios('elysia', …)` suite.
