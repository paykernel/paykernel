# Stripe Gateway

The Stripe gateway supports PaymentIntents, hosted Checkout Sessions, customers and stored payment methods, disputes, payment links, manual capture, refunds, void/cancel, payment lookup, and signed webhooks.

## Configuration

```typescript
import { PaymentClient } from '@paykernel/core';

const client = new PaymentClient({
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY!,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        // Optional. Defaults to the SDK's pinned Stripe API version.
        apiVersion: '2026-02-25.clover',
        // Optional. Defaults to 30000.
        timeoutMs: 30000,
    },
    defaultGateway: 'stripe',
});
```

Missing `webhookSecret` throws `InvalidRequestError` (operator configuration) rather than returning `false` as if the signature were forged.

## PaymentIntents

Use PaymentIntents when you have a custom Stripe Elements flow. The SDK returns `clientSecret` so the frontend can complete confirmation or required customer actions.

```typescript
const stripe = client.gateway('stripe');

const result = await stripe.createPayment({
    amount: 50,
    currency: 'USD',
    callbackUrl: 'https://example.com/stripe/return',
    description: 'Order #1234',
    orderId: 'order_1234',
    metadata: { paymentId: 'order_1234' },
    stripePaymentMethodId: 'pm_card_visa',
    stripeCustomerId: 'cus_123456789',
    capture: true,
});

console.log(result.gatewayId, result.status, result.clientSecret);
```

Amounts are passed to SDK methods in base currency units. The Stripe gateway converts them to Stripe minor units using Stripe currency rules, including zero-decimal currencies such as JPY, special whole-unit currencies such as ISK and UGX, and three-decimal currencies such as BHD, JOD, KWD, OMR, and TND.
For three-decimal currencies Stripe requires the minor-unit amount to be divisible by 10 (0-padding on the last digit). The gateway rejects amounts that violate this rule instead of rounding them (for example `1.234 KWD` is rejected; `1.230 KWD` becomes `1230`).
For charge creation, the gateway validates currency precision and Stripe's published maximum amount limits before sending the request. The default non-card cap is **8 digits** (`99_999_999` minor units); per-currency overrides never exceed the **12-digit card max** (`999_999_999_999`), including JPY and HUF. Minimum charge amounts can depend on settlement currency and conversion context, so Stripe remains the source of truth for minimum enforcement at request time.

For unconfirmed Stripe Elements flows, `callbackUrl` can be omitted. When `stripePaymentMethodId` is provided, the SDK confirms the PaymentIntent immediately and sends `callbackUrl` as Stripe's `return_url` when present.
If `stripePaymentMethodId` is provided without `callbackUrl`, the SDK sets `automatic_payment_methods.allow_redirects` to `never` so Stripe does not require a `return_url` for redirect-based payment methods during server-side confirmation.

Stripe metadata values must be scalar strings, numbers, or booleans. Nested metadata objects and arrays are rejected before the API request is sent. Stripe metadata limits are enforced before the API request: at most 50 keys, key names up to 40 characters without square brackets, and values up to 500 characters after string conversion.

## Checkout Sessions

### One-Time Payment

```typescript
const stripe = client.gateway('stripe');

const result = await stripe.createCheckoutSession({
    mode: 'payment',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    metadata: { paymentId: 'order_1234' },
    idempotencyKey: crypto.randomUUID(),
    lineItems: [
        {
            priceData: {
                currency: 'USD',
                productData: {
                    name: 'Premium Plan',
                    description: 'Lifetime access',
                    images: ['https://example.com/img.png'],
                },
                amount: 100,
            },
            quantity: 1,
        },
    ],
});

if (result.outcome === 'succeeded') {
    if (result.session.url) {
        redirect(result.session.url);
    }
    const sessionId = result.session.references.providerObjectId;
}
// Create success is not paid settlement — see hosted-checkout.md.
// `url` is omitted when Stripe returns null/empty after a successful create
// (session id is still on `result.session.references.providerObjectId`).
// Do not invent a hosted Checkout URL.
```

For a simple one-item payment, you can provide `amount` and `currency` instead of `lineItems`.
Both simple-session `amount` and line-item major-unit `priceData.amount` accept
`AmountInput` (`number | Money`); prefer `money("100.00", "USD")`.

