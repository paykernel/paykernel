# PayPal Gateway

PayPal uses OAuth 2.0 authentication and the Orders API v2 for processing payments.

## Configuration

```typescript
import { PaymentClient } from '@paykernel/core';

const client = new PaymentClient({
  paypal: {
    // Required: API credentials
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,

    // Optional: Webhook verification (required for production)
    webhookId: process.env.PAYPAL_WEBHOOK_ID,

    // Optional: Environment (default: false = production). Prefer an explicit flag.
    sandbox: process.env.PAYPAL_SANDBOX === 'true',

    // Optional: Request timeout in milliseconds (default: 30000)
    timeoutMs: 30000,
  },
  defaultGateway: 'paypal',
});
```

## Create Payment

> **Order validity**: Uncaptured PayPal checkout orders typically expire after about **3 hours**. Capture (or authorize) promptly after the buyer returns from approval, and do not assume a stale order token remains valid.

```typescript
const result = await client.createPayment({
  amount: 99.99,
  currency: 'USD',
  // Optional when returnUrl is set. Used as fallback for return_url and/or cancel_url.
  callbackUrl: 'https://example.com/callback',

  // PayPal-specific return/cancel (optional when callbackUrl covers both)
  returnUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',

  // Shipping preference (default: NO_SHIPPING). SET_PROVIDED_ADDRESS is rejected
  // until the SDK supports a shipping-address payload on createPayment.
  // paypalShippingPreference: 'NO_SHIPPING' | 'GET_FROM_FILE',

  // Idempotency (strongly recommended; required for safe retries after timeouts)
  idempotencyKey: crypto.randomUUID(),

  // Your internal references
  orderId: 'order_123',
  description: 'Premium Subscription',
  metadata: { paymentId: 'pay_internal_001' },
});

// Redirect customer to PayPal for approval
if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

> **Return / cancel URLs**: At least one of `returnUrl` or `callbackUrl` is required for the success return. Cancel uses `cancelUrl ?? callbackUrl ?? returnUrl`, so **returnUrl-only is valid** (both PayPal `return_url` and `cancel_url` become that URL).

## Capture Payment (After Customer Approval)

For one-time payments, PayPal uses a two-step flow: create order → capture after approval.

> **Important — fulfillment**: Never fulfill on `captureResult.success` alone. Prefer **`isPaidOutcome(captureResult)`** (Phase 6: `outcome === 'succeeded'` **and** paid-like status **`paid` only**). Checking `status === 'paid'` is also fine. **`partially_captured`** (non-final auth capture when `final_capture` is false) has `outcome: 'succeeded'` but **`isPaidOutcome` is false** — do not treat it as full settlement. **Never ship on buyer approval alone** (`status: 'approved'`). PayPal can return HTTP 200 with `status: 'pending'` (echeck / review). For webhooks, only treat **`PAYMENT.CAPTURE.COMPLETED`** as fulfillment when status maps to **`paid`** (resource `final_capture` is not false); non-final completed captures map to `partially_captured` / `payment.processing`. Terminal failures return **`success: false`**.
>
> **Important — refunds**: Persist **`captureResult.captureId`** (also exposed as `gatewayId` after capture). Refunds require the **capture ID**, not the order ID or authorization ID. Passing an order/auth ID yields a clear not-found error.

```typescript
import { isPaidOutcome } from '@paykernel/core';

// Customer returns from PayPal with order ID in query params
const orderId = req.query.token; // PayPal order ID

const captureResult = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: orderId,
});

// Store the capture ID for refunds. For successful PayPal captures,
// result.gatewayId and result.captureId both point to the capture ID.
const captureId = captureResult.captureId;
if (!captureId) throw new Error('PayPal capture ID missing');

// Terminal / API failure: success is false for failed captures (API-ok ≠ paid).
// Do not fulfill on !success alone either — reconcile timeouts separately.
if (!captureResult.success || captureResult.status === 'failed') {
  throw new Error(`PayPal capture failed: ${captureResult.status}`);
}

// Do not ship/fulfill yet if the capture is still pending
if (captureResult.status === 'pending') {
  // Wait for PAYMENT.CAPTURE.COMPLETED (or DENIED/DECLINED) webhook
  await db.payment.update({
    where: { orderId },
    data: { captureId, status: 'pending' },
  });
  return;
}

