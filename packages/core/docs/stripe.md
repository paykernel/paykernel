# Stripe Gateway

The Stripe gateway supports PaymentIntents, hosted Checkout Sessions, manual capture, refunds, void/cancel, payment lookup, and signed webhooks.

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

Stripe webhook verification fails closed when `webhookSecret` is missing.

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

const session = await stripe.createCheckoutSession({
    mode: 'payment',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    metadata: { paymentId: 'order_1234' },
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

// Redirect the customer to session.url
```

For a simple one-item payment, you can provide `amount` and `currency` instead of `lineItems`.
Both simple-session `amount` and line-item major-unit `priceData.amount` accept
`AmountInput` (`number | Money`); prefer `money("100.00", "USD")`.

```typescript
const session = await stripe.createCheckoutSession({
    amount: money('100.00', 'USD'),
    currency: 'USD',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
});
```

If you already store Stripe minor-unit amounts, `priceData.unitAmount` is also supported and is sent directly to Stripe as `unit_amount`. The gateway still runs the **same minor-unit validations** as converted amounts (no skipped money rules on the escape hatch): three-decimal currencies must be divisible by 10, **ISK/UGX (and other whole-unit specials with positive exponent) must be whole major units** (minor divisible by `10^exponent`, e.g. ISK `1000` ok / `1050` rejected), and charge maximums are enforced without re-scaling. **Major-unit `priceData.amount` enforces the same rules** via the shared post-scale path.
Checkout line-item `priceData.amount` and `priceData.unitAmount` can be zero when Stripe accepts a zero-priced item, such as free trials or fully discounted subscription setup.

### Subscriptions

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    lineItems: [
        {
            price: 'price_123456789',
            quantity: 1,
        },
    ],
});
```

Inline `priceData` in subscription mode must include Stripe recurring price settings.

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
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
```

### Setup Mode

Use setup mode to save a payment method without an immediate charge.

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'setup',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    currency: 'USD',
    customerId: 'cus_123456789',
});
```

`cancelUrl` is optional because Stripe's `cancel_url` parameter is optional. Provide it when you want Stripe-hosted cancellation to return customers to a specific page.
Setup mode requires either `currency` or `paymentMethodTypes`, and does not accept `lineItems` or `amount`. Payment and subscription Checkout Sessions must use either `lineItems` or the simple `amount`/`currency` form, not both.
The SDK validates Stripe's Checkout line item caps: payment mode accepts up to 100 line items, and subscription mode accepts up to 40 total line items with at most 20 known recurring inline price items. Existing `price_...` IDs are accepted but their recurring/one-time type is ultimately validated by Stripe.
Unsupported Checkout fields are rejected instead of silently ignored. Add SDK support before relying on additional Stripe Checkout Session create parameters.

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

> **Refund / capture / void IDs:** money mutations require a PaymentIntent ID (`pi_...`). Checkout Session IDs (`cs_...`) and Subscription IDs (`sub_...`) are rejected. Resolve the related PaymentIntent first (for example via `getCheckoutSession({ sessionId })` → `paymentIntentId`, or from an invoice money webhook's `gatewayPaymentId` when it is a `pi_...`).

Stripe-supported reasons (`duplicate`, `fraudulent`, `requested_by_customer`) are sent to Stripe as `reason`. Other custom reason strings are attached as `metadata.reason`. Caller-provided refund metadata is forwarded to Stripe and is useful for binding refund webhooks back to your own transaction or order records.

When passing a partial refund `amount`, `currency` is **required** and **must match the PaymentIntent currency**. The gateway GETs the PaymentIntent before converting majors and rejects a mismatch — never convert with a caller-only currency that differs from the PI. Omit `amount` for a full refund. After creating the refund, the gateway asks Stripe for refunds on the PaymentIntent so `totalRefunded` reflects cumulative succeeded refunds. Pending or action-required refunds are not counted until Stripe marks them succeeded. The refund create expands `charge`; if the follow-up refunds list fails after Stripe has already accepted the refund, `totalRefunded` falls back to expanded `charge.amount_refunded` when present, otherwise it is left undefined rather than inventing a single-refund cumulative total or defaulting currency to USD.

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
const session = await stripe.getCheckoutSession({
    sessionId: 'cs_test_...',
});

// session.sessionId, session.url, session.status, session.paymentStatus
// session.paymentIntentId — use this pi_... for refund/capture/void
// session.amount, session.currency (when Stripe includes amount_total)
```

Signature: `getCheckoutSession(params: { sessionId: string })`. The ID must match Stripe's `cs_...` form. The gateway expands `payment_intent` so `paymentIntentId` is available when the session created one.

### `getPayment` status and amount derivation

`getPayment` expands `latest_charge` and derives status as follows (for `succeeded` PaymentIntents):

1. **Charge snapshot**: prefer an expanded `latest_charge` object. When Stripe returns `latest_charge` as an **unexpanded string ID**, the gateway re-fetches `GET /charges/{id}` for `amount_refunded` / `amount_captured`. If that re-fetch fails, status is **`processing`** (fail closed) — never map `succeeded` + unobservable refunds as `paid` (Stripe keeps PaymentIntent status `succeeded` after refunds).
2. **Refunds first** (override capture state): if `latest_charge.amount_refunded > 0`, refund completeness is measured against the **captured base**, not the original authorization:
   - captured base = `amount_received` (if finite) → else `latest_charge.amount_captured` (if finite). **No fallback to authorized PaymentIntent `amount`** (STRIPE-4) — that would claim full `refunded` against the auth total after a partial capture.
   - status is `refunded` when the captured base is known, `capturedBase > 0`, and `amount_refunded >= capturedBase`; otherwise `partially_refunded` (including when captured fields are missing — fail closed).
3. **Partial capture**: if not refunded, settled amount is `amount_received` (if finite) → else `latest_charge.amount_captured` (if finite). When settled is known and `< amount`, status is `partially_captured`. Settled does **not** fall back to authorized `amount` (that would hide partial captures).
4. **Incomplete money snapshot**: if not refunded and settled amount is missing, status is **`processing`** (fail closed) — never map missing settled fields to full `paid`.
5. Otherwise the Stripe PaymentIntent status is mapped (`succeeded` → `paid`, `requires_capture` → `authorized`, etc.). Unmapped PaymentIntent statuses fail closed as `failed` (with a logger warning) so unknown states are not treated as pending fulfillment.

**Amount** prefers settled money when available: for succeeded intents, `amount_received` → `amount_captured` when finite; otherwise authorized `amount`. So `payment.amount` reflects the captured total after partial capture when Stripe includes settled fields. Amount conversion is omitted when currency is missing (never silently defaults to USD).

> **Hard invariant — PaymentIntent IDs for money mutations:** `capturePayment`, `refundPayment`, and `voidPayment` **require** a Stripe PaymentIntent ID (`pi_...`). Subscription and invoice webhooks may set `gatewayPaymentId` to a `sub_...` (or other non-PI) ID. **Do not** pass those IDs into refund/capture/void — resolve the related PaymentIntent first (for example from the invoice or charge), then mutate that `pi_...`.

## Idempotency

Stripe mutations (`createPayment`, `capturePayment`, `refundPayment`, `voidPayment`, `createCheckoutSession`) always send an `Idempotency-Key`. When you **omit** `idempotencyKey` (leave the field undefined), the SDK generates a `crypto.randomUUID()` so in-process retries of transient network/5xx errors are safe against double-charges. **Do not pass an empty or whitespace-only key** — validation rejects those with `InvalidRequestError` / schema failure (STRIPE-6). Supply your own stable UUID when you need app-level crash/retry safety across processes (the auto-generated key is only known for the lifetime of that single call).

## Checkout customer identity

Pass either `customerId` **or** `customerEmail`, not both. Stripe Checkout rejects combining an existing Customer with a guest email; the SDK fails the request early with `InvalidRequestError`.

## Webhooks

**Prefer `client.handleWebhook('stripe', rawBody, signature)`** over calling `verifyWebhook` and `parseWebhookEvent` yourself. `handleWebhook` verifies the signature, then parses, and runs webhook hooks. `parseWebhookEvent` alone does **not** verify authenticity — never fulfill from an unverified parse.

Pass the exact raw request body string or `Buffer`. Do not pass a parsed JSON object; Stripe signs the original byte stream and verification will fail if the body is changed. Buffer payloads are verified from their original bytes.
`parseWebhookEvent` expects Stripe snapshot event payloads that include `data.object`. If you configure Stripe thin events, retrieve or hydrate the related Stripe object first, then pass a snapshot-shaped payload to the parser.
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

Subscription-related webhooks are normalized for common billing flows. `checkout.session.completed` in subscription mode prefers the `sub_...` ID over `payment_intent` when both are present, invoice payment success/failure events map to `paid` or `failed`, and subscription deletion maps to `cancelled`. Invoice metadata can also use `parent.subscription_details.metadata.paymentId` when the invoice itself does not carry `metadata.paymentId`.

Unhandled / unknown event types do **not** run non-`payment_intent` object statuses through the PaymentIntent status map (which fails closed as `failed` for unmapped PI states). Foreign statuses such as subscription/tax `active` on an unmapped event type normalize as `pending`.

### Subscription status mapping

| Stripe subscription `status` | SDK `PaymentStatus` |
| --- | --- |
| `active` | `processing` (not `paid` — lifecycle only; STRIPE-1) |
| `trialing` | `pending` |
| `past_due`, `incomplete`, `paused`, `unpaid` | `pending` |
| `canceled`, `incomplete_expired` | `cancelled` |
| other / unknown | `pending` |

Only `canceled` and `incomplete_expired` map to `cancelled`. **`active` maps to `processing`**, not `paid` — a live subscription is not a settled one-shot charge; fulfill from invoice/PI money events (or Checkout paid) instead of subscription status alone. **`unpaid` maps to `pending`** (not cancelled) so callers can still collect or reactivate. **`trialing` maps to `pending`** (not paid) because no collection has succeeded yet. Note: a Checkout Session with `payment_status: paid` for a $0 trial can still normalize as `paid` via the `checkout.session.completed` path.

> **Warning (STRIPE-5):** subscription lifecycle webhooks and **subscription-mode Checkout** paid events often set `gatewayPaymentId` to `sub_...` (not `pi_...`) and dual-write `provider.unmapped` for pure lifecycle events. Refund/capture/void **require** a `pi_...` PaymentIntent ID and fail closed with `InvalidRequestError` on `sub_*` / `cs_*`. Prefer invoice money events that surface a PaymentIntent, or resolve the PI via `getCheckoutSession` / Stripe before money mutations. Do not pass `cs_...` or `sub_...` into refund/capture/void. **Never fulfill inventory on subscription domain status alone.**

For `payment_intent.succeeded` (and other succeeded PaymentIntent payloads), webhook `amount` prefers settled money: `amount_received` → `latest_charge.amount_captured` / `charges.data[0].amount_captured` so partial captures report the settled total. When settled is finite and less than authorized `amount`, status is `partially_captured` (not `paid`). When settled fields are **missing**, status is **`processing`** (fail closed) — never map an incomplete snapshot to full `paid` / over-fulfill on auth amount alone. **Phase 7 dual-write** for both the **partial** (`partially_captured`) and **incomplete-settled** (`processing`) cases sets `stableType` / `event.type` to **`payment.processing`**, not `payment.succeeded` — aligned with Paymob and with `isPaidOutcome` (neither partial nor incomplete settled is paid-like). Full success (status `paid`) dual-writes `payment.succeeded`. Fulfill only when status is `paid` or `isPaidOutcome(...)` is true; do not ship on type-only `payment.succeeded` handlers without checking status. Amount is only set from real money fields on the event object; it is not defaulted to `0` when Stripe omits amount data. Currency is only set when Stripe includes it — missing currency is left undefined rather than defaulted to `USD`. **Amount conversion is also skipped when currency is missing** (invoice/checkout and any incomplete snapshot): the gateway never invents a USD exponent to scale minor units, because that mis-scales zero-decimal and three-decimal currencies.

`createPayment` / `capturePayment` / `getPayment` / `voidPayment` use the same settled-amount fail-closed rule when the PaymentIntent is `succeeded`: missing `amount_received` / `amount_captured` → domain status `processing` and outcome `requires_action` (not full `paid` / `succeeded`). Partial capture domain status is also outcome `requires_action` (open money), not operation-succeeded. **STRIPE-1:** PaymentIntent results always publish ISO `currency` together with major-unit `amount` / `refundedAmount` (never naked major units). When currency is missing, amount-like fields are omitted.

Refund webhooks handle both modern `refund.created` / `refund.updated` / `refund.failed` events and legacy `charge.refund.updated`. `charge.refunded` can represent either a full or partial refund. Completeness uses the **captured** charge total (`amount_captured` when present, else `amount`), and `charge.refunded === true` is treated as a full refund when available. When `refunded !== true` and `amount_refunded` is missing/non-finite **or zero**, status is **`refund_completed`** (not fail-open `refunded` and not invented `partially_refunded`) so incomplete snapshots do not claim refund completeness. **STRIPE-2:** incomplete `refund_completed` snapshots dual-write Phase 7 **`refund.pending`** (not `refund.completed`) — Paymob parity so type-only handlers do not over-settle. Proven `refunded` / `partially_refunded` dual-write `refund.completed`. **STRIPE-3:** webhook `amount` on `charge.refunded` is cumulative **`amount_refunded`** (the money moved by refunds), not the charge/captured payment total; when refund money is incomplete the amount is **omitted**. Dual-write `Refund.amount` therefore cannot over-credit wallets on partial refunds. `WebhookEvent` has no separate `refundedAmount` field. Refund object events do not always include the original charge total; when Stripe includes expanded charge totals (preferring `amount_captured` over `amount`, and `charge.refunded === true` as full), the gateway can distinguish `refunded` from `partially_refunded`, otherwise successful refund object events are normalized as `refund_completed` (dual-write `refund.pending`) to avoid guessing the aggregate payment refund state.

Webhook signature verification uses **bidirectional** 300s tolerance (`Math.abs(now - t) > 300` rejects) — stripe-node parity for both aged and far-future timestamps (STRIPE-4).

`checkout.session.completed` with `payment_status: 'no_payment_required'` and `status: 'complete'` is normalized as:

| Session shape | Domain status |
| --- | --- |
| `mode === 'setup'` **or** a `setup_intent` is present | `setup_completed` |
| `mode === 'subscription'` (trials / $0 first invoice) | `pending` (STRIPE-2 — not fulfillment-ready paid) |
| `mode === 'payment'` ($0 free orders / 100% coupons) | `paid` so fulfillment / `payment.succeeded` dual-write can fire |
| `mode` missing / unrecognized and no `setup_intent` | `pending` (STRIPE-3 fail closed — do not invent paid) |