```typescript
const result = await stripe.createCheckoutSession({
    amount: money('100.00', 'USD'),
    currency: 'USD',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    idempotencyKey: crypto.randomUUID(),
});
if (result.outcome === 'succeeded') {
    result.session.url;
    result.session.references.providerObjectId;
}
```

If you already store Stripe minor-unit amounts, `priceData.unitAmount` is also supported and is sent directly to Stripe as `unit_amount`. The gateway still runs the **same minor-unit validations** as converted amounts (no skipped money rules on the escape hatch): three-decimal currencies must be divisible by 10, **ISK/UGX (and other whole-unit specials with positive exponent) must be whole major units** (minor divisible by `10^exponent`, e.g. ISK `1000` ok / `1050` rejected), and charge maximums are enforced without re-scaling. **Major-unit `priceData.amount` enforces the same rules** via the shared post-scale path.
Checkout line-item `priceData.amount` and `priceData.unitAmount` can be zero when Stripe accepts a zero-priced item, such as free trials or fully discounted subscription setup.

### Subscriptions

```typescript
const result = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    idempotencyKey: crypto.randomUUID(),
    lineItems: [
        {
            price: 'price_123456789',
            quantity: 1,
        },
    ],
});
if (result.outcome === 'succeeded') {
    result.session.url;
    result.session.references.providerObjectId;
}
```

Inline `priceData` in subscription mode must include Stripe recurring price settings.

```typescript
const result = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    idempotencyKey: crypto.randomUUID(),
    lineItems: [
        {
            priceData: {
                currency: 'USD',
                productData: { name: 'Pro Plan' },
                amount: 20,
                recurring: { interval: 'month' },
            },
            quantity: 1,
        },
    ],
});
if (result.outcome === 'succeeded') {
    result.session.url;
    result.session.references.providerObjectId;
}
```

### Setup Mode

Use setup mode to save a payment method without an immediate charge.

```typescript
const result = await stripe.createCheckoutSession({
    mode: 'setup',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    currency: 'USD',
    customerId: 'cus_123456789',
    idempotencyKey: crypto.randomUUID(),
});
if (result.outcome === 'succeeded') {
    result.session.url;
    result.session.references.providerObjectId;
}
```

`cancelUrl` is optional because Stripe's `cancel_url` parameter is optional. Provide it when you want Stripe-hosted cancellation to return customers to a specific page.
Setup mode requires either `currency` or `paymentMethodTypes`, and does not accept `lineItems` or `amount`. Payment and subscription Checkout Sessions must use either `lineItems` or the simple `amount`/`currency` form, not both.
The SDK validates Stripe's Checkout line item caps: payment mode accepts up to 100 line items, and subscription mode accepts up to 40 total line items with at most 20 known recurring inline price items. Existing `price_...` IDs are accepted but their recurring/one-time type is ultimately validated by Stripe.
Unsupported Checkout fields are rejected instead of silently ignored. Add SDK support before relying on additional Stripe Checkout Session create parameters.

Create returns `{ outcome: "succeeded", session }` (or `indeterminate`). Prefer `client.createCheckoutSession` (capability-gated). See [hosted-checkout.md](./hosted-checkout.md).

**Subscription-mode IDs:** `checkout.session.completed` with `mode: 'subscription'` may set webhook `gatewayPaymentId` to `sub_*`. `capturePayment` / `refundPayment` / `voidPayment` still require `pi_*`. Resolve via `getCheckoutSession` → `result.session.references.relatedIds.paymentIntentId` or `getPayment`.

## Customers and payment methods

Stripe claims `customers` and `paymentMethods`. Create/attach/detach require a caller `idempotencyKey`. Off-session PaymentIntents use common `customerId` / `paymentMethodId` / `offSession` (see [customers.md](./customers.md)). `attachPaymentMethod` may take a Stripe card token (`tok_…`) and convert it to a PaymentMethod; that is still `paymentMethods`. Capability `tokenization` stays `false` — this adapter does not expose SetupIntent / save-card CRUD.

## Disputes and payment links

Stripe claims `disputes` (get/list/evidence) and `paymentLinks`. List disputes requires a `pi_…` or `ch_…` bound. See [disputes.md](./disputes.md) and [payment-links.md](./payment-links.md).

## Manual Capture

