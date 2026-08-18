# @paykernel/core

Type-safe payment orchestration for TypeScript: Moyasar, PayPal, Paymob, Stripe, plus a plugin registry. Portable across Node ≥ 18, Bun, Deno, and Cloudflare Workers (see [runtime.md](./docs/runtime.md)). Server-side only for secret keys.

**Production fulfillment** is not this package alone. `handleWebhook` verifies and normalizes. Claim, lease, and durable retry live in [`@paykernel/webhooks`](../webhooks/README.md) plus a store from [adapter-selection.md](../../docs/adapter-selection.md). Composition walkthrough: [docs/getting-started.md](../../docs/getting-started.md).

## Features

- 🔌 **Multi-Gateway Support**: Moyasar, PayPal, Paymob, Stripe + third-party plugins
- 💰 **Safe money + outcomes**: `money()`, `isPaidOutcome`, indeterminate post-submit results ([money](./docs/money.md), [operation-results](./docs/operation-results.md))
- 🧩 **Open plugin API**: `createPaymentClient` + `GatewayAdapter` registry (see [plugin architecture](./docs/plugin-architecture.md))
- 🪝 **Lifecycle Hooks**: Before, after, and error hooks on hooked operations (global + per-op where supported — not every method has a dedicated hook; see [hooks matrix](./docs/hooks.md#which-operations-fire-which-hooks))
- 🔒 **Type-Safe**: Full TypeScript support with strict types (names inferred from your registry)
- 🌐 **Runtime-portable**: Web APIs + pure crypto; no required Express/Hono/Elysia adapter

## Documentation

- **Gateways**
  - [Moyasar](./docs/moyasar.md)
  - [PayPal](./docs/paypal.md)
  - [Paymob](./docs/paymob.md)
  - [Stripe](./docs/stripe.md)
- **Core Concepts**
  - [Safe Money Model](./docs/money.md) (`money()`, bigint minor units, 0.x `number` migration)
  - [Operation results & outcomes](./docs/operation-results.md) (Phase 6: `outcome`, `isPaidOutcome`, indeterminate)
  - [Lifecycle Hooks](./docs/hooks.md)
  - [Webhook Handling](./docs/webhooks.md) (verify / parse / hooks)
  - [Typed webhook events](./docs/webhook-events.md) (Phase 7: stable `PaymentEvent`, dual-write, envelopes)
  - [Runtime portability](./docs/runtime.md) (Phase 8: `PaymentRuntime`, portable crypto, Deno/Workers)
  - [Logging & Redaction](./docs/logging.md)
  - [Telemetry & OperationContext](./docs/telemetry.md) (Phase 20: redacting `TelemetrySink`, no OTEL in core)
  - Optional metrics/spans: [`@paykernel/opentelemetry`](../observability/README.md)
  - [Custom Gateways / plugins](./docs/custom-gateways.md)
  - [Plugin architecture](./docs/plugin-architecture.md)
  - [Gateway capabilities matrix](./docs/gateway-capabilities.md) (generated from code)
- **Testing (separate package)**
  - [`@paykernel/testkit`](../testkit/README.md) — `mockGateway`, `runGatewayConformanceSuite`, store harnesses, fixture safety (core does **not** depend on testkit)
- **Storage adapters (app-layer; core does not depend on them)**
  - [Storage adapters pointer](./docs/storage-adapters.md) → monorepo [adapter-selection.md](../../docs/adapter-selection.md) (Phase 18 matrix + decision tree)
- **Composition (monorepo)**
  - [Getting started](../../docs/getting-started.md) — inbox + store + reconcile
  - [Store contracts](../store-contracts/docs/contracts.md)
- **Contracts**
  - [Behavioral contracts](./docs/behavioral-contracts.md)

## Package Structure

This package lives at `packages/core` in the monorepo. Published name remains `@paykernel/core`.

```
packages/core/             # @paykernel/core (publishable)
├── src/
│   ├── index.ts           # Main exports
│   ├── client.ts          # PaymentClient orchestrator
│   ├── errors.ts          # Custom error classes
│   ├── types/             # Type definitions
│   ├── hooks/             # Lifecycle hooks
│   └── gateways/          # Gateway implementations (moyasar, paypal, paymob, stripe)
├── dist/                  # Built output
├── docs/                  # Documentation (ships with the package)
├── package.json
├── README.md
└── tsconfig.json
```

## Installation

```bash
bun add @paykernel/core
# or
npm install @paykernel/core
# or
pnpm add @paykernel/core
```

This package is **ESM-only** (`"type": "module"`, `exports.import` only — no CommonJS `require` build). Use **Node ≥ 18** (LTS 18/20/22 recommended) or **Bun ≥ 1.0** with ESM (`import` / `"type": "module"`). Portable Web APIs + pure crypto also target Deno and Cloudflare Workers — see [runtime.md](./docs/runtime.md). Server-side only for secret keys (do not ship secrets to browsers).

## Quick Start

Preferred (plugin / adapter factories):

```typescript
import { createPaymentClient, moyasarGateway } from "@paykernel/core";

const client = createPaymentClient({
  gateways: {
    moyasar: moyasarGateway({
      secretKey: process.env.MOYASAR_SECRET_KEY!,
      webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
    }),
  },
  defaultGateway: "moyasar",
});
```

Legacy constructor (still supported in 0.x; prefer `createPaymentClient`):

```typescript
import { PaymentClient } from "@paykernel/core";

const client = new PaymentClient({
  moyasar: {
    secretKey: process.env.MOYASAR_SECRET_KEY!,
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
  },
  defaultGateway: "moyasar",
});
```

Using either client:

```typescript
import { money } from "@paykernel/core";

// Create a payment (prefer money() decimal strings; plain number still works in 0.x)
const result = await client.createPayment({
  amount: money("100.00", "SAR"),
  currency: "SAR",
  orderId: "order_123",
  callbackUrl: "https://example.com/callback",
  moyasarSource: {
    type: "token",
    token: "token_xxx",
  },
});

if (result.status === "failed") {
  // Do not mark the order paid.
} else if (result.redirectUrl) {
  // Redirect customer for 3DS verification
}
```

## Multi-Gateway Usage

```typescript
const client = new PaymentClient({
  moyasar: { secretKey: '...' },
  paypal: { clientId: '...', clientSecret: '...' },
  paymob: {
    secretKey: '...',
    publicKey: '...',
    hmacSecret: '...',
    integrationId: 123456,
    authIntegrationId: 456789, // for capture: false auth/capture flows
    region: 'ksa',
    timeoutMs: 30000,
  },
  stripe: {
    secretKey: 'sk_...',           // required — this package is server-side only
    publishableKey: 'pk_...',      // optional here; browser Stripe.js / Elements only
    webhookSecret: 'whsec_...',
  },
  defaultGateway: 'moyasar',
});

// Use default gateway
await client.createPayment({ ... });

// Specify gateway explicitly
await client.createPayment({ ... }, 'paypal');

// Stripe Checkout Example
const stripe = client.gateway('stripe');
const session = await stripe.createCheckoutSession({
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
  mode: 'payment',
  metadata: { paymentId: 'order_123' },
  lineItems: [
    {
      priceData: {
        currency: 'USD',
        productData: {
          name: 'T-Shirt',
        },
        amount: 20,
      },
      quantity: 10,
    }
  ]
});
```

### Multi-gateway: refund IDs and `capture: false`

The unified API hides provider differences, but **IDs and auth flows are not interchangeable** across gateways. Store the IDs each provider expects for later capture / refund / void:

| Topic                | Moyasar                                                                      | PayPal                                                                                                              | Paymob                                                                                                            | Stripe                                                                                |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Refund target ID** | Payment UUID from create / webhook                                           | **Capture ID** (not order ID) from `capturePayment()`                                                               | **Numeric transaction ID** from webhook/dashboard (not intention `pi_...`)                                        | PaymentIntent `pi_...` (or related charge, per Stripe docs)                           |
| **`capture: false`** | Auth-only payment; later `capturePayment` / `voidPayment` on that payment ID | `AUTHORIZE` intent order → customer approves → `authorizePayment` → `capturePayment` / void on **authorization ID** | Sends `is_auth: true` and uses `authIntegrationId` (or auth method override); capture/void use **transaction ID** | PaymentIntent with manual capture; later `capturePayment` / cancel (void) on `pi_...` |

Always use the gateway that created the payment for follow-up calls (`refundPayment(..., 'paypal')`, etc.). See each gateway doc for edge cases (partial refunds, currency, idempotency).

### Integrator caveats

- **After-hooks cannot undo money.** Hooks that run after a successful create/capture/refund/void (`onAfter`, `afterCapture`, …) may throw or return `{ proceed: false }`, but the provider side effect already happened — the SDK **logs and still returns success** (no `PaymentAbortedError`, no reverse of the charge). Use before-hooks to abort, and reconcile in your app if an after-hook fails. Details: [hooks](./docs/hooks.md#after-hooks-cannot-abort-money-operations).
- **Webhook handlers must be idempotent on `event.id`.** Providers retry deliveries. The SDK verifies and normalizes events; it does **not** dedupe by provider event id. Persist processed `event.id` (or equivalent) and no-op duplicates before fulfilling orders. Details: [webhooks](./docs/webhooks.md).
- **Prefer Phase 7 `PaymentEvent` for new fulfillment.** `WebhookEvent.type` stays provider-native for 0.x; use `attachPaymentEvent` / `event.event` and switch on stable names (`payment.succeeded`, …). Persist via `toPersistedPaymentEventEnvelope` (never store `rawPayload` by default). Details: [webhook-events](./docs/webhook-events.md).
- **Prefer `money("10.50", "SAR")` over float `number` amounts.** Shared helpers convert decimal strings to **bigint** minor units (never `amount * 100` float math). Plain `number` major units remain accepted in 0.x but are **deprecated** — pass clean decimals only (`10.5`, `99.99`), never `0.1 + 0.2`. See [Safe Money Model](./docs/money.md).

## Production checklist

Use this before going live. Gateway-specific details live under [docs/](./docs/).

| Check                                                  | Why                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PayPal `webhookId`**                                 | Required for `verifyWebhookAsync` / `handleWebhook`. Missing config throws `InvalidRequestError` (`paypal.webhookId is required…`). Set from the PayPal Developer Dashboard webhook.                                                                                               |
| **Moyasar / Paymob `idempotencyStore` (multi-worker)** | In-memory store is per process only. Multi-worker, serverless, or restart-safe capture/refund/void needs a shared store (Redis/DB) with atomic `reserve` where available. Configure `moyasar.idempotencyStore` / `paymob.idempotencyStore` and pass `idempotencyKey` on mutations. |
| **Raw body for webhooks**                              | Stripe and PayPal verification need the **unparsed** request body (string/Buffer). Do not `JSON.parse` first; prefer `client.handleWebhook(gateway, rawBody, signatureOrHeaders)`.                                                                                                 |
| **Fulfill on paid outcome / `status`, not `success`**  | `success: true` means API call OK (can be pending / 3DS / approved). Prefer Phase 6 **`isPaidOutcome(result)`** or `outcome === 'succeeded'` with **`status === 'paid'`** only (`approved` / `authorized` are not paid-like). Never treat `indeterminate` as paid or as a definitive decline — reconcile. See [operation-results.md](./docs/operation-results.md). |
| **Amounts / money model**                              | Prefer `money("10.50", "SAR")` (`AmountInput = number \| Money`). Conversion uses bigint minor units + ISO exponents (provider overrides stay explicit). Deprecated `number` inputs must be clean decimals — see [money.md](./docs/money.md).                                      |
| **Idempotent webhook handlers**                        | Persist processed `event.id` (app-level — the SDK does not store it) before inventory/fulfillment.                                                                                                                                                                                 |
| **Secret keys server-side only**                       | Never put `secretKey` / `clientSecret` / `whsec_…` / HMAC secrets in browser code.                                                                                                                                                                                                 |

## Keys: secret vs publishable

This package is **server-side only**. Configure **secret** keys (`secretKey`, PayPal `clientSecret`, Stripe `sk_…` / `whsec_…`, Moyasar `sk_…`, Paymob `secretKey` / `hmacSecret`) on the backend.

**Publishable / public keys** (`publishableKey`, Paymob `publicKey`) are for browser SDKs (Stripe.js, Elements, Paymob.js, etc.). They are optional on `PaymentClient` config and are **not** used for create/capture/refund/void or webhook verification in this package. Do not put secret keys in client-side code.

## Stripe Webhook Note

For Stripe webhooks, you **MUST** pass the raw request body to `handleWebhook` (or `verifyWebhook` if you verify manually). If your framework parses JSON automatically, access the raw body buffer or string before parsing; Buffer payloads are verified using their original bytes.
Prefer `client.handleWebhook('stripe', rawBody, signature)` — it verifies, parses, and runs webhook hooks. Stripe webhook verification fails closed when `webhookSecret` is not configured.
Stripe webhook parsing expects snapshot events with `data.object`; hydrate thin events before passing them to `parseWebhookEvent`. Checkout, invoice, and subscription webhooks normalize `gatewayPaymentId` to the related PaymentIntent, SetupIntent, or Subscription when Stripe includes one.

```typescript
// Example using Elysia / Fetch-style handlers
app.post("/webhook/stripe", async ({ request }) => {
  const signature = request.headers.get("stripe-signature") ?? undefined;
  const rawBody = await request.text(); // raw body — do not JSON.parse first

  const event = await client.handleWebhook("stripe", rawBody, signature);
  // fulfill from event.status / event.gatewayPaymentId — be idempotent on event.id
  return { received: true };
});
```

## Error Handling

```typescript
import {
  PaymentError,
  PaymentAbortedError,
  GatewayNotConfiguredError,
  InvalidWebhookError,
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  RateLimitError,
} from '@paykernel/core';

try {
  await client.createPayment({ ... });
} catch (error) {
  if (error instanceof PaymentAbortedError) {
    // Aborted by a hook
    console.log('Aborted:', error.message);
  } else if (error instanceof GatewayApiError) {
    // Gateway API returned an error
    console.log('Gateway error:', error.rawError);
  } else if (error instanceof PaymentError) {
    // Other payment error
    console.log('Error code:', error.code);
  }
}
```

## License

MIT
