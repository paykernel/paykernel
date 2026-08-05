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

    // Required when using createPayment({ capture: false }) unless you pass
    // paymobIntegrationId / paymobPaymentMethods per request.
    // Dual model: SDK swaps payment_methods to this auth integration AND sets
    // is_auth: true and payment_type: 'AUTH' on the Intention body.
    // Sale integrationId is never used as a silent fallback for capture:false.
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

The create result `gatewayId` is the Paymob **intention** ID (often `pi_...`), and `nextAction` exposes the checkout URL, intention ID, client secret, and payment keys returned by Paymob. Capture, refund, void, and inquiry methods require the **numeric Paymob transaction ID** from a verified processed webhook (`obj.id`) or the Paymob dashboard — **not** the intention ID from `createPayment`. Passing an intention ID such as `pi_...` or any non-numeric value is rejected before the SDK calls Paymob.

**Legacy order IDs (PAYMOB-4):** the deprecated iframe flow returns Paymob's **order** id as `gatewayId` / `orderId` (also pure digits). Transaction ids and order ids share the same numeric shape, so the SDK **cannot** distinguish them at the mutation boundary — always store **`obj.id` from a verified TRANSACTION webhook** (or dashboard transaction id) for post-pay ops. Do **not** pass the legacy create `gatewayId`/order id into capture/refund/void/getPayment. Child refund/capture webhooks set `gatewayPaymentId` to the child transaction id (true refund/capture resource). When HMAC covers a distinct `order.id`, Phase-7 dual-write binds that order id on `references.parentId` and `relatedIds.orderId` only — **not** on `gatewayObjectId` (which Phase-7 would promote to `refundId`/`captureId`).

### Auth / capture dual model

Paymob auth/capture is primarily **integration-driven**: use a dedicated auth/capture integration (via config `authIntegrationId`, or per-request `paymobIntegrationId` / `paymobPaymentMethods`). When `createPayment({ capture: false })` is used, the SDK:

1. Resolves `payment_methods` from `authIntegrationId` when no per-request override is supplied. Sale `integrationId` is **not** used as a fallback (a sale integration can settle immediately despite auth-oriented body flags).
2. Sets `is_auth: true` and `payment_type: 'AUTH'` on the Intention request body to document auth-only intent.

If `capture: false` is used without `authIntegrationId` and without a per-request method override, the SDK rejects the request instead of silently creating a sale-integration payment.

`idempotencyKey` is used as a fallback Paymob `special_reference` during payment creation and deduplicates repeated SDK calls within the same `PaymentClient`/gateway instance. Reusing the same key with different parameters is rejected. For production with multiple workers, serverless invocations, or deploy restarts, configure `idempotencyStore` with Redis, a database, or another process-wide store so completed results can be replayed across gateway instances. Implement the store's optional `reserve` method atomically, such as Redis `SET NX` or a database unique constraint, for full cross-worker duplicate-call protection. The SDK warns at construction when a store lacks atomic `reserve()`, and when no store is configured in a serverless/edge environment.

Paymob does not expose native idempotency keys for capture, refund, void, or Intention creation. If a network failure, Paymob 5xx response, **or HTTP 200 with an empty/malformed body** (missing/invalid `success`, missing refund id, non-boolean success that cannot be coerced) happens after the SDK sends one of those mutating requests, the SDK marks that `idempotencyKey` outcome as unknown and blocks automatic replay. Reconcile via a verified Paymob callback, transaction inquiry, or the Paymob dashboard before issuing a new mutation. String `"true"`/`"false"` success values and string minor-unit money fields on mutation responses are coerced when present.

> ⚠️ **Serverless / edge deployments:** the built-in idempotency cache is an
> in-memory `Map` that lives per isolate and is wiped frequently on platforms
> like AWS Lambda, Vercel, Cloudflare Workers, and Google Cloud Run, so it
> provides almost no duplicate protection there. When the SDK detects such an
> environment and no `idempotencyStore` is configured, it emits a loud warning
> through the configured logger at startup. **Always configure `idempotencyStore`
> with a shared store (Redis/SQL) in serverless/multi-worker deployments.**

`callbackUrl` maps to Paymob's optional `notification_url` on Create Intention. For **card** integrations, Paymob may deliver **TRANSACTION** processed callbacks to that URL (in addition to, or instead of, dashboard-configured endpoints — confirm for your integration). **TOKEN** (saved-card) callbacks are delivered to the dashboard **Integration Transaction Processed Callback**, not typically to the Intention `notification_url`. You can omit `callbackUrl` and rely on dashboard-configured processed callbacks. The SDK verifies both shapes: transaction HMAC (processed + redirect) and TOKEN HMAC for card-token payloads — keep `hmacSecret` configured either way.

## Capture Payment

