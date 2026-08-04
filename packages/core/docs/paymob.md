# Paymob Gateway

Paymob uses the Unified Intention API for hosted checkout. Amounts passed to the SDK are in **major** currency units (`AmountInput` = deprecated `number` or preferred `money("20.125", "OMR")`). Conversion to Paymob's integer minor-unit amount uses the shared money helpers (`normalizeAmountInput` / `toMinorUnits` / bigint — never float `amount * 100`) with the **ISO 4217** minor-unit exponent from `getCurrencyExponent`, plus optional merchant `currencyExponentOverrides`. Currency codes are normalized to uppercase before they are sent to Paymob. For common 2-decimal currencies like SAR, EGP, AED, and PKR that means scale ×100; for OMR (3 decimal places) that means scale ×1000 (e.g. `20.125` OMR → `20125`). See [Safe Money Model](./money.md).

> **OMR / Oman:** the SDK defaults to the ISO exponent (×1000). Merchants integrating with a Paymob Oman account should confirm with Paymob that their account expects ISO minor units for OMR. If account-specific scaling differs, set `currencyExponentOverrides` (e.g. `{ OMR: 2 }`) after confirming with Paymob.

## Configuration

```typescript
import { PaymentClient } from '@paykernel/core';

const client = new PaymentClient({
  paymob: {
    // Required for Unified Intention checkout.
    // Also preferred for capture, refund, void, and transaction inquiry
    // (Authorization: Token ${secretKey}, no auth_token in the request body).
    secretKey: process.env.PAYMOB_SECRET_KEY!,
    publicKey: process.env.PAYMOB_PUBLIC_KEY!,

    // Required in production webhook handling (constructor warns if secretKey is
    // set without hmacSecret — verification fails closed until configured).
    hmacSecret: process.env.PAYMOB_HMAC_SECRET!,

    // Required payment method/integration ID or alias
    integrationId: 123456,

    // Preferred when using createPayment({ capture: false })
    // Dual model: SDK swaps payment_methods to this auth integration AND sets
    // is_auth: true and payment_type: 'AUTH' on the Intention body.
    // If omitted, the SDK falls back to integrationId with is_auth/payment_type
    // AUTH and logs a warning that a dedicated authIntegrationId is preferred.
    authIntegrationId: 456789,

    // Optional legacy fallback: when secretKey is absent, capture/refund/void/inquiry
    // exchange this apiKey via /api/auth/tokens and send auth_token (mutations) or
    // Authorization: Bearer (inquiry). Also required for deprecated iframe checkout.
    apiKey: process.env.PAYMOB_API_KEY,

    // Required only for deprecated legacy iframe checkout
    iframeId: process.env.PAYMOB_IFRAME_ID,

    // Optional: Region (default: 'ksa' → https://ksa.paymob.com).
    // Egypt merchants MUST set region: 'eg' (or an explicit baseUrl such as
    // https://accept.paymob.com); otherwise requests go to the KSA host.
    // 'pk' is experimental/unofficial — prefer explicit baseUrl if your host differs.
    region: 'ksa', // 'ksa' | 'eg' | 'pk' | 'om' | 'ae'

    // Optional: Custom base URL override
    baseUrl: 'https://ksa.paymob.com',

    // Optional: per-currency minor-unit exponent overrides (ISO codes).
    // Only set after confirming with Paymob (notably OMR on Oman accounts).
    // currencyExponentOverrides: { OMR: 3 },

    // Optional: Request timeout in milliseconds (default: 30000)
    timeoutMs: 30000,

    // Optional: shared idempotency store for multi-worker/serverless production
    // idempotencyStore: redisBackedPaymobIdempotencyStore,
  },
  defaultGateway: 'paymob',
});
```

For local-only webhook testing without an HMAC secret, set `allowUnverifiedWebhooks: true` and run with an explicit local/test environment such as `NODE_ENV=test`, `NODE_ENV=development`, or `APP_ENV=local`. The SDK refuses unverified webhooks when the environment is production or cannot be identified as local/test; do not rely on unverified webhooks outside local development.

## Create Payment

