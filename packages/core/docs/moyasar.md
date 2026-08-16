# Moyasar Gateway

Moyasar is a Saudi payment gateway supporting credit cards, Apple Pay, Samsung Pay, and STC Pay.

## Configuration

```typescript
import { PaymentClient } from '@paykernel/core';

const client = new PaymentClient({
  moyasar: {
    // Required: API secret key (sk_test_… for test, sk_live_… for live)
    secretKey: process.env.MOYASAR_SECRET_KEY!,

    // Optional: Webhook verification
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,

    // Optional: API timeout in milliseconds (default: 30000)
    timeoutMs: 30000,

    // Required at runtime for capture/refund/void/confirmStcPayOtp (throws if omitted)
    // Prefer a shared store with atomic reserve() in production.
    // idempotencyStore: sharedStoreWithAtomicReserve,

    // sandbox is ignored — Moyasar test/live is determined by the key prefix only
  },
  defaultGateway: 'moyasar',
});
```

> **Sandbox flag**: `MoyasarConfig.sandbox` is deprecated and ignored. Use a
> `sk_test_…` key for test mode or a `sk_live_…` key for production.
>
> **Mutations require a store**: Capture, refund, void, and `confirmStcPayOtp`
> have **no** native Moyasar idempotency. `idempotencyStore` (with atomic
> `reserve()`) is **required at runtime** for those methods — omitting it throws
> `InvalidRequestError`. Pass `idempotencyKey` on each mutation. Prefer a shared
> store in multi-worker production. See
> [Idempotency for refunds, captures, and voids](#idempotency-for-refunds-captures-and-voids).

## Payment Sources

Backend-safe `moyasarSource` types (raw `creditcard` PAN/CVC is **not** accepted):

| Source Type | Use Case | Key Fields |
|-------------|----------|------------|
| `token` | Moyasar.js tokenized card | `token`, `cvc?`, `_3ds?`, `manualCapture?` |
| `stcpay` | STC Pay mobile wallet | `mobile`, `cashier?`, `branch?` |
| `applepay` | Apple Pay | `token`, `saveCard?`, `manualCapture?` |
| `samsungpay` | Samsung Pay | `token`, `saveCard?`, `manualCapture?` |

> **Card data safety**: This backend SDK never accepts raw `creditcard` sources (PAN, expiry, CVC). Moyasar requires cardholder data to go directly to Moyasar via Moyasar.js tokenization, Apple Pay, Samsung Pay, or STC Pay. A `type: 'creditcard'` source is rejected with `InvalidRequestError` before any HTTP request. The TypeScript `MoyasarPaymentSource` union still includes `CreditCardSource` for Moyasar.js / PCI-compliant client collection; generic `CreatePaymentParams.moyasarSource` must not be treated as accepting raw cards at runtime. Prefer `MoyasarCreatePaymentParams` / `MoyasarBackendPaymentSource` for backend create.

### Token Payment (Moyasar.js)

```typescript
import type { CardTokenSource } from '@paykernel/core';

const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  orderId: 'order_123',
  callbackUrl: 'https://example.com/callback', // Required for token sources
  moyasarSource: {
    type: 'token',
    token: 'token_abc123xyz', // From Moyasar.js
  } satisfies CardTokenSource,
  metadata: { customerId: 'customer_456' },
});

// success:true includes initiated/pending payments — always check status.
if (result.status === 'failed') {
  // Do not mark the order paid (success is also false for failed/abandoned).
} else if (result.redirectUrl) {
  // 3DS required — do not fulfill yet; see Callback / 3DS return below.
  redirect(result.redirectUrl);
} else if (result.status === 'paid') {
  // Safe to fulfill only after you also verify amount/currency against the order.
} else if (result.status === 'authorized') {
  // Auth-only hold — capture later; do not ship as paid unless that is intentional.
} else {
  // pending (initiated) or other non-terminal — wait for 3DS/OTP/webhook.
}
```

### STC Pay Payment

STC Pay uses a mobile OTP verification flow. Manual / authorize-only capture is
**not** supported — `capture: false` or `manualCapture: true` is rejected with
`InvalidRequestError` (same fail-closed pattern as decrypted Apple Pay DPAN).

```typescript
import type { StcPaySource } from '@paykernel/core';

// Pass 'moyasar' (or use client.gateway('moyasar')) so optional callbackUrl
// and Moyasar-only fields type-check against MoyasarCreatePaymentParams.
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  // callbackUrl optional for STC Pay
  moyasarSource: {
    type: 'stcpay',
    mobile: '0512345678', // Saudi mobile number (see formats below)
    cashier: 'POS-001',   // Optional: shown in dashboard
    branch: 'Riyadh',     // Optional: shown in dashboard
  } satisfies StcPaySource,
}, 'moyasar');

// STC Pay requires collecting the SMS OTP and posting it to Moyasar.
// nextAction is typed as unknown — narrow with a cast (or a type guard).
const nextAction = result.nextAction as
  | { type: 'stcpay_otp'; transactionUrl: string }
  | undefined;
if (nextAction?.type === 'stcpay_otp') {
  showOtpForm(nextAction.transactionUrl);
}
```

> **Mobile number formats** (Saudi):
> - Local: `05xxxxxxxx` (10 digits, leading `0`)
> - E.164: `+9665xxxxxxxx`
> - International without `+`: `9665xxxxxxxx` or `009665xxxxxxxx`
>
> Pass the number as a string exactly as Moyasar documents; the SDK does not reformat it.
>
> **Important**: STC Pay's `transactionUrl` is an OTP submission endpoint, not a browser redirect URL. The SDK exposes it only through `nextAction`.

### Confirm STC Pay OTP

```typescript
const moyasar = client.gateway('moyasar');

const confirmed = await moyasar.confirmStcPayOtp({
  transactionUrl: stcTransactionUrl, // result.nextAction.transactionUrl
  otpValue: '123456',
  idempotencyKey: 'stc-otp-order-123',
});

if (confirmed.status === 'paid') {
  // Mark the order paid after verifying amount/currency against your order.
}
```

### Apple Pay / Samsung Pay

```typescript
import type { ApplePaySource, SamsungPaySource } from '@paykernel/core';

// Apple Pay (encrypted token — supports manualCapture / capture: false)
const appleResult = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'applepay',
    token: 'encrypted_token_from_apple_pay_js',
    saveCard: true, // Optional: save for future use
  } satisfies ApplePaySource,
});

// Samsung Pay
const samsungResult = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'samsungpay',
    token: 'encrypted_token_from_samsung_pay',
  } satisfies SamsungPaySource,
});
```

> **Decrypted Apple Pay (DPAN)**: When you pass a decrypted DPAN source
> (`dpan`, `cryptogram`, `deviceId`, …), Moyasar's API has no `manual` field.
> This SDK **rejects** `capture: false` for DPAN sources with
> `InvalidRequestError`. Use an encrypted Apple Pay `token` source for
> authorize-only payments.

### Legacy Token Compatibility

The `tokenId` field is still supported for backwards compatibility:

```typescript
// Legacy approach (still works)
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  tokenId: 'token_abc123xyz', // Converted to moyasarSource internally
});
```

## Important Notes

| Topic | Note |
|-------|------|
| **3DS Flow** | Card payments may return `redirectUrl` for 3DS verification. Moyasar `3ds_auth_error` maps to `CardDeclinedError` (not `AuthenticationError`) |
| **STC Pay OTP** | STC Pay returns `nextAction.type === 'stcpay_otp'` with the OTP confirmation URL |
| **Token Format** | Tokens must start with `token_` |
| **Amount** | Provide amount in major currency units (e.g. `100` for 100.00 SAR); the SDK converts to the currency's smallest unit |
| **Splits** | `splits[].amount` is also in major units (same as top-level `amount`); the SDK converts each split to minor units for the API. Pass gateway `'moyasar'` on `createPayment` when using `splits` |
| **Metadata** | Moyasar metadata supports up to 30 string key/value pairs; keys are limited to 40 characters and values to 500 characters |
| **Order Correlation** | `orderId` is copied into `metadata.orderId` and `metadata.paymentId` unless you set those metadata keys yourself |
| **Idempotency (create)** | Use `idempotencyKey` as a UUID; Moyasar uses it as the created payment ID (`given_id`) |
| **Idempotency (mutations)** | Capture/refund/void/`confirmStcPayOtp` have **no** native Moyasar idempotency and are **not** auto-retried by the SDK (`withRetry`). Configure `idempotencyStore` (shared across workers) and pass `idempotencyKey` so **your** retries are safe — required for multi-worker refund / OTP safety |
| **Payment IDs** | Moyasar payment operation IDs are UUIDs; `getPayment`, `capturePayment`, `refundPayment`, and `voidPayment` reject non-UUID IDs before calling Moyasar |
| **Failed Attempts** | Moyasar can return HTTP 201 with `status: 'failed'` (or `abandoned`); this SDK returns `success: false` and `status: 'failed'` for those payment objects |
| **Create 2xx without id** | HTTP 200 `{}` / missing `payment.id` is **not** declined/`failed`. Create is unfenced — the SDK returns `outcome: 'indeterminate'` + `reconciliationRequired` so callers reconcile via `given_id` / `getPayment` instead of minting a new idempotency key |
| **`success` vs status** | `success: true` only means the payment did not map to `failed` (provider `failed`/`abandoned`, or an **unmapped** status). An `initiated` payment returns `success: true` with `status: 'pending'`. **Fulfill only when `status` is `paid`** (or `authorized` for intentional auth-only holds). Complete 3DS/OTP first when required |
| **AFT (account funding)** | Optional `recipient` and `sender` on create are Moyasar Account Funding Transaction (AFT) fields. They require AFT-enabled account capability from Moyasar; omit them for ordinary payments |
| **Callback / 3DS return** | After the customer returns to `callback_url`, **never trust query-string status alone**. Always `getPayment` (or a verified webhook), then verify `amount` and `currency` against your order. Prefer webhooks as the source of truth |
| **Manual Capture** | Set `capture: false` or `manualCapture: true` for auth-only (capture later). Not supported for decrypted Apple Pay (DPAN) or STC Pay sources |
| **Capture window** | Capture before the issuer auth hold expires. **mada** authorizations are typically capturable for up to **14 days**; other schemes follow issuer rules. If the hold lapses, Moyasar may still report `authorized` while the issuer has released funds — re-fetch before capturing and handle capture failures |
| **Void window** | Void authorized (uncaptured) payments while the hold is active. For already-**paid**/auto-captured payments, Moyasar may allow void only within a short settlement window (commonly ~**2 hours**); after that use refund |
| **Verified status** | Moyasar `verified` is a zero-amount card **setup/verification**, not an authorization hold — mapped to SDK `setup_completed` |
| **Partial statuses** | Refund completeness uses a **captured baseline** when `captured > 0`, else authorization `amount`: `refunded > 0 && refunded < baseline` → `partially_refunded`; `refunded >= baseline && baseline > 0` → `refunded` (so full refund of a partial capture is `refunded`); provider `refunded` with **missing/zero** `refunded` amount → `refund_completed` (fail-closed, not full `refunded`); partial capture maps to `partially_captured` |
| **Webhook money fields** | Refund/capture events set `event.amount` from cumulative `refunded` / `captured` (not always the payment total). Incomplete refunds without a `refunded` field omit `amount` rather than inventing the full total |
| **Callback URL** | Moyasar requires it for card/token sources. When omitting `callbackUrl` (STC Pay, etc.) or using Moyasar-only fields (`splits`), pass the second arg `'moyasar'` or call `client.gateway('moyasar').createPayment(...)` |
| **STC Pay Confirmation** | Do not browser-redirect to `source.transaction_url`; `redirectUrl` is undefined for STC Pay, so collect the OTP and call `confirmStcPayOtp` with `idempotencyStore` + `idempotencyKey` (OTP confirm is a mutation POST) |
| **Sandbox** | `sandbox` config is ignored; test/live is determined by the secret key prefix |
| **Webhook livemode** | When the payload includes boolean `live`, the SDK sets `event.livemode` to that value |
| **Webhook secrets** | After verification, `event.rawPayload` is a clone **without** `secret_token` so the webhook secret is not re-logged or forwarded |

## Marketplace Splits

When creating a payment with splits, pass each split `amount` in **major** currency units (same as the top-level payment amount). The SDK converts them to Moyasar minor units.

```typescript
// splits is Moyasar-only — pass gateway: 'moyasar' (or gateway('moyasar')).
const result = await client.createPayment({
  amount: 100, // 100.00 SAR major units
  currency: 'SAR',
  moyasarSource: {
    type: 'applepay',
    token: 'encrypted_token',
  },
  splits: [
    {
      amount: 50, // major units → sent as 5000 halalas
      recipient_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      reference: 'seller_a',
      fee_source: true,
    },
    {
      amount: 50,
      recipient_id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
      reference: 'seller_b',
    },
  ],
}, 'moyasar');
```

Moyasar requires the sum of split amounts to equal the payment amount (in minor units after conversion).

## Account Funding Transactions (AFT)

`MoyasarCreatePaymentParams` accepts optional `recipient` and `sender` objects for
Account Funding Transaction (AFT) payment creation. These are passed through to
Moyasar's create-payment API as-is.

AFT is **account-gated**: your Moyasar merchant account must have AFT enabled
(contact Moyasar support / account manager). Do not send `recipient`/`sender`
unless that capability is active and you are intentionally creating an AFT.

```typescript
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  moyasarSource: {
    type: 'applepay',
    token: 'encrypted_token',
  },
  recipient: {
    first_name: 'Saleh',
    last_name: 'Ali',
    address: 'Riyadh',
  },
  sender: {
    account: {
      funds_source: '01',
      number: '123456789',
    },
    first_name: 'Sara',
    last_name: 'Ali',
    address: 'Riyadh',
    country_code: 'SA',
    id_type: 'NTID',
    id: '1234567890',
    phone_number: '0512345678',
  },
}, 'moyasar');
```

## Moyasar Status Mapping

| Moyasar Status | SDK Status |
|----------------|------------|
| `initiated` | `pending` |
| `paid` | `paid` |
| `authorized` | `authorized` |
| `verified` | `setup_completed` (card setup / zero-amount verification — **not** an auth hold) |
| `captured` | `paid` (or `partially_captured` when amount-derived) |
| `failed` | `failed` |
| `abandoned` | `failed` |
| `refunded` | `refunded` when `refunded` amount covers baseline; **`refund_completed`** when amount is missing/zero (incomplete snapshot — not full `refunded`) |
| `voided` | `cancelled` |
| *(unmapped string)* | `failed` (logged warning; fail-closed for fulfillment) |

> **Do not fulfill on `success` alone.** HTTP-successful creates with
> Moyasar `status: 'initiated'` map to `success: true` and SDK
> `status: 'pending'` until 3DS/OTP completes. **Fulfill only when status is
> `paid`** (or `authorized` if you intentionally hold auth-only funds). Prefer
> verified webhooks; after a `callback_url` / 3DS return, re-fetch with
> `getPayment` and verify amount/currency — never trust the redirect query
> string alone.

### Amount-derived partial statuses

After mapping the provider status string, the SDK refines status from amounts
when present on the payment (create/get/capture/refund responses and webhooks):

| Condition | SDK Status |
|-----------|------------|
| `refunded > 0` and `refunded < refundBaseline` | `partially_refunded` |
| `refunded >= refundBaseline` and `refundBaseline > 0` | `refunded` |
| Provider status `refunded` but `refunded` amount missing/zero/non-finite | `refund_completed` (fail-closed; **not** full `refunded`) |
| Webhook envelope `payment_refunded` but domain still paid-like (missing/zero `refunded`) | `refund_completed` (fail-closed; **not** `paid` / full `refunded`) |
| `captured > 0` and `captured < amount` (auth/paid family) | `partially_captured` |

**Refund baseline:** `refundBaseline = captured > 0 ? captured : amount`. Full refund of a
partial capture (e.g. `amount=10000`, `captured=3000`, `refunded=3000`) maps to `refunded`,
not `partially_refunded`. When `captured` is 0/absent, completeness uses authorization `amount`.

**Incomplete refund snapshots:** Never treat provider `refunded` alone as full money
reversal. Without a positive finite `refunded` amount that covers the baseline, the SDK
returns `refund_completed` so handlers that key only on `status === 'refunded'` do not
fully reverse inventory/accounting from a thin payload. The same fail-closed path applies
to `payment_refunded` webhooks whose payment object still shows a paid-like status with
missing/zero `refunded` — domain status becomes `refund_completed`, not `paid`. Prefer
re-fetching with `getPayment` when amounts are missing. On webhooks, Phase-7 dual-write
also demotes incomplete `refund_completed` from `refund.completed` → `refund.pending`
so type-only handlers cannot over-settle; proven full/partial (`refunded` /
`partially_refunded`) still dual-write `refund.completed`.

Partial refunds take precedence over partial capture when both amount fields apply.

**Partial capture outcome:** `partially_captured` maps to operation outcome
`requires_action` (open money story), not `succeeded`. `isPaidOutcome` is false either
way (paid-like is `paid` only). On webhooks, Phase-7 dual-write also demotes
`payment_paid` / `payment_captured` from `payment.succeeded` / `capture.completed` to
`payment.processing` when domain status is **not** paid-like (`paid`) — including
amount-derived `partially_captured` — so type-only handlers cannot over-fulfill from
the envelope alone.

**Incomplete paid snapshots:** When a 2xx body maps to `paid` but the money snapshot is
incomplete (missing/non-finite `amount`, missing/blank `currency`, or missing/non-finite/
**finite 0** `captured`), the SDK demotes status to `processing` so `isPaidOutcome`
stays false and dual-write is not `payment.succeeded`. Finite `captured: 0` is
legitimate only for non-paid paths (e.g. `verified` → `setup_completed`). Do not
treat the authorization total as settled captured. Major-unit money fields are only
published together with a non-empty currency; a known `captured: 0` is published as
`capturedAmount: 0` (and webhook `event.amount` 0 for paid/captured envelopes)
rather than inventing the full total.

## Capture Payment

Moyasar payments are typically auto-captured by default. Set `capture: false` on `createPayment` to send Moyasar `source.manual: true`, then capture the authorized payment later (token / encrypted Apple Pay / Samsung Pay only — not DPAN or STC Pay).

> ⚠️ **Multi-worker footgun:** Moyasar has **no** native idempotency for capture /
> refund / void. Configure a shared `moyasar.idempotencyStore` and pass
> `idempotencyKey` on every mutation or concurrent workers / retries can
> double-apply. See [Idempotency for refunds, captures, and voids](#idempotency-for-refunds-captures-and-voids).

```typescript
const result = await client.capturePayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
  amount: 100, // Optional: Capture partial amount if supported
  currency: 'SAR', // Required whenever amount is provided; must match payment currency
  idempotencyKey: 'capture-order-123',
}, 'moyasar');
```

Omit `amount` for a full capture; the SDK sends no request body in that case.
When `amount` is set, the SDK GETs the payment first and converts majors with
the **payment** currency (caller `currency` must match — wrong ISO scale would
under/over-capture).

> **Capture window**: Authorization holds are issuer-controlled and can expire
> while Moyasar still reports `authorized`. **mada** holds are typically
> capturable for up to **14 days**; other networks follow their own limits.
> Capture promptly, re-fetch the payment if unsure, and treat capture failures
> as definitive (do not assume funds remain held solely from Moyasar status).

## Refund Payment

Moyasar API does not have a separate refund object; the payment is updated in place.
Moyasar's refund endpoint does not accept a reason field — any `reason` on the SDK
params is ignored for Moyasar.

`refundPayment` returns `GatewayRefundResult`. On HTTP success, `result.status` is
**`completed`** / `outcome: 'succeeded'` only when the payment has a **proven**
refund total (`refunded > 0`, or resolved payment status `refunded` /
`partially_refunded`). Incomplete snapshots (`refund_completed` — provider
claims refunded without a positive `refunded` amount) stay **`pending`** and
omit `totalRefunded` rather than inventing `0` (MOYASAR-2). Payment lookup /
webhook **payment** status still uses the amount-derived mapping above
(`partially_refunded` / `refunded` / `refund_completed` for incomplete money).

Partial amounts convert with the **payment** currency from a preflight GET
(caller `currency` must match; required whenever `amount` is set).

> ⚠️ Configure shared `moyasar.idempotencyStore` and pass `idempotencyKey` —
> required on every refund (no native Moyasar refund idempotency).

```typescript
const result = await client.refundPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
  amount: 50, // Optional: Partial refund (major units)
  currency: 'SAR', // Required whenever amount is provided; must match payment
  idempotencyKey: 'refund-order-123',
}, 'moyasar');
// result.status === 'completed' for proven full or partial refunds
```

Omit `amount` for a full refund; the SDK sends no request body in that case.

## Void Payment

Void while Moyasar still allows reversal (Payment Operations):

- **Authorized (manual capture)**: void the uncaptured hold before it expires.
- **Paid / auto-captured**: Moyasar may accept void only within a short
  settlement window (commonly about **2 hours** after payment). After that
  window closes, use `refundPayment` instead.

> ⚠️ Configure shared `moyasar.idempotencyStore` and pass `idempotencyKey` —
> required on every void (no native Moyasar void idempotency).

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
  idempotencyKey: 'void-order-123',
}, 'moyasar');
// Provider confirmed voided → status cancelled, outcome succeeded (void complete).
// Residual 2xx still paid (void not applied / outside window) → status paid,
// outcome succeeded, isPaidOutcome true — money-honest residual, NOT void-complete.
// Key void success on status === 'cancelled', not outcome alone.
```

## Callback / 3DS return

When card payments require 3DS, Moyasar redirects the customer to your
`callback_url` with payment fields on the query string. Treat that redirect as
a **signal to re-fetch**, not as proof of payment:

1. Read at most the payment id from the query (if you need it).
2. Call `getPayment` (or wait for a verified webhook).
3. Confirm `status` is `paid` (or `authorized` for auth-only), and that
   `amount` / `currency` match your order.
4. Only then fulfill.

Prefer **webhooks** for fulfillment in production; the browser callback can be
replayed, abandoned, or spoofed.

```typescript
// Express-style illustration — do not trust req.query.status.
app.get('/callback', async (req, res) => {
  const gatewayPaymentId = String(req.query.id ?? '');
  if (!gatewayPaymentId) {
    return res.status(400).send('missing payment id');
  }

  const payment = await client.getPayment({ gatewayPaymentId }, 'moyasar');

  if (
    payment.status === 'paid' &&
    payment.amount === expectedAmount &&
    payment.currency === expectedCurrency
  ) {
    // Fulfill the order (or wait for webhook and reconcile).
  }

  res.redirect('/order/thanks');
});
```

## Get Payment Details

Retrieve the latest status of a payment — required after 3DS/callback return
and whenever you must not trust a client-supplied status.

```typescript
const payment = await client.getPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
}, 'moyasar');