// Fulfillment gate: paid settlement only via isPaidOutcome (succeeded + paid).
// success:true alone is never enough (pending / approved keep fulfillment closed).
if (!isPaidOutcome(captureResult)) {
  throw new Error(`Unexpected PayPal capture status: ${captureResult.status}`);
}

// Store captureId for future refunds and fulfill only when paid
await db.payment.update({
  where: { orderId },
  data: { captureId, status: 'paid' },
});
```

## Authorize Then Capture Later

Set `capture: false` to create an `AUTHORIZE` intent order. After the customer approves the order, authorize it to place the hold, then capture or void the authorization later.

```typescript
const order = await client.createPayment({
  amount: 99.99,
  currency: 'USD',
  callbackUrl: 'https://example.com/callback',
  capture: false,
});

// After PayPal redirects back with the order ID:
const orderId = req.query.token as string;

const authResult = await client.gateway('paypal').authorizePayment({
  gatewayPaymentId: orderId,
  idempotencyKey: crypto.randomUUID(),
});

// Terminal failures return success: false (same pattern as capturePayment).
// success here means API-ok, not “paid.” Auth holds are status 'authorized' —
// isPaidOutcome(authResult) is false; do not fulfill on authorize alone.
if (!authResult.success || authResult.status === 'failed') {
  throw new Error(`PayPal authorize failed: ${authResult.status}`);
}

const authorizationId = authResult.authorizationId;
if (!authorizationId) throw new Error('PayPal authorization ID missing');

// Partial capture: when `amount` is set, final_capture defaults to **false**
// (PayPal's API default is also false). Set paypalFinalCapture: true only when
// this partial amount should close the authorization.
const captureResult = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: authorizationId,
  amount: 25.00,
  currency: 'USD',
  paypalCaptureType: 'authorization',
  // paypalFinalCapture omitted → false when amount is set
  idempotencyKey: crypto.randomUUID(),
});

// Non-final partial → status partially_captured (NOT paid). isPaidOutcome is false.
// Do not fulfill remaining goods on this result alone.
if (captureResult.status === 'partially_captured') {
  // Optional: ship only the partial slice after your own amount checks.
}
const firstCaptureId = captureResult.captureId;
if (!firstCaptureId) throw new Error('PayPal capture ID missing');

// Final capture from the same authorization (amount set + explicit final)
const finalCapture = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: authorizationId,
  amount: 74.99,
  currency: 'USD',
  paypalCaptureType: 'authorization',
  paypalFinalCapture: true,
  idempotencyKey: crypto.randomUUID(),
});
// final_capture true + COMPLETED → status paid; isPaidOutcome true.

// Or omit `amount` to capture the remaining authorized balance; SDK defaults
// final_capture to **true** for that full remaining capture.
```

## Refunds

> **Important**: PayPal refunds require the **Capture ID**, not the Order ID.
>
> **Success flag**: A failed (or cancelled) refund status returns **`success: false`**. Do not treat `success: true` alone as settled — check `status` (`completed` | `pending` | `failed`). Prefer **`mapGatewayRefundToOperationResult(refundResult)`** / `inferRefundOperationOutcome` when branching on outcome arms. Built-in gateways may omit dual-written `refundResult.outcome` in 0.x (status remains authoritative); when `outcome` is present (or after dual-write parity lands), prefer it over bare `success`.

```typescript
// Full refund
const refundResult = await client.refundPayment({
  gatewayPaymentId: captureId, // Use capture ID!
  idempotencyKey: crypto.randomUUID(),
});

// success is API-ok for non-failed refunds (including pending) — not "settled."
// Prefer status (and outcome / mapGatewayRefundToOperationResult when available).
if (!refundResult.success || refundResult.status === 'failed') {
  throw new Error(`PayPal refund failed: ${refundResult.status}`);
}
// refundResult.status === 'completed' → refund settled; 'pending' → wait/reconcile