```typescript
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/webhooks/paymob', // Optional per-payment notification_url
  returnUrl: 'https://example.com/payment-result',
  orderId: 'order_123',
  metadata: {
    paymentId: 'payment_123',
    tenantId: 'tenant_123',
    email: 'customer@example.com',
    firstName: 'Mohammed',
    lastName: 'Ali',
    phone: '+966500000000',
  },
}, 'paymob');

if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

You can also pass billing details explicitly with `paymobBillingData`, and override payment methods per request with `paymobIntegrationId` or `paymobPaymentMethods`.

The create result `gatewayId` is the Paymob **intention** ID (often `pi_...`), and `nextAction` exposes the checkout URL, intention ID, client secret, and payment keys returned by Paymob. Capture, refund, void, and inquiry methods require the **numeric Paymob transaction ID** from a verified processed webhook (`obj.id`) or the Paymob dashboard — **not** the intention ID from `createPayment`. Passing an intention ID such as `pi_...`, a legacy order ID, or any non-numeric value is rejected before the SDK calls Paymob. Store the transaction id from the webhook when you fulfill payments.

### Auth / capture dual model

Paymob auth/capture is primarily **integration-driven**: prefer a dedicated auth/capture integration (via config `authIntegrationId`, or per-request `paymobIntegrationId` / `paymobPaymentMethods`). When `createPayment({ capture: false })` is used, the SDK:

1. Resolves `payment_methods` in this order when no per-request override is supplied: `authIntegrationId` → `integrationId` (with a warning that a dedicated auth integration is preferred) → error if neither is configured.
2. Sets `is_auth: true` and `payment_type: 'AUTH'` on the Intention request body to document auth-only intent.

If `capture: false` is used with **neither** `authIntegrationId` nor `integrationId` (and without a per-request method override), the SDK rejects the request instead of silently creating a normal sale payment.

`idempotencyKey` is used as a fallback Paymob `special_reference` during payment creation and deduplicates repeated SDK calls within the same `PaymentClient`/gateway instance. Reusing the same key with different parameters is rejected. For production with multiple workers, serverless invocations, or deploy restarts, configure `idempotencyStore` with Redis, a database, or another process-wide store so completed results can be replayed across gateway instances. Implement the store's optional `reserve` method atomically, such as Redis `SET NX` or a database unique constraint, for full cross-worker duplicate-call protection.

Paymob does not expose native idempotency keys for capture, refund, void, or Intention creation. If a network failure or Paymob 5xx response happens after the SDK sends one of those mutating requests, the SDK marks that `idempotencyKey` outcome as unknown and blocks automatic replay. Reconcile via a verified Paymob callback, transaction inquiry, or the Paymob dashboard before issuing a new mutation.

> ⚠️ **Serverless / edge deployments:** the built-in idempotency cache is an
> in-memory `Map` that lives per isolate and is wiped frequently on platforms
> like AWS Lambda, Vercel, Cloudflare Workers, and Google Cloud Run, so it
> provides almost no duplicate protection there. When the SDK detects such an
> environment and no `idempotencyStore` is configured, it emits a loud warning
> through the configured logger at startup. **Always configure `idempotencyStore`
> with a shared store (Redis/SQL) in serverless/multi-worker deployments.**

`callbackUrl` maps to Paymob's optional `notification_url` on Create Intention. For **card** integrations, Paymob may deliver **TRANSACTION** processed callbacks to that URL (in addition to, or instead of, dashboard-configured endpoints — confirm for your integration). **TOKEN** (saved-card) callbacks are delivered to the dashboard **Integration Transaction Processed Callback**, not typically to the Intention `notification_url`. You can omit `callbackUrl` and rely on dashboard-configured processed callbacks. The SDK verifies both shapes: transaction HMAC (processed + redirect) and TOKEN HMAC for card-token payloads — keep `hmacSecret` configured either way.

## Capture Payment

```typescript
const result = await client.capturePayment({
  gatewayPaymentId: '123456789', // Paymob transaction ID
  amount: 100,
  currency: 'SAR',
}, 'paymob');
```

If `amount` is omitted, the SDK first retrieves the Paymob transaction and sends the remaining capturable amount as Paymob's integer amount field. If you pass `amount` without `currency`, the SDK retrieves the transaction first and uses Paymob's transaction currency for minor-unit conversion.

When an explicit `amount` is provided, the SDK still retrieves the transaction first to verify the requested currency matches Paymob's transaction currency and that the requested amount does not exceed the remaining capturable balance.

## Void Payment

Use this to void a card transaction before settlement, usually on the same business day.

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: '123456789',
}, 'paymob');
```

## Refund Payment

```typescript
const result = await client.refundPayment({
  gatewayPaymentId: '123456789',
  amount: 50,
  currency: 'SAR',
  // reason is accepted by the SDK refund params type for cross-gateway consistency
  // but is ignored for Paymob (Paymob's refund API does not take a reason field).
}, 'paymob');
```