> ⚠️ **Multi-worker footgun:** Paymob has **no** native idempotency for capture /
> refund / void. Without a shared `paymob.idempotencyStore` **and** a stable
> `idempotencyKey` on each mutation, concurrent workers or network retries can
> **double-capture / double-refund / double-void**. Process-local cache only
> protects a single isolate. See [Idempotency notes](#create-payment) above and
> [behavioral contracts](./behavioral-contracts.md#1-operations-safe-to-retry).

```typescript
const result = await client.capturePayment({
  gatewayPaymentId: '123456789', // Paymob transaction ID
  amount: 100,
  currency: 'SAR',
  idempotencyKey: 'capture-order-123', // required for safe retries
}, 'paymob');
```

If `amount` is omitted, the SDK first retrieves the Paymob transaction and sends the remaining capturable amount as Paymob's integer amount field. If you pass `amount` without `currency`, the SDK retrieves the transaction first and uses Paymob's transaction currency for minor-unit conversion.

When an explicit `amount` is provided, the SDK still retrieves the transaction first to verify the requested currency matches Paymob's transaction currency and that the requested amount does not exceed the remaining capturable balance.

**Capture ids (PAYMOB-2):** `result.gatewayId` is always the **parent** payment/transaction id you passed in (`gatewayPaymentId`), so later refund/void/get stay parent-targeted. When Paymob returns a distinct child capture transaction id, it is dual-written on `captureId` / `references.relatedIds.captureId` only.

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

**Pending refunds (PAYMOB-1):** when Paymob returns `pending: true`, the result has `status`/`outcome` `pending` and **omits `totalRefunded`**. Do not treat a pending refund as settled or ledger the request amount until a completed refund response or inquiry shows a settled cumulative. Completed refunds set `totalRefunded` from body `refunded_amount_cents` when present, otherwise estimate inquiry prior + this request.

## Legacy Iframe Checkout

The deprecated legacy iframe flow returns Paymob's order ID as `gatewayId`, `gatewayObjectId`, and `orderId` because no transaction exists until the customer pays. Capture, refund, void, and inquiry methods still require the **transaction** id from the processed callback or dashboard — **not** this order id (order and transaction ids are both numeric; the SDK cannot auto-reject order ids by shape alone).

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
  // Correlate with signed gatewayPaymentId (txn id) — not event.paymentId.
  // merchant_order_id / payment_key_claims extras are not HMAC-bound.
  console.log(event.gatewayPaymentId);
  console.log(event.amount);

  return { received: true };
});
```

> ⚠️ **Do not fulfill on `event.paymentId` after Paymob HMAC.** Paymob’s signature binds `id`, `order.id`, money flags, and amounts — **not** `merchant_order_id` or `payment_key_claims.extra.paymentId`. The SDK leaves `event.paymentId` undefined on transaction webhooks so a valid low-value body cannot be rewritten to a victim order id. Map `event.gatewayPaymentId` (signed transaction id) to your order in your own store, or inquire with that id.

The SDK verifies transaction processed callbacks, saved-card token callbacks, and query-style transaction response callbacks with their separate Paymob HMAC field shapes.

> ⚠️ **Never fulfill on redirect-only callbacks.** Browser/redirect (query-style) callbacks always parse with `event.type === 'TRANSACTION_RESPONSE'` — Paymob's query `type` is **not** HMAC-bound, so the SDK forces this value and never trusts a client-supplied `type=TRANSACTION` (which would otherwise skip redirect demotion). Phase 7 dual-write maps redirect success/paid/capture signals to **`payment.processing`**, never `payment.succeeded` or `capture.completed`, so fulfill-on-stable-type handlers that key only on settlement arms ignore redirects. Use the **processed** backend notification (`type: 'TRANSACTION'`) as the sole source of truth for fulfillment, capture, refund, and inventory. Redirect callbacks are for customer-facing result pages only — they can be replayed, abandoned, or spoofed by a client that never completed payment. Always wait for a verified processed webhook (or transaction inquiry) before marking an order paid. Prefer `event.stableType` / `event.event.type` for new fulfillment; if you still branch on native `type`, require `TRANSACTION` (not `TRANSACTION_RESPONSE`) plus paid-like status / `isPaidOutcome` on inquiry.

Saved-card token callbacks normalize to `status: 'setup_completed'`. Their `paymentId` is `undefined` because Paymob's `order_id` is a gateway reference, not your internal payment ID; use `gatewayToken`, `gatewayPaymentId`, `gatewayObjectId`, and the raw payload to associate tokens in your own card-vault flow. **`gatewayPaymentId` is HMAC-covered only** (`order_id`, falling back to the token record `id`) — never unsigned `next_payment_intention` (outside `CARD_TOKEN_HMAC_FIELDS`; a valid TOKEN HMAC can still rewrite that field). TOKEN callbacks also accept string digits for numeric fields such as `id` and `merchant_id` (same coercion as transaction webhooks). **HMAC-covered status only.** Paymob's transaction HMAC covers `is_auth`, `is_capture`, `is_refunded`, `is_voided`, `success`, `pending`, and `amount_cents` — **not** `is_captured`, `captured_amount`, `refunded_amount_cents`, `is_refund`, or `is_void`. After verification the SDK strips unsigned status-driving fields before mapping so a replayed valid signature cannot forge paid/refunded/cancelled via injected slots. Practical consequences:

- Auth-only callbacks (`is_auth` + not `is_capture`) stay `authorized` even if the payload injects `is_captured` / `captured_amount`. Use **transaction inquiry** for multi-partial capture totals on the webhook path.
- Signed `is_capture` + success **without** a trusted cumulative `captured_amount` maps to `processing` (not `paid` / not `capture.completed`). Webhooks strip unsigned `captured_amount`, so partial capture cannot fail-open as full paid + order `amount_cents`. Incomplete capture webhooks also **omit `amount`** (symmetric with incomplete refunds) so dual-write consumers do not book the full order total as captured. Inquire for cumulative captured amount before fulfillment.
- Signed `is_refunded: true` **and** HMAC-aliased `is_refund` + success both map to `refund_completed` (incomplete money snapshot) — not full `refunded` / `partially_refunded`. `refunded_amount_cents` is **unsigned** and is stripped after HMAC verify, so it cannot choose partial vs full completeness on webhooks. Inquire for refund totals before treating an order as fully reversed.
- Refund domain webhooks omit `amount` when no trusted refunded total is available so dual-write consumers do not book order `amount_cents` as the refund amount.
- Phase-7 `relatedIds.refundId` / `captureId` use the emitting transaction id (`gatewayPaymentId` / `obj.id`), never HMAC `order.id`. Parent order correlation is `references.parentId` / `relatedIds.orderId` only.
- Amount-only refunds without a signed refund flag are ignored.
- `is_refund` / `is_void` are trusted only when they are the HMAC source (the corresponding `is_refunded` / `is_voided` field is absent). When both are present, only the signed current-state flag is used.
- Inquiry (`getPayment`) and capture/refund API responses still use full amount fields from authenticated Paymob APIs and can map full/partial `refunded` / `partially_captured` when amounts are present.
- **`capturePayment` fail-closed:** success without a positive cumulative captured total maps to `processing` (not `paid` / not `isPaidOutcome`). When the provider omits `captured_amount`, the SDK estimates cumulative as inquiry prior + this request amount — it does **not** treat response `amount_cents` as this-op (that field may be the order total).

> **Phase 7 dual-write:** Prefer `event.event.type` / `stableType` for fulfillment and require full paid / capture completion; do not assume TRANSACTION + success flags alone means fully paid. Redirect callbacks remain demoted to `payment.processing`.

### Operation outcomes (`getPayment` / capture)

- **`isPaidOutcome(result)` is mandatory for fulfillment** — never fulfill on
  `outcome === 'succeeded'` or `success: true` alone. Auth holds (`authorized`)
  dual-write `outcome: 'succeeded'` (hold placed) but are **not** paid-like.
  Partial captures dual-write `outcome: 'requires_action'` (open money story) with
  status `partially_captured` and `isPaidOutcome` false.
- **Inquiry `success` missing is fail-closed:** transaction inquiry defaults
  missing `success` to **false** (mutations require a boolean/`"true"`/`"false"`
  success and treat other missing/invalid bodies after HTTP 200 as indeterminate).
  Paid / authorized paths cannot invent success when Paymob omits the field;
  status maps to non-paid (`failed` / declined outcome) unless amount/flag-derived
  refund or void state applies.


## Supported Regions

**Default region is `ksa`.** Egypt merchants must set `region: 'eg'` or an explicit `baseUrl` (e.g. `https://accept.paymob.com`); otherwise Intention and management calls go to the KSA host.

| Region | Base URL | Notes |
|--------|----------|--------|
| `ksa` (default) | `https://ksa.paymob.com` | Default when `region` and `baseUrl` are omitted. |
| `eg` | `https://accept.paymob.com` | **Required for Egypt accounts** — set `region: 'eg'` or `baseUrl` explicitly. |
| `pk` | `https://pakistan.paymob.com` | **Experimental / unofficial** — kept for backward compatibility; not guaranteed against current Paymob Pakistan docs. Prefer an explicit `baseUrl` if your account host differs. |
| `om` | `https://oman.paymob.com` | Confirm OMR minor-unit scaling with your Paymob Oman account (SDK defaults to ISO ×1000; use `currencyExponentOverrides` if your account differs). |
| `ae` | `https://uae.paymob.com` | |