// Partial refund (currency required)
await client.refundPayment({
  gatewayPaymentId: captureId,
  amount: 25.00,
  currency: 'USD', // Required for partial refunds
  reason: 'Customer request',
  idempotencyKey: crypto.randomUUID(),
});
```

## Void Payment

Use this to void an authorized payment that hasn't been captured yet.

> **Note**: This only works for payments with `intent: 'AUTHORIZE'`. Once captured, you must use refund.

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: 'AUTHORIZATION-ID', // The authorization ID, NOT the order ID
  idempotencyKey: crypto.randomUUID(),
}, 'paypal');

// success means the void API call completed (API-ok), not payment settlement.
// Prefer status/outcome: voided auth is typically status 'cancelled'.
// isPaidOutcome(result) stays false — never treat void as paid fulfillment.
if (!result.success || result.status === 'failed') {
  throw new Error(`PayPal void failed: ${result.status}`);
}
if (result.status === 'cancelled' || result.outcome === 'succeeded') {
  console.log('Authorization voided successfully');
}
```

## Get Payment Details

Retrieve the current status and details of a PayPal order, capture, or authorization.

> **Capture ID polling**: After `capturePayment`, `result.gatewayId` is the **capture ID**. Looking that ID up via `getPayment` hits `/v2/payments/captures/{id}` when the order path 404s. If the capture is non-final (`final_capture: false`), status is **`partially_captured`** (not `paid`) and **`isPaidOutcome` is false** — same rule as `capturePayment` and webhooks. Multi-capture order lookups **omit** `captureId` unless exactly one refundable capture remains (never dual-write the latest id as a full-order refund target). They **aggregate** still-held capture amounts and demote status when auth is still `PARTIALLY_CAPTURED` or totals are under the order/auth amount. Capture-resource GET after `PARTIALLY_REFUNDED`/`REFUNDED`/`REVERSED` omits face amount unless net remaining can be proven from `seller_receivable_breakdown.total_refunded_amount` (full refund/reversal never publishes original face as still-held).

```typescript
const payment = await client.getPayment({
  // PayPal order ID, capture ID (e.g. capturePayment gatewayId), or authorization ID
  gatewayPaymentId: 'ORDER-123',
}, 'paypal');

console.log(payment.status); // 'pending', 'authorized', 'partially_captured', 'paid', etc.
console.log(payment.amount);
console.log(payment.capturedAmount); // aggregated when multi-capture on order lookup
```

## Webhook Verification

PayPal requires **async verification** via their API. The SDK's `handleWebhook()` automatically uses `verifyWebhookAsync` for PayPal when you pass the webhook headers.

> **`paypal.webhookId` is required** for verification. If it is missing, `verifyWebhookAsync` throws `InvalidRequestError` (`paypal.webhookId is required for webhook verification`) so `handleWebhook` surfaces a config error instead of a generic verification failure.
>
> **Sync `verifyWebhook()` throws** `InvalidRequestError` — always use `verifyWebhookAsync` or `client.handleWebhook`. Do not rely on a boolean return from the sync method.

### Raw body is required for reliable verification

Prefer the **raw request body** as a string, `Buffer`, or `Uint8Array` (same recommendation as Stripe). The SDK embeds those **exact bytes/text** as PayPal's `webhook_event` field **without** parse→stringify reordering and **without trimming** (trailing newlines and original whitespace are preserved). Only a trimmed *copy* is used to validate that the payload is a JSON object. Already-parsed objects are accepted but the SDK warns and re-serializes them — verification may fail.

Frameworks that auto-parse JSON should use a raw-body parser on the webhook route (e.g. `express.raw({ type: 'application/json' })`).

### Other verify guards

