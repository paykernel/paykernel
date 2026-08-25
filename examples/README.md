# PayKernel examples

Private workspace packages (`private: true`, never published). They are **consumer apps**, not SDK packages: they compose the public surface at the application layer.

Kernel lives in [`checkout-kernel`](./checkout-kernel) (`@paykernel/example-checkout-kernel`). Hosts import its public helpers. Do **not** reimplement `mapInboxOutcome` or Stripe signing. `packages/*` must never import `examples/*`.

| Directory | Package | Role |
| --- | --- | --- |
| [`checkout-kernel`](./checkout-kernel) | `@paykernel/example-checkout-kernel` | Shared kernel, route helpers, Stripe fixtures, HTTP policy (`mapInboxOutcome` re-exported from `@paykernel/integration-http`), `runCheckoutHttpScenarios` |
| [`bun-hono-sqlite`](./bun-hono-sqlite) | `@paykernel/example-bun-hono-sqlite` | Thin Hono `fetch` adapter (via `@paykernel/integration-hono`) |
| [`bun-elysia-sqlite`](./bun-elysia-sqlite) | `@paykernel/example-bun-elysia-sqlite` | Thin Elysia `fetch` adapter (via `@paykernel/integration-elysia`) |
| [`express-sqlite`](./express-sqlite) | `@paykernel/example-express-sqlite` | Thin Express adapter (via `@paykernel/integration-express`, `expressAppToFetch` for tests) |
| [`cloudflare-workers-fetch`](./cloudflare-workers-fetch) | `@paykernel/example-cloudflare-workers-fetch` | Thin Workers `fetch` adapter (via `@paykernel/integration-cloudflare-workers`, `handleCloudflareWebhook`) |

## Honesty

- Local SQLite (`@paykernel/store-sqlite`) is **single-host only**. These examples use **in-memory** Bun SQLite (`createBunSqliteStoresInMemory`) after an explicit `migrateSqliteAdapter`. `:memory:` is one process, not multi-host.
- HTTP status codes live in `@paykernel/integration-http` (`mapInboxOutcome` re-exported by checkout kernel), **not** in `@paykernel/webhooks`.
- Fulfillment runs only after an inbox claim, and only when the rematched event is `payment.succeeded` / `capture.completed` with `payment.status === "paid"`. Stripe metadata `orderId` cannot fulfill a mock-charged order whose stored `gatewayPaymentId` differs; a missing stored id is bound from the webhook PI then matched.
- Charges use the **server catalog** amount. Provider recon snapshots use `getPayment` money (currency published with major-unit amounts), never `order.amount` or client JSON.
- Never fulfill in `onWebhookVerified`. Never `createPayment` again after an indeterminate create — lookup + `decideReconciliationPolicy` only.
- `POST /internal/provider-paid`, `POST /internal/reconcile`, and `GET /internal/create-count` are **local test hooks**. They are **unauthenticated** and **must not be deployed**. Serve them only with `{ enableTestHooks: true }` in tests.

## Public kernel helpers

```typescript
import {
  createCheckoutKernel,
  createCheckoutHandlers,
  createCheckoutFetchApp,
  mapInboxOutcome,
  signedStripePaidWebhook,
  signStripeWebhook,
  runCheckoutHttpScenarios,
} from "@paykernel/example-checkout-kernel";
```

Hosts stay thin: `createCheckoutKernel()`, then `createCheckoutHandlers(kernel)` plus `readRequestJson` / `checkoutJsonResponse` (or `createCheckoutFetchApp` / `dispatchCheckoutRequest` for a framework-less `fetch`).

Webhook routes **must** read the raw body **before** any JSON parser, then pass it through the kernel (which calls `handleWebhook("stripe", raw, sig)`):

```typescript
const raw = await request.text(); // Hono: c.req.text() — never c.req.json()
const sig = request.headers.get("stripe-signature");
await handlers.handleStripeWebhook(raw, sig);
```

Use `signStripeWebhook` / `signedStripePaidWebhook` from the kernel. Do not copy HMAC helpers.

## Routes

- `POST /payments`
- `POST /webhooks/stripe` (raw body text + `stripe-signature`)
- `POST /internal/reconcile` — **test hook only**, unauthenticated; do not deploy (`enableTestHooks`)
- `GET /orders/:id`
- `POST /internal/provider-paid` — **test hook only**, unauthenticated; do not deploy
- `GET /internal/create-count` — **test hook only**, unauthenticated; do not deploy (`enableTestHooks`)

## Run

From the repository root:

```bash
bun install
bun test examples
# or
bun run test:examples
```

Root `typecheck` and `lint` include `examples/*`. Production composition (Postgres, inbox, reconcile) stays in [`docs/getting-started.md`](../docs/getting-started.md) — this tree is the runnable Bun + single-host SQLite walkthrough.