If `amount` is omitted, the SDK first retrieves the Paymob transaction and sends the remaining refundable amount. For auth/capture payments, the SDK uses `captured_amount` when Paymob includes it, so partially captured payments are not refunded above the captured total. If you pass `amount` without `currency`, the SDK retrieves the transaction first and uses Paymob's transaction currency for minor-unit conversion.

When an explicit `amount` is provided, the SDK validates it against Paymob's remaining refundable balance before calling the refund endpoint.

## Legacy Iframe Checkout

The deprecated legacy iframe flow returns Paymob's order ID as `gatewayId`, `gatewayObjectId`, and `orderId` because no transaction exists until the customer pays. Capture, refund, void, and inquiry methods still require the numeric Paymob transaction ID from the processed callback or dashboard.

## Get Payment Details

```typescript
const payment = await client.getPayment({
  gatewayPaymentId: '123456789',
}, 'paymob');

console.log(payment.status);

const status = await client.getPaymentStatus('123456789', 'paymob');
```

## Webhook Verification

```typescript
app.post('/webhooks/paymob', async (req) => {
  const hmac = req.query.hmac ?? req.body.hmac;
  const event = await client.handleWebhook('paymob', req.body, hmac);

  console.log(event.status);
  console.log(event.paymentId);
  console.log(event.amount);

  return { received: true };
});
```

The SDK verifies transaction processed callbacks, saved-card token callbacks, and query-style transaction response callbacks with their separate Paymob HMAC field shapes.

> ⚠️ **Never fulfill on redirect-only callbacks.** Browser/redirect (query-style) callbacks parse with `event.type === 'TRANSACTION_RESPONSE'` (unless Paymob supplies another `type`). Use the **processed** backend notification (`type: 'TRANSACTION'`) as the sole source of truth for fulfillment, capture, refund, and inventory. Redirect callbacks are for customer-facing result pages only — they can be replayed, abandoned, or spoofed by a client that never completed payment. Always wait for a verified processed webhook (or transaction inquiry) before marking an order paid.

Saved-card token callbacks normalize to `status: 'setup_completed'`. Their `paymentId` is `undefined` because Paymob's `order_id` is a gateway reference, not your internal payment ID; use `gatewayToken`, `gatewayPaymentId`, `gatewayObjectId`, and the raw payload to associate tokens in your own card-vault flow. TOKEN callbacks also accept string digits for numeric fields such as `id` and `merchant_id` (same coercion as transaction webhooks). Transaction callbacks can normalize to `partially_refunded` or `partially_captured` when Paymob includes partial amount fields (including `refunded_amount_cents` alone without `is_refunded`, and `captured_amount` even when `is_auth` is still true), including callbacks that send numeric or boolean fields as strings. When `captured_amount > 0`, refund completeness is compared against `captured_amount` (not the original auth `amount_cents`), so a full refund of a partial capture maps to `refunded` rather than `partially_refunded`.

> **Phase 7 dual-write / amount-only refunds:** Amount-only refunds (`refunded_amount_cents > 0` without `is_refund` / `is_refunded`) dual-write `WebhookEvent.status` of `refunded` / `partially_refunded` **and** `PaymentEvent.type` / `stableType` of **`refund.completed`** — never `payment.succeeded`. Bare `success: true` is not treated as paid when status or refund amounts indicate a refund. Sticky `is_auth` with `captured_amount > 0` dual-writes `payment.succeeded` (status `paid` / `partially_captured`), not `payment.authorized`. Prefer `event.event.type` / `stableType` (or `status`) for fulfillment — do not assume TRANSACTION + success flags alone means paid.

## Supported Regions

**Default region is `ksa`.** Egypt merchants must set `region: 'eg'` or an explicit `baseUrl` (e.g. `https://accept.paymob.com`); otherwise Intention and management calls go to the KSA host.

| Region | Base URL | Notes |
|--------|----------|--------|
| `ksa` (default) | `https://ksa.paymob.com` | Default when `region` and `baseUrl` are omitted. |
| `eg` | `https://accept.paymob.com` | **Required for Egypt accounts** — set `region: 'eg'` or `baseUrl` explicitly. |
| `pk` | `https://pakistan.paymob.com` | **Experimental / unofficial** — kept for backward compatibility; not guaranteed against current Paymob Pakistan docs. Prefer an explicit `baseUrl` if your account host differs. |
| `om` | `https://oman.paymob.com` | Confirm OMR minor-unit scaling with your Paymob Oman account (SDK defaults to ISO ×1000; use `currencyExponentOverrides` if your account differs). |
| `ae` | `https://uae.paymob.com` | |