console.log(payment.status); // 'paid', 'refunded', etc.
// Always check status (and amount/currency) before fulfillment.
```

## Webhook Verification

```typescript
app.post('/webhooks/moyasar', async (req) => {
  const event = await client.handleWebhook('moyasar', req.body);

  console.log(event.status);          // 'paid', 'failed', 'partially_refunded', etc.
  console.log(event.type);            // 'payment_paid', 'payment_failed', etc.
  console.log(event.amount);          // refunded/captured slice for those events — not always payment total
  console.log(event.paymentId);       // metadata.paymentId, or metadata.orderId fallback
  console.log(event.gatewayPaymentId); // Moyasar payment ID
  console.log(event.livemode);        // true/false when payload includes `live`

  return { received: true };
});
```

Moyasar currently documents failed payment webhooks as `payment_faild`; the SDK normalizes that typo to `payment_failed` in the returned event. The original event type remains on the source object only if you keep your own copy of the request body — `event.rawPayload` is a shallow clone of the parsed payload **with `secret_token` removed** so the webhook secret is not re-exposed after verification.

When the webhook envelope includes a boolean `live` field, the SDK sets
`event.livemode` to that value so you can distinguish test vs production events.

**Webhook money fields:** For `payment_refunded` / refund-like statuses, `event.amount`
is the cumulative **refunded** major amount when present (including `0`). Incomplete
refunds that omit `refunded` leave `event.amount` undefined rather than inventing the
payment total. For `payment_captured` / `partially_captured`, amount prefers
**captured**. Do not restock or ship from `event.amount` alone without also checking
`status` and re-fetching when amounts are incomplete.

**Phase-7 dual-write honesty:** Settled dual-write (`payment.succeeded` /
`capture.completed`) is kept only when domain status is paid-like (`paid`). When amount
refinement yields `partially_captured` (or any other non-paid domain status),
`event.stableType` / `event.event.type` are demoted to `payment.processing` even if the
Moyasar envelope was `payment_paid` or `payment_captured`. Provider-native `event.type`
is unchanged. Full settlement still dual-writes settled types. Incomplete refund
snapshots (`status === refund_completed`, missing/zero/non-finite `refunded`) demote
dual-write from `refund.completed` → `refund.pending`; proven full/partial refunds keep
`refund.completed`.

`payment_voided` maps to `payment.cancelled` only when the snapshot is actually
voided (`status === cancelled`). A `payment_voided` envelope whose payment object is
still `paid`, `authorized`, or `partially_captured` is fail-closed: domain status stays
residual (money-honest — funds remain captured or held) and dual-write is demoted to
`payment.processing` so type-only handlers cannot restock. Key void-complete restock on
`status === 'cancelled'` and `stableType === 'payment.cancelled'`, not envelope type
alone. Re-fetch with `getPayment` when the snapshot is inconsistent.

### Card authentication webhooks

Standalone 3DS (`card_auth_*`) webhooks — e.g. `card_auth_authenticated`,
`card_auth_failed` — carry a card authentication object, not a payment. After
signature verification the SDK **parses** them as `provider.unmapped` (setup-like
`setup_completed`, or `failed` for `card_auth_failed`) so they are not mistaken
for `payment.pending` / `payment.succeeded` and so authentic events are ACK'd
instead of retried forever. Do not fulfill from `card_auth_*`; handle them as
setup / 3DS signals or ignore them if you only process payment envelopes.

## Idempotency for refunds, captures, and voids

> **Required for all capture/refund/void/confirmStcPayOtp (MOYASAR-1/2):**
> configure `moyasar.idempotencyStore` with atomic `reserve()` and pass
> `idempotencyKey` on every mutation. The SDK **throws** `InvalidRequestError`
> when the store, key, or atomic `reserve()` is missing — unguarded mutations
> are refused (double-refund / double-OTP class). Prefer a shared store
> (Redis/SQL) in multi-worker deployments; `InMemoryIdempotencyStore` only
> protects a single process.

Moyasar's API has **no native idempotency** for the refund, capture, void, and
STC Pay OTP confirm endpoints. Without protection, a retried refund (e.g. after
a network timeout) can refund the customer twice.

The SDK does **not** auto-retry capture/refund/void/confirmStcPayOtp with
`withRetry` (a lost response after a successful mutation could double-apply).
`idempotencyStore` + `idempotencyKey` make **your** retries safe: completed
results are cached,
in-progress / unknown outcomes refuse a second attempt, and **only** definite
4xx rejections (Moyasar refused the mutation; excluding 429) clear the
reservation so a caller retry is allowed. Post-2xx invalid JSON, mapping
errors after a successful HTTP response, network/5xx/429, and other
indeterminate failures **keep** the fence as `unknown` — the mutation may
already have applied server-side; resolve via `getPayment` before reusing the
key. Stores without atomic `reserve()` are refused at mutation time (non-atomic
get-then-set races under concurrency). The SDK also logs a construction-time
warning that the store is **required** for mutations when none is configured
or when `reserve()` is missing.

```typescript
import { PaymentClient, InMemoryIdempotencyStore } from '@paykernel/core';