```typescript
const auth = await stripe.createPayment({
    amount: 100,
    currency: 'USD',
    callbackUrl: 'https://example.com/stripe/return',
    stripePaymentMethodId: 'pm_card_visa',
    capture: false,
    idempotencyKey: crypto.randomUUID(),
});

const capture = await stripe.capturePayment({
    gatewayPaymentId: auth.gatewayId,
    amount: 100,
    currency: 'USD',
    idempotencyKey: crypto.randomUUID(),
});
```

When passing a partial capture `amount`, `currency` is **required** and **must match the PaymentIntent currency**. The gateway GETs the PaymentIntent before converting majors to Stripe minor units and rejects a currency mismatch (same posture as Paymob) — never convert with a caller-only currency that differs from the PI (e.g. PI in USD + `currency: "JPY"` would under-capture). Omit `amount` to capture the full authorized amount.
After a successful capture, settled amount is `amount_received` → `latest_charge.amount_captured`. If settled is finite and less than authorized `amount`, the normalized status is `partially_captured` (same rule as `getPayment` / succeeded PaymentIntent webhooks). If settled fields are missing, status is `processing` (fail closed — not full `paid`), and the result amount falls back to authorized `amount` rather than major `0`.

## Refunds

```typescript
const refund = await stripe.refundPayment({
    gatewayPaymentId: 'pi_1234567890', // must be pi_... — not cs_... or sub_...
    amount: 50,
    currency: 'USD',
    reason: 'requested_by_customer',
    metadata: { paymentId: 'order_1234' },
    idempotencyKey: crypto.randomUUID(),
});
```