- Certificate URLs from `paypal-cert-url` are allowlisted to HTTPS hosts under `*.paypal.com` (including `api.paypal.com`, `api-m.paypal.com`, and sandbox variants) before any verify API call.
- `paypal-transmission-time` must be parseable. **Unparseable** or **far-future** timestamps (beyond the max age window, default **72 hours**) are rejected before calling PayPal. **Aged** transmissions (including late retries after outages) are **soft-accepted**: the SDK warns and still calls PayPal signature verify. Optional config field `webhookMaxAgeMs` adjusts the far-future skew window.
- Deduplicate deliveries with **`event.id`** (PayPal's webhook event id). PayPal may retry the same event for a long time — soft-accepting aged headers relies on your `event.id` dedupe plus PayPal verify.

```typescript
// Prefer raw body so verification embeds the original JSON bytes PayPal signed.
app.post('/webhooks/paypal', async (req) => {
  const rawBody = req.rawBody ?? req.body; // string | Buffer | Uint8Array | object

  let event;
  try {
    event = await client.handleWebhook('paypal', rawBody, {
      'paypal-transmission-id': req.headers['paypal-transmission-id'],
      'paypal-transmission-time': req.headers['paypal-transmission-time'],
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
      'paypal-cert-url': req.headers['paypal-cert-url'],
      'paypal-auth-algo': req.headers['paypal-auth-algo'],
    });
  } catch (error) {
    // Return a 5xx for transient PayPal verification/API failures so PayPal retries.
    // Return 4xx only for genuinely invalid webhooks.
    throw error;
  }

  // Deduplicate with event.id before fulfilling
  // await db.webhookEvent.create({ data: { id: event.id } }).catch(ignoreDuplicate)

  // Fulfill only when status is paid (or the specific lifecycle status you handle).
  // Do not treat verification success alone as a paid capture.
  console.log(event.id);              // PayPal webhook event id — use for idempotent handling
  console.log(event.status);          // 'paid', 'pending', 'refunded', 'refund_pending', etc.
  console.log(event.paymentId);       // Your custom_id, or purchase unit reference_id fallback
  console.log(event.gatewayPaymentId); // Capture ID when PayPal provides one; otherwise the emitted resource ID
  console.log(event.amount);          // Undefined for PayPal events that do not include amount data

  return { received: true };
});
```

## Important Notes

| Topic | Note |
|-------|------|
| **Sandbox flag (`PAYPAL_SANDBOX`)** | Use `sandbox: process.env.PAYPAL_SANDBOX === 'true'` (explicit). Do not infer sandbox solely from `NODE_ENV`. |
| **Order validity** | Checkout orders generally remain valid for about **3 hours** after creation; capture/authorize before they expire. |
| **Capture ID for refunds** | Store **`captureId`** from `capturePayment()` — refunds **must** use the capture ID, never the order ID or authorization ID. |
| **Capture result ID** | After capture, `result.gatewayId` is the PayPal capture ID. The original PayPal order is available as `result.orderId`. |
| **Multiple captures** | **`amount` / `capturedAmount` / `event.amount` sum still-held captures** (COMPLETED / non-final partial) — **not** last-slice only, and **not** fully **REFUNDED** face amounts. **`captureId` is set only when exactly one refundable capture remains**; with two or more refundable captures, `captureId` is **omitted** so callers cannot treat one id as a full-order refund target. Multi-capture **order** webhooks use the **order id** as `gatewayPaymentId` (not the latest capture). Refund each capture separately via its capture id from `capturePayment()`. Status is **`partially_captured`** when authorization is `PARTIALLY_CAPTURED`, when `final_capture` is false, or when held capture totals are strictly less than order/auth amount. Sibling **REFUNDED** / **PARTIALLY_REFUNDED** captures demote status to **`partially_refunded`** or **`refunded`** (never latest-COMPLETED → false `paid`). |
| **Capture fulfillment** | Never fulfill on `success: true` alone. Prefer **`isPaidOutcome(result)`** (`outcome === 'succeeded'` + paid-like **`paid` only**) or require **`status === 'paid'`**. **`partially_captured`** (non-final auth capture / non-final `CAPTURE.COMPLETED`) is operation-succeeded but **`isPaidOutcome` is false** — do not ship remaining goods. Buyer `approved` is **not** paid. Pending captures return `success: true` + `status: 'pending'`. Prefer **final** **`PAYMENT.CAPTURE.COMPLETED`** (`final_capture !== false`, status `paid`) or poll until `paid`. |
| **Shipping preference** | Default `shipping_preference` is **`NO_SHIPPING`**. Optional `paypalShippingPreference`: `NO_SHIPPING` \| `GET_FROM_FILE`. **`SET_PROVIDED_ADDRESS` is rejected** until shipping-address params exist on create. |
| **Field length limits** | Client-enforced: `description` ≤ 127, `orderId` (reference_id) ≤ 256, `metadata.paymentId` (custom_id) ≤ 127, refund `reason` (note_to_payer) ≤ 255. |
| **Return / cancel URLs** | Create requires `returnUrl` or `callbackUrl`. Cancel is `cancelUrl ?? callbackUrl ?? returnUrl` — **returnUrl-only is OK** (both URLs use returnUrl). |
| **Authorize / refund success** | Like capture: terminal **failed** statuses return **`success: false`** (refund cancelled and **unmapped** refund statuses map to failed — fail-closed). Pending/completed keep `success: true`. |
| **Webhook raw body** | **Required for reliable verify**: pass the unparsed body (string / `Buffer` / `Uint8Array`) to `handleWebhook` / `verifyWebhookAsync`. The SDK embeds those **exact** JSON bytes as `webhook_event` (no re-serialization, no trim). Parsed objects are accepted but may fail signature verification. |
| **Webhook sync path** | `verifyWebhook()` (sync) always throws `InvalidRequestError`. Use `verifyWebhookAsync` or `client.handleWebhook`. |
| **Webhook transmission age** | Soft path: aged `paypal-transmission-time` still calls PayPal verify (warn). Unparseable or far-future (default skew window **72h**, optional `webhookMaxAgeMs`) rejected before verify. Dedupe with `event.id`. |
| **Webhook event dedupe** | Use **`event.id`** to dedupe PayPal deliveries; the same event may be retried. |
| **Webhook cert URL** | `paypal-cert-url` must be HTTPS on a `*.paypal.com` host; other URLs are rejected before calling PayPal. |
| **Authorization ID** | Store the authorization ID from `authorizePayment()` for voids or delayed captures |
| **AUTHORIZATION webhooks** | `PAYMENT.AUTHORIZATION.CAPTURED` maps domain status to `paid`. If PayPal does not include a capture id, `gatewayPaymentId` is the **authorization id** — **not** refundable — and dual-write is **`payment.succeeded`** (not `capture.completed`, which would imply a capture resource). Prefer capture webhooks / stored `captureId` for refunds. |
| **Status lookup IDs** | `getPayment()` and `getPaymentStatus()` accept PayPal order IDs, capture IDs, and authorization IDs, so the `gatewayId` returned from create, authorize, or capture can be checked later. Capture-resource lookup applies the same **`final_capture: false` → `partially_captured`** demotion as capture/webhook paths (do not fulfill remaining auth on re-poll). |
| **Authorization captures** | `capturePayment()` only accepts `amount` with `paypalCaptureType: 'authorization'` |
| **Authorize params** | `authorizePayment()` only accepts `gatewayPaymentId` and `idempotencyKey`; capture-only fields are rejected. |
| **Final capture** | PayPal API default for `final_capture` is `false`. SDK product defaults: **no amount** (full remaining) → `true`; **amount set** (partial) → `false` unless `paypalFinalCapture === true`. When the capture is non-final (`final_capture: false`), result/webhook status is **`partially_captured`**, not `paid`. |
| **Payment preference** | Create-order requests set PayPal wallet `payment_method_preference` to `IMMEDIATE_PAYMENT_REQUIRED`, matching PayPal's current direct Orders API examples. |
| **Currency** | Required for partial refunds and partial authorization captures; optional for full refunds |
| **Zero-decimal currencies** | `JPY`, `HUF`, and `TWD` amounts must be whole numbers |
| **Webhook ID** | Configure in PayPal Developer Dashboard → Webhooks |
| **Webhook reference** | `event.paymentId` uses PayPal `custom_id` when available and falls back to the purchase unit `reference_id` that the SDK sends from `orderId`. |
| **Webhook scope** | The SDK normalizes current checkout/order, authorization, capture, and refund lifecycle events (`PAYMENT.REFUND.PENDING` / `COMPLETED` / `FAILED`, plus `PAYMENT.CAPTURE.REFUNDED`). Refund **resource** lifecycle statuses use `refund_pending` / **`refund_completed`** / `refund_failed` (op-level — not proven full capture refund). Aggregate completeness uses `PAYMENT.CAPTURE.REFUNDED` / `getPayment`. Unsupported PayPal events are rejected instead of being guessed as `pending` with a fake amount. |
| **Webhook amounts** | `event.amount` and `event.currency` are present only when PayPal includes amount data. On multi-capture **order** webhooks, `event.amount` is the **sum of still-held captures** (aligned with `getPayment`; excludes fully REFUNDED face amounts), not the last capture slice. Single-resource **`PAYMENT.CAPTURE.REFUNDED`** / **`PAYMENT.CAPTURE.REVERSED`** publish **remaining held** (or **0** when fully refunded/reversed), never the original capture face; partial refunds without a net remaining breakdown omit amount. `PAYMENT.REFUND.*` resources keep the refund op amount. `CHECKOUT.PAYMENT-APPROVAL.REVERSED` does not include amount data in PayPal's documented payload, so those fields are undefined. |
| **Refund webhook IDs** | For refund lifecycle webhooks, `event.gatewayPaymentId` is the related capture ID when PayPal includes it in `supplementary_data.related_ids.capture_id` or a `rel: "up"` capture link; `event.gatewayObjectId` is the refund ID. Refund resource `custom_id` is not treated as the original payment ID. |
| **Reversals** | `PAYMENT.CAPTURE.REVERSED` maps to `reversed`, not `refunded`, because reversals can represent chargebacks or other non-merchant refund flows. `event.amount` is **0** remaining (with currency), not the original capture face. |
| **Webhook retries** | If PayPal's verification API is unavailable, the SDK throws instead of treating the webhook as invalid. Return a retryable HTTP status from your webhook route. |
| **Idempotency** | **Prefer always setting** a stable UUID `idempotencyKey` on create, capture, refund, and void. When omitted the SDK generates an ephemeral `PayPal-Request-Id` and **warns** — app-level retries after crash/timeout can double-mutate. Orders API: ≤108 chars; Payments v2: wider limit. |
| **Token Caching** | Access tokens are cached and refreshed automatically |
| **Retry Logic** | Transient errors (5xx, rate limits, network failures, and PayPal `PREVIOUS_REQUEST_IN_PROGRESS` 409 conflicts) retry with exponential backoff; `Retry-After` is honored when PayPal sends it. |
| **Response validation** | PayPal success responses must include the expected order ID, approval link, capture ID, authorization ID, or refund ID. Missing fields throw a gateway error. |

## PayPal Webhook Events

| Event Type | Mapped Status |
|------------|---------------|
| `PAYMENT.CAPTURE.COMPLETED` | `paid` when `final_capture !== false` (**preferred fulfillment signal**); **`partially_captured`** when resource `final_capture: false` (stable dual-write **`payment.processing`**, not `capture.completed`) |
| `PAYMENT.CAPTURE.DENIED` | `failed` |
| `PAYMENT.CAPTURE.DECLINED` | `failed` |
| `PAYMENT.CAPTURE.PENDING` | `pending` |
| `PAYMENT.CAPTURE.REFUNDED` | `refunded` or `partially_refunded` based on PayPal capture status |
| `PAYMENT.CAPTURE.REVERSED` | `reversed` |
| `CHECKOUT.ORDER.APPROVED` | `approved` (stable type `payment.processing` — **not** paid; do not fulfill) |
| `CHECKOUT.ORDER.COMPLETED` | `paid` only when capture(s) fully settle the order/auth total; **`partially_captured`** when nested captures are under-total, auth is `PARTIALLY_CAPTURED`, or a capture is non-final (`final_capture: false`) — dual-write **`payment.processing`**, not `payment.succeeded`. No capture → `approved` |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | `cancelled` |
| `PAYMENT.AUTHORIZATION.CREATED` | `authorized` |
| `PAYMENT.AUTHORIZATION.CAPTURED` | `paid` (auth id is not refundable when capture id missing — dual-write `payment.succeeded`, not `capture.completed`) |
| `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` | `partially_captured` (stable dual-write **`payment.processing`** — not `capture.completed` / `payment.succeeded`; do not fulfill remaining auth) |
| `PAYMENT.AUTHORIZATION.VOIDED` | `cancelled` |
| `PAYMENT.REFUND.PENDING` | `refund_pending` |
| `PAYMENT.REFUND.COMPLETED` | **`refund_completed`** (this refund op finished; not proven full capture refund — fail-closed vs overstated `refunded`; stable dual-write `refund.completed`). Use `PAYMENT.CAPTURE.REFUNDED` resource status / `getPayment` for aggregate completeness |
| `PAYMENT.REFUND.FAILED` | `refund_failed` |

> **Partial authorization / non-final capture:** Both
> `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` and `PAYMENT.CAPTURE.COMPLETED` with
> `final_capture: false` normalize to **`partially_captured`** and dual-write stable
> type **`payment.processing`** (not `capture.completed` / `payment.succeeded`).
> `isPaidOutcome` is false. Type-only fulfillment must not treat a partial take as full
> settlement — require **`status === 'paid'`** / **`isPaidOutcome`**, capture remaining
> funds, or wait for a final capture (`final_capture: true` / auth `CAPTURED`) and amount checks.