const client = new PaymentClient({
  moyasar: {
    secretKey: process.env.MOYASAR_SECRET_KEY!,
    // Required for multi-worker refund/capture/void/OTP safety. Prefer a shared
    // store with atomic reserve() in production; InMemoryIdempotencyStore only
    // protects a single process.
    idempotencyStore: new InMemoryIdempotencyStore(),
  },
});

await client.refundPayment(
  {
    gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
    amount: 50,
    currency: 'SAR',
    idempotencyKey: 'refund-order-987',
  },
  'moyasar',
);
```

Behavior of the guard, keyed by `idempotencyKey + operation + paymentId`:

- **Completed** for the key: the cached result is returned, no API call is made.
- **In progress / outcome unknown** for the key: the call is refused rather than
  risking a duplicate mutation.
- **Definite failure** (HTTP 4xx except 429 — Moyasar rejected the mutation):
  the reservation is cleared so a retry is allowed.
- **Indeterminate failure** (network/5xx/429, post-2xx invalid JSON or mapping
  errors after HTTP success, unexpected throws): an `unknown` marker is kept so
  the mutation is never silently re-applied — resolve it (e.g. via `getPayment`)
  before retrying with the same key.

For full cross-worker protection, implement the store's optional atomic
`reserve` with Redis `SET NX`, a database unique constraint, or equivalent.