> **Refund / capture / void IDs:** money mutations require a PaymentIntent ID (`pi_...`). Checkout Session IDs (`cs_...`) and Subscription IDs (`sub_...`) are rejected. Resolve the related PaymentIntent first (for example via `getCheckoutSession({ sessionId })` → `result.session.references.relatedIds.paymentIntentId`, or from an invoice money webhook's `gatewayPaymentId` when it is a `pi_...`).

Stripe-supported reasons (`duplicate`, `fraudulent`, `requested_by_customer`) are sent to Stripe as `reason`. Other custom reason strings are attached as `metadata.reason`. Caller-provided refund metadata is forwarded to Stripe and is useful for binding refund webhooks back to your own transaction or order records.

When passing a partial refund `amount`, `currency` is **required** and **must match the PaymentIntent currency**. The gateway GETs the PaymentIntent before converting majors and rejects a mismatch — never convert with a caller-only currency that differs from the PI. Omit `amount` for a full refund. After creating the refund, the gateway asks Stripe for refunds on the PaymentIntent so `totalRefunded` reflects cumulative succeeded refunds. Pending or action-required refunds are not counted until Stripe marks them succeeded. An empty or pending-only list is **not** published as `totalRefunded: 0`. The refund create expands `charge`; if the follow-up refunds list fails, is empty, or contains no succeeded refunds, `totalRefunded` falls back to expanded `charge.amount_refunded` only when that value is a finite amount **greater than 0**. Otherwise `totalRefunded` is omitted rather than inventing `0`, a single-refund cumulative total, or a USD default. Conversion of missing Stripe minor units (`undefined` / `null`) omits the major-unit field — it does not become `0`.

## Void And Lookup

```typescript
const cancelled = await client.voidPayment({
    gatewayPaymentId: 'pi_1234567890',
    idempotencyKey: crypto.randomUUID(),
}, 'stripe');

const payment = await client.getPayment({
    gatewayPaymentId: 'pi_1234567890',
}, 'stripe');

const status = await client.getPaymentStatus('pi_1234567890', 'stripe');
```

### `getCheckoutSession({ sessionId })`

Retrieve a Checkout Session by ID and resolve related payment details:

```typescript
const result = await stripe.getCheckoutSession({
    sessionId: 'cs_test_...',
});

if (result.outcome === 'succeeded') {
    result.session.references.providerObjectId; // cs_...
    result.session.references.relatedIds?.paymentIntentId; // pi_... for refund/capture/void
    result.session.url;
    result.session.status;
    result.session.paymentStatus;
    result.session.amount; // settled amount_received when PI is expanded
}
```

Signature: `getCheckoutSession(params: { sessionId: string })`. The ID must match Stripe's `cs_...` form. The gateway expands `payment_intent` so `result.session.references.relatedIds.paymentIntentId` is available when the session created one.
When the expanded `payment_intent` is present, `getCheckoutSession` **does not ignore it**: `amount` prefers settled `amount_received` (then `amount_captured`) over `amount_total`, and `paymentStatus` rematches refunds / partial capture the same way `getPayment` does (`refunded` / `partially_refunded` / `partially_captured` / fail-closed `processing` when the charge snapshot is unobservable). Proven refunds also publish `refundedAmount` together with `currency`. Classic unpaid sessions keep native `payment_status` and publish session `amount_total` — captured rematch applies **only after** `payment_status: paid`. **Do not fulfill on GET checkout amount.**
`createCheckoutSession` / `getCheckoutSession` require a non-empty `session.id` after HTTP 200. An empty, non-JSON, or identity-less body is **not** a succeeded checkout result. Create is tagged `afterProviderSubmit`: timeout / empty / non-JSON 200 returns a **checkout-shaped** result with `outcome: 'indeterminate'` and `reconciliationRequired: true` (it is **not** a payment snapshot with `status: 'processing'`). The lookup id lives on `session.references.providerObjectId` (caller idempotency key, or `"unknown"` when Stripe never returned `cs_...`). Do **not** retry as a fresh session. `getCheckoutSession` HTTP 404 is `outcome: 'failed'` (same contract as `getCustomer`) — not a thrown transport error. GET transport failures still throw `NetworkError`.
When Stripe omits `url` (`null` or empty) after a successful create, `session.url` is **omitted** — it is not a string URL and must not be treated as one. Hosted Checkout can create a session before a customer-facing URL exists (for example some embedded / custom flows).

### `getPayment` status and amount derivation

`getPayment` expands `latest_charge` and derives status as follows (for `succeeded` PaymentIntents). Refund math is the same helper used by `payment_intent.succeeded` webhooks (`stripeSucceededIntentRefundStatus`).

1. **Charge snapshot**: prefer an expanded `latest_charge` object whose refund fields are **observable** (`refunded === true` or finite `amount_refunded`, including `0`). When Stripe returns `latest_charge` as an **unexpanded string ID** or an **id-only `{ id: "ch_…" }` object**, the gateway re-fetches `GET /charges/{id}`. If `latest_charge` is omitted, the gateway uses `charges.data[0]` (legacy list shape) the same way webhooks do. **Auth / 5xx / 429 / transport failures on `GET /charges/{id}` propagate** (`AuthenticationError` / `NetworkError` / `RateLimitError`) — they are not “still settling.” Fail-closed **`processing`** is only for an unobservable charge (no fetch attempted, 404, or a non-retryable `GatewayApiError`). Never map `succeeded` + unobservable refunds as `paid` (Stripe keeps PaymentIntent status `succeeded` after refunds).
2. **Refunds first** (override capture state): `refunded: true` is a full refund. If `amount_refunded > 0`, completeness is measured against the **captured base**, not the original authorization:
   - captured base = `amount_received` (if finite) → else `latest_charge.amount_captured` (if finite). **No fallback to authorized PaymentIntent `amount`** (STRIPE-4) — that would claim full `refunded` against the auth total after a partial capture.
   - status is `refunded` when the captured base is known, `capturedBase > 0`, and `amount_refunded >= capturedBase`; otherwise `partially_refunded` (including when captured fields are missing — fail closed).
3. **Partial capture**: if not refunded, settled amount is `amount_received` (if finite) → else `latest_charge.amount_captured` (if finite). When settled is known and `< amount`, status is `partially_captured`. Settled does **not** fall back to authorized `amount` (that would hide partial captures).
4. **Incomplete money snapshot**: if not refunded and settled amount is missing, status is **`processing`** (fail closed) — never map missing settled fields to full `paid`.
5. Otherwise the Stripe PaymentIntent status is mapped (`succeeded` → `paid`, `requires_capture` → `authorized`, etc.). Unmapped PaymentIntent statuses fail closed as `failed` (with a logger warning) so unknown states are not treated as pending fulfillment.

**Amount** prefers settled money when available: for succeeded intents, `amount_received` → `amount_captured` when finite; otherwise authorized `amount`. So `payment.amount` reflects the captured total after partial capture when Stripe includes settled fields. Amount conversion is omitted when currency is missing (never silently defaults to USD).

> **Hard invariant — PaymentIntent IDs for money mutations:** `capturePayment`, `refundPayment`, and `voidPayment` **require** a Stripe PaymentIntent ID (`pi_...`). Subscription and invoice webhooks may set `gatewayPaymentId` to a `sub_...` (or other non-PI) ID. **Do not** pass those IDs into refund/capture/void — resolve the related PaymentIntent first (for example from the invoice or charge), then mutate that `pi_...`.

## Idempotency

Stripe mutations always send an `Idempotency-Key` when they POST.

- **`capturePayment` / `refundPayment` / `voidPayment` / `createCheckoutSession` require a caller `idempotencyKey`.** Omitting it throws `InvalidRequestError` **before** the mutation POST (Paymob/Moyasar parity). Crash retries that mint a new UUID would otherwise duplicate captures, refunds, voids, or Checkout Sessions. Checkout create is post-submit indeterminate on timeout — a new key would look like a fresh session.
- **`createPayment`** still mints an ephemeral `crypto.randomUUID()` when you omit the field, **and logs a warning**. That key exists only for in-process `withRetry` of transient network/5xx errors. Crash retries mint a new key and can create a second PaymentIntent.

**Do not pass an empty or whitespace-only key** — validation rejects those with `InvalidRequestError` / schema failure (STRIPE-6). Supply your own stable UUID for app-level crash/retry safety across processes.

HTTP 200 with an empty or non-JSON body after a mutating request is `NetworkError` with `afterProviderSubmit: true`. Payment / capture / refund / void map that to `outcome: 'indeterminate'` + `reconciliationRequired: true` (reconcile; do not treat as `failed` / `pending` / `success: true`). **Checkout create** maps to a **checkout-shaped** indeterminate result (`success` is not `true`; lookup id lives on `session.references.providerObjectId` — caller idempotency key, or `"unknown"` when Stripe never returned `cs_...`) — not a payment snapshot. Create / capture / void require a string PaymentIntent `id` **and** `status`; refunds require string `id` **and** `status`. Missing `status` after HTTP 200 is the same indeterminate path (not `mapStatus(undefined)` → `failed` coerced to a clean decline). Void sets `forceOutcome: succeeded` only when native status is `canceled` / `cancelled` (intentional void). A parsed `{}` after 200 is the same indeterminate path — it is not mapped with `fromStripeAmount(undefined)` to major `0`.

## Checkout customer identity

Pass either `customerId` **or** `customerEmail`, not both. Stripe Checkout rejects combining an existing Customer with a guest email; the SDK fails the request early with `InvalidRequestError`.

## Webhooks

**Prefer `client.handleWebhook('stripe', rawBody, signature)`** over calling `verifyWebhook` and `parseWebhookEvent` yourself. `handleWebhook` verifies the signature, then parses, and runs webhook hooks. `parseWebhookEvent` alone does **not** verify authenticity — never fulfill from an unverified parse.

Pass the exact raw request body string or `Buffer`. Do not pass a parsed JSON object; Stripe signs the original byte stream and verification will fail if the body is changed. Buffer payloads are verified from their original bytes.
`parseWebhookEvent` expects Stripe snapshot event payloads that include `data.object`. If you configure Stripe thin events, retrieve or hydrate the related Stripe object first, then pass a snapshot-shaped payload to the parser.

**STRIPE-CKO-1:** hydrating the *current* Checkout Session does not change `payment_status: paid` after refunds. When the hydrated session includes an expanded `payment_intent` / `latest_charge` / `charges` snapshot, `checkout.session.completed` (`payment_status: paid`) and `checkout.session.async_payment_succeeded` map `refunded` / `partially_refunded` (same captured-base rule as `payment_intent.succeeded`) and rematch Phase 7 dual-write to `refund.completed` (not `payment.succeeded`). **Amount** on those hydrated events prefers settled `amount_received` (then `amount_captured`) over `amount_total`; refund rematch then publishes cumulative `amount_refunded`. When that hydrated object has **no charge snapshot** (no expanded charge and no observable `charges.data[0]`), status is **`processing`** and dual-write is `payment.processing` — do not invent `paid` / `payment.succeeded`. A string / id-only `latest_charge` still rematches an observable `charges.data` refund (STRIPE-CHG-1). Classic snapshot events that keep `payment_intent` as a string id (no charge snapshot) also map **`processing`** / `payment.processing` — Stripe leaves `payment_status: paid` after refunds, so an unexpanded session cannot prove settlement. Expand `payment_intent` or fulfill from `payment_intent.succeeded` / `getPayment`.

Keep the Stripe webhook endpoint API version aligned with this gateway's configured `apiVersion` when possible; Stripe webhook endpoints can use a different API version than direct REST requests. Set `webhookApiVersion` only when you want the SDK to reject events whose `api_version` does not match that value — it is not defaulted from `apiVersion`.

```typescript
async function handleStripeWebhook(headers: Headers, rawBody: string) {
    const signature = headers.get('stripe-signature') ?? undefined;

    // Preferred: verify + parse + hooks in one call
    const event = await client.handleWebhook('stripe', rawBody, signature);

    // Prefer Phase-7 stable types + money helpers for fulfillment — not domain
    // status alone. Subscription lifecycle events may carry non-paid statuses
    // (e.g. active → processing); do not ship goods on status === 'paid' without
    // confirming a money event (PI/invoice/checkout) or isPaidOutcome-equivalent.
    switch (event.stableType ?? event.event?.type) {
        case 'payment.succeeded':
        case 'capture.completed':
            if (event.status === 'paid') {
                console.log(`Payment ${event.paymentId ?? event.gatewayPaymentId} succeeded`);
            }
            break;
        case 'refund.completed':
        case 'refund.pending':
            console.log(`Payment ${event.gatewayPaymentId} refund signal (${event.status})`);
            break;
        case 'payment_method.setup_completed':
            console.log(`Setup Session ${event.gatewayPaymentId} completed`);
            break;
    }
}
```

If you need gateway-level control, call `verifyWebhook` first and only then `parseWebhookEvent` — never parse without verifying.

For Checkout, Charge, Refund, Invoice, and Subscription webhook events, `gatewayPaymentId` is normalized to the most useful related Stripe object ID when Stripe includes it. Payment-mode Checkout prefers PaymentIntent, then SetupIntent, then Subscription, then the emitting object. Subscription-mode Checkout (`mode: 'subscription'`) prefers the Subscription ID even when a PaymentIntent for the first invoice is also present. `gatewayObjectId` preserves the original object ID, such as `cs_...`, `ch_...`, `re_...`, or `in_...`.

**Invoice dual IDs (money events):** for `invoice.paid`, `invoice.payment_succeeded`, and `invoice.payment_failed`, when a PaymentIntent is present the gateway sets:
- `gatewayPaymentId` → the PaymentIntent (`pi_...`) so refunds/captures can use the id directly
- `gatewaySubscriptionId` → the related Subscription (`sub_...`) when present and distinct from `gatewayPaymentId`
- `gatewayObjectId` → the invoice id (`in_...`) when distinct

PaymentIntent resolution order on invoices: (1) default entry in `payments.data` → `payment.payment_intent` / `payment_intent`, (2) legacy top-level `payment_intent`. Subscription resolution: (1) `parent.subscription_details.subscription`, (2) top-level `subscription`. When no PaymentIntent is present on a money event, `gatewayPaymentId` falls back to the subscription id, then the invoice id. Non-money invoice events still prefer subscription over PaymentIntent for `gatewayPaymentId`.

Subscription-related webhooks are normalized for common billing flows. `checkout.session.completed` in subscription mode prefers the `sub_...` ID over `payment_intent` when both are present, invoice payment success/failure events map as below, and subscription deletion maps to `cancelled`. Invoice metadata can also use `parent.subscription_details.metadata.paymentId` when the invoice itself does not carry `metadata.paymentId`.

**Invoice status / amount (NEW-STRIPE-INV-1):** `invoice.paid` / `invoice.payment_succeeded` are **not** always domain `paid`. If `object.status` is `void` / `uncollectible`, domain status is `cancelled` / `failed`. If `post_payment_credit_notes_amount` is a finite value `> 0`, status is `processing` (do not claim full paid — credit-note remainder can overwrite refunded → paid on status-only persist). Paid events also require a finite `amount_paid` to map `paid`; otherwise `processing`. Dual-write stays `provider.unmapped`. **Amount** on those events uses **`amount_paid` only** — never `total` or `amount_due` as collected. `invoice.payment_failed` still maps `failed`; `invoice.voided` / `invoice.marked_uncollectible` stay `cancelled` / `failed`.

`setup_intent.succeeded` maps domain status `setup_completed` (catalog dual-write is already `payment_method.setup_completed`). Other `setup_intent.*` events stay `pending`.

Unhandled / unknown event types do **not** run non-`payment_intent` object statuses through the PaymentIntent status map (which fails closed as `failed` for unmapped PI states). Foreign statuses such as subscription/tax `active` on an unmapped event type normalize as `pending`.

**`charge.dispute.*`:** envelope `status` is the Stripe dispute lifecycle (`needs_response`, `under_review`, `won`, `lost`, …) — **never generic payment `pending`**. Last-write persist of `event.status` must not move a paid payment to pending. Phase 7 dual-write is `dispute.opened` / `dispute.updated` / `dispute.closed`. Stripe claims `disputes: true` with get/list/submit evidence — see [disputes.md](./disputes.md). Handle the dispute arm; do not treat these as payment lifecycle. `gatewayPaymentId` prefers `payment_intent` when present.

### Subscription status mapping

| Stripe subscription `status` | SDK `PaymentStatus` |
| --- | --- |
| `active` | `processing` (not `paid` — lifecycle only; STRIPE-1) |
| `trialing` | `pending` |
| `past_due`, `incomplete`, `paused`, `unpaid` | `pending` |
| `canceled`, `incomplete_expired` | `cancelled` |
| other / unknown | `pending` |

Only `canceled` and `incomplete_expired` map to `cancelled`. **`active` maps to `processing`**, not `paid` — a live subscription is not a settled one-shot charge; fulfill from invoice/PI money events (or Checkout paid) instead of subscription status alone. **`unpaid` maps to `pending`** (not cancelled) so callers can still collect or reactivate. **`trialing` maps to `pending`** (not paid) because no collection has succeeded yet. A Checkout Session with `payment_status: paid` and an unexpanded string `payment_intent` maps to **`processing`** (S19-CKO-UNEXPANDED), including $0 trials — expand `payment_intent` or fulfill from invoice / PaymentIntent money events. `no_payment_required` + `mode: subscription` is `pending`.

> **Warning (STRIPE-5):** subscription lifecycle webhooks and **subscription-mode Checkout** (`checkout.session.completed` with `mode: 'subscription'`) may set `gatewayPaymentId` to `sub_*` (not `pi_*`) and dual-write `provider.unmapped` for pure lifecycle events. Refund/capture/void **require** a `pi_*` PaymentIntent ID and fail closed with `InvalidRequestError` on `sub_*` / `cs_*`. Resolve via `getCheckoutSession` → `result.session.references.relatedIds.paymentIntentId`, or `getPayment` / invoice money events that surface a PaymentIntent. Do not pass `cs_...` or `sub_...` into refund/capture/void. **Never fulfill inventory on subscription domain status alone.**

For `payment_intent.succeeded` (and other succeeded PaymentIntent payloads), webhook `amount` prefers settled money: `amount_received` → `latest_charge.amount_captured` / `charges.data[0].amount_captured` so partial captures report the settled total. When settled is finite and less than authorized `amount`, status is `partially_captured` (not `paid`). When settled fields are **missing**, status is **`processing`** (fail closed) — never map an incomplete snapshot to full `paid` / over-fulfill on auth amount alone. **STRIPE-2 / C1:** Stripe does not decrement `amount_received` on refund and leaves PI status `succeeded`. When expanded `latest_charge` **or** an observable `charges.data[0]` has `amount_refunded > 0` or `refunded: true`, domain status is **`refunded` / `partially_refunded`** (same captured-base rule as `getPayment`) and Phase 7 dual-write is **`refund.completed`** (not `payment.succeeded`). Webhook `amount` then publishes cumulative `amount_refunded`. When `latest_charge` is an **unexpanded id string** (Stripe's default PI webhook shape), there is **no** `charges.data` refund snapshot, and `amount_received` is finite and `> 0`, status stays **`paid`** (C1). Keep **`processing`** only when settled money is missing. **Do not last-write `payment_intent.succeeded` over `charge.refunded`** — a delayed first delivery of PI.succeeded after the charge was refunded would otherwise persist `paid` on top of `refunded`. Prefer `charge.refunded` / refund events, or rematch from `getPayment`, when both arrive. **STRIPE-CHG-1:** observable `charges.data[0]` refunds are honored even when `latest_charge` is an unexpanded string id. **STRIPE-CKO-1:** the same refund rematch applies to hydrated Checkout `payment_status: paid` / `async_payment_succeeded` snapshots (see hydrate note above). **Phase 7 dual-write** for both the **partial** (`partially_captured`) and **incomplete-settled** (`processing`) cases sets `stableType` / `event.type` to **`payment.processing`**, not `payment.succeeded` — aligned with Paymob and with `isPaidOutcome` (neither partial nor incomplete settled is paid-like). Full success (status `paid`) dual-writes `payment.succeeded`. Fulfill only when status is `paid` or `isPaidOutcome(...)` is true; do not ship on type-only `payment.succeeded` handlers without checking status. Amount is only set from real money fields on the event object; it is not defaulted to `0` when Stripe omits amount data. Currency is only set when Stripe includes it — missing currency is left undefined rather than defaulted to `USD`. **Amount conversion is also skipped when currency is missing** (invoice/checkout and any incomplete snapshot): the gateway never invents a USD exponent to scale minor units, because that mis-scales zero-decimal and three-decimal currencies.

`createPayment` / `capturePayment` / `getPayment` / `voidPayment` use the same settled-amount fail-closed rule when the PaymentIntent is `succeeded`: missing `amount_received` / `amount_captured` → domain status `processing` and outcome `requires_action` (not full `paid` / `succeeded`). Partial capture domain status is also outcome `requires_action` (open money), not operation-succeeded. **STRIPE-1:** PaymentIntent results always publish ISO `currency` together with major-unit `amount` / `refundedAmount` (never naked major units). When currency is missing, amount-like fields are omitted.

Refund webhooks handle both modern `refund.created` / `refund.updated` / `refund.failed` events and legacy `charge.refund.updated`. **STRIPE-1:** `refund.failed` and refund-object `status` `failed` / `canceled` map to domain **`refund_failed`** (not payment `failed`). In-flight refund-object statuses (`pending`, `requires_action`, …) map to **`refund_pending`** (not payment `pending`). A failed or pending refund does not un-capture the charge — do not persist these onto the payment as a decline or reopen. Dual-write stays `refund.failed` / `refund.pending`. `charge.refunded` can represent either a full or partial refund. Completeness uses the **captured** charge total (`amount_captured` when present, else `amount`), and `charge.refunded === true` is treated as a full refund when available. When `refunded !== true` and `amount_refunded` is missing/non-finite **or zero**, status is **`refund_completed`** (not fail-open `refunded` and not invented `partially_refunded`) so incomplete snapshots do not claim refund completeness. **STRIPE-2:** incomplete `refund_completed` snapshots dual-write Phase 7 **`refund.pending`** (not `refund.completed`) — Paymob parity so type-only handlers do not over-settle. Proven `refunded` / `partially_refunded` dual-write `refund.completed`. **STRIPE-3:** webhook `amount` on `charge.refunded` is cumulative **`amount_refunded`** (the money moved by refunds), not the charge/captured payment total; when refund money is incomplete the amount is **omitted**. Dual-write `Refund.amount` therefore cannot over-credit wallets on partial refunds. `WebhookEvent` has no separate `refundedAmount` field. Refund object events do not always include the original charge total; when Stripe includes expanded charge totals (preferring `amount_captured` over `amount`, and `charge.refunded === true` as full), the gateway can distinguish `refunded` from `partially_refunded`, otherwise successful refund object events are normalized as `refund_completed` (dual-write `refund.pending`) to avoid guessing the aggregate payment refund state.

Webhook signature verification uses **bidirectional** 300s tolerance (`Math.abs(now - t) > 300` rejects) — stripe-node parity for both aged and far-future timestamps (STRIPE-4).

`checkout.session.completed` with `payment_status: 'no_payment_required'` and `status: 'complete'` is normalized as:

| Session shape | Domain status |
| --- | --- |
| `mode === 'setup'` **or** a `setup_intent` is present | `setup_completed` |
| `mode === 'subscription'` (trials / $0 first invoice) | `pending` (STRIPE-2 — not fulfillment-ready paid) |
| `mode === 'payment'` ($0 free orders / 100% coupons) | `paid` so fulfillment / `payment.succeeded` dual-write can fire |
| `mode` missing / unrecognized and no `setup_intent` | `pending` (STRIPE-3 fail closed — do not invent paid) |
