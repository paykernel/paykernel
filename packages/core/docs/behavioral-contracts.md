# Behavioral contracts (Phase 0 baseline)

This document consolidates **current** runtime contracts of `@paykernel/core` **v0.8.0**. It is a regression baseline for integrators: retry safety, provider IDs, webhooks, statuses, hooks isolation, indeterminate outcomes, and runtime assumptions.

**Shipped architecture (not aspirational):** the SDK lives in a Bun monorepo (`packages/core`). Prefer `createPaymentClient` with `createGatewayRegistry` / gateway factories (or a `gateways` map) for new code; the legacy `new PaymentClient({ moyasar, … })` constructor remains supported and deprecated through `0.x`. See [plugin-architecture.md](./plugin-architecture.md) and [custom-gateways.md](./custom-gateways.md).

**Scope:** built-in gateways Moyasar, PayPal, Paymob, Stripe; `PaymentClient` / `createPaymentClient`; shared retry / idempotency utilities; hooks and webhooks. Later-phase surfaces (operation outcomes, money helpers, portable runtime, webhook inbox package) are documented in their own guides; this file still anchors payment mutation and webhook contracts.

**Related docs:** [plugin-architecture.md](./plugin-architecture.md), [runtime.md](./runtime.md) (Phase 8 portability), [hooks.md](./hooks.md), [webhooks.md](./webhooks.md), [moyasar.md](./moyasar.md), [paypal.md](./paypal.md), [paymob.md](./paymob.md), [stripe.md](./stripe.md), [README](../README.md).

---

## 1. Operations safe to retry

Shared retry helper: `withRetry` in `src/utils/retry.ts` (default up to **3** attempts, exponential backoff with jitter, honors `retryAfterSeconds` / `Retry-After` when present, capped separately from `maxDelayMs`).

**Rule of thumb:** GETs are always safe to auto-retry on transient transport failures. Money mutations are auto-retried **only** when the request is protected by provider-native or SDK-level idempotency so a lost response cannot double-apply. Callers still own app-level crash/retry safety when they need stable keys across processes.

### Cross-gateway matrix (SDK auto-retry)

| Operation family | Moyasar | PayPal | Paymob | Stripe |
|------------------|---------|--------|--------|--------|
| **GET / inquiry** (`getPayment`, status lookup, token refresh as applicable) | Auto-retry on network / 5xx / 429 | Auto-retry on network / 5xx / 429 / specific 409 in-progress conflict | Auto-retry on network / 5xx / 429 | Auto-retry GET/HEAD on `NetworkError` / `RateLimitError` |
| **createPayment** | Auto-retry **only if** `idempotencyKey` set (`given_id`) | Always sends `PayPal-Request-Id` (caller key or generated UUID) → auto-retry enabled | **Not** auto-retried via `withRetry`; optional `idempotencyKey` + in-memory/store guard | Always sends `Idempotency-Key` (caller key or generated UUID) → auto-retry enabled |
| **capture / refund / void** | **Never** auto-retried (`withRetry` not used). Guard via optional `idempotencyStore` + `idempotencyKey` for **caller** retries | Always sends `PayPal-Request-Id` (caller key or generated UUID) → auto-retry enabled | **Never** auto-retried. Guard via optional `idempotencyKey` (+ optional shared `idempotencyStore`) | Always sends `Idempotency-Key` (caller key or generated UUID) → auto-retry enabled |
| **authorizePayment** (PayPal) | N/A | Same as mutations: request id always present → auto-retry | N/A | N/A |
| **createCheckoutSession** (Stripe) | N/A | N/A | N/A | Same as Stripe mutations (idempotency key always present) |

Transient classes generally treated as retryable where auto-retry is enabled: `NetworkError` (including abort/timeouts), provider 5xx, and 429 / `RateLimitError`. PayPal also retries certain `409 RESOURCE_CONFLICT` / `PREVIOUS_REQUEST_IN_PROGRESS` responses. Definite 4xx validation / business declines are **not** retried.

### Per-gateway notes

#### Moyasar

- **createPayment:** retryable only when `idempotencyKey` is present (mapped to Moyasar `given_id`, which becomes the payment ID). Without a key, a single attempt only — a network blip after the HTTP send could otherwise create a second payment.
- **getPayment:** always retryable on transient errors.
- **capture / refund / void:** deliberately **not** wrapped in `withRetry`. Moyasar has **no native** mutation idempotency. Configure `moyasar.idempotencyStore` and pass `idempotencyKey` so **your** retries are safe (completed results cached; in-progress / unknown refuse a second apply; definite 4xx clear the reservation). See [moyasar.md — Idempotency](./moyasar.md#idempotency-for-refunds-captures-and-voids).
- Without a store, an `idempotencyKey` on mutations is **ignored** (warn-logged) and the mutation runs unguarded.

#### PayPal

- Mutations always include `PayPal-Request-Id` via `getRequestId(idempotencyKey ?? crypto.randomUUID())`, so in-process SDK retries of create/capture/authorize/refund/void are protected by PayPal’s native key for that single call.
- Supply your own stable `idempotencyKey` when the **application** must retry after process crash (the auto-generated UUID is only known for the lifetime of that call).
- GETs always use the retryable-error predicate.

#### Paymob

- Safe GETs / inquiries use `withRetry` with `isPaymobRetryableError`.
- Mutations (create intention, capture, refund, void) are **not** auto-retried with `withRetry`. They go through an idempotency guard when `idempotencyKey` is provided (process-local cache by default; optional shared `paymob.idempotencyStore`).
- After a network / indeterminate 5xx-style failure on a keyed mutation, the key is marked **unknown** and further automatic replay with that key is blocked until you reconcile. See [paymob.md](./paymob.md).

#### Stripe

- GET/HEAD always retryable; POST mutations retryable when an `Idempotency-Key` is present.
- The gateway **always** resolves a key (`resolveStripeIdempotencyKey`): caller key, or `randomUUID()` if omitted/blank — so mutations are always auto-retry-safe within a single call.
- Supply a stable caller key for cross-process retry after crash. Keys longer than Stripe’s limit (255) are rejected. See [stripe.md — Idempotency](./stripe.md#idempotency).

### Uncertain timeouts must not be treated as “payment failed”

When the SDK times out or loses the connection **after** a request may have been accepted by the provider:

1. The SDK throws **`NetworkError`** (code `NETWORK_ERROR`, HTTP status 503 on the error class). It does **not** invent a successful `GatewayPaymentResult` with `status: 'failed'`, and it does **not** claim the provider rejected the charge.
2. **Auto-retry** only continues when the operation is classified retry-safe (GET, or mutation with idempotency as above). If retries are exhausted (or the mutation is non-retryable, e.g. Moyasar/Paymob capture without store semantics), the **`NetworkError` is rethrown**.
3. **Integrator contract:** treat timeout / `NetworkError` as **indeterminate** for money mutations unless you reconcile (GET payment, webhook, dashboard). Do **not** mark the order paid **or** mark the payment “failed at provider” solely because the SDK threw. Prefer reconciling before a new mutation without idempotency protection.

This is the current concrete behavior: timeouts surface as thrown transport errors, not as mapped terminal payment statuses.

---

## 2. IDs required for capture, void, and refund

The unified API uses `gatewayPaymentId` on capture/refund/void params, but **each provider expects a different resource identity**. Store the correct ID when the payment is created/captured/notified. Always call follow-ups on the **same** gateway that created the payment.

| Provider | Capture | Void | Refund | Notes |
|----------|---------|------|--------|-------|
| **Moyasar** | Moyasar **payment UUID** | Same **payment UUID** (authorized uncaptured; limited window if already paid) | Same **payment UUID** | Non-UUID IDs rejected before API call. No separate refund entity — refund updates the payment. |
| **PayPal** | **Order ID** for default order capture after approval; **authorization ID** when `paypalCaptureType: 'authorization'` | **Authorization ID** (not order ID) | **Capture ID** (not order ID, not authorization ID) | Persist `captureResult.captureId` / `gatewayId` after capture. `getPayment` may accept order, capture, or auth IDs for lookup only. |
| **Paymob** | Numeric **transaction ID** | Numeric **transaction ID** | Numeric **transaction ID** | **Not** the Intention ID (`pi_...`) from `createPayment`. Source: verified processed webhook `obj.id` or dashboard. Non-numeric / intention IDs rejected client-side. |
| **Stripe** | PaymentIntent **`pi_...`** | PaymentIntent **`pi_...`** (cancel) | PaymentIntent **`pi_...`** | Checkout Session (`cs_...`) and Subscription (`sub_...`) IDs are rejected for money mutations. Resolve PI first (e.g. `getCheckoutSession` → `paymentIntentId`). |

### Quick reference by provider

#### Moyasar

```typescript
await client.capturePayment({ gatewayPaymentId: paymentUuid }, 'moyasar');
await client.voidPayment({ gatewayPaymentId: paymentUuid }, 'moyasar');
await client.refundPayment({ gatewayPaymentId: paymentUuid, amount?, currency? }, 'moyasar');
```

Details: [moyasar.md](./moyasar.md).

#### PayPal

```typescript
// Order capture (CAPTURE intent, after approval)
await paypal.capturePayment({ gatewayPaymentId: orderId });

// Auth hold capture
await paypal.capturePayment({
  gatewayPaymentId: authorizationId,
  paypalCaptureType: 'authorization',
  amount?, currency?, paypalFinalCapture?,
});

// Void authorization only
await client.voidPayment({ gatewayPaymentId: authorizationId }, 'paypal');

// Refund — capture ID required
await client.refundPayment({ gatewayPaymentId: captureId, amount?, currency? }, 'paypal');
```

Details: [paypal.md](./paypal.md).

#### Paymob

```typescript
// gatewayPaymentId must be the numeric transaction id, not Intention pi_...
await client.capturePayment({ gatewayPaymentId: '123456789', amount?, currency? }, 'paymob');
await client.voidPayment({ gatewayPaymentId: '123456789' }, 'paymob');
await client.refundPayment({ gatewayPaymentId: '123456789', amount?, currency? }, 'paymob');
```

Details: [paymob.md](./paymob.md).

#### Stripe

```typescript
await stripe.capturePayment({ gatewayPaymentId: 'pi_...', amount?, currency? });
await client.voidPayment({ gatewayPaymentId: 'pi_...' }, 'stripe');
await client.refundPayment({ gatewayPaymentId: 'pi_...', amount?, currency? }, 'stripe');
```

Details: [stripe.md](./stripe.md).

Also summarized in the README multi-gateway table (refund IDs and `capture: false` flows).

---

## 3. Webhooks requiring raw request bodies

Prefer `PaymentClient.handleWebhook(gateway, payload, signatureOrHeaders?, headers?)` over manual verify/parse. Full detail: [webhooks.md](./webhooks.md).

| Gateway | Body to pass | Signature / authenticity material | Config required |
|---------|--------------|-----------------------------------|-----------------|
| **Stripe** | **Raw** `string` or `Buffer` **required** | `stripe-signature` header | `stripe.webhookSecret` (`whsec_...`). Missing secret → fail closed. |
| **PayPal** | Prefer raw `string` / `Buffer` / `Uint8Array` | Transmission headers object (`paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`, `paypal-cert-url`, `paypal-auth-algo`) | `paypal.webhookId`. Sync `verifyWebhook` throws; async verify / `handleWebhook` only. |
| **Moyasar** | Parsed JSON body is fine | No signature header; `secret_token` field in payload | `moyasar.webhookSecret` (constant-time compare) |
| **Paymob** | Parsed object is fine for HMAC field selection | HMAC string (query/body); may also read `payload.hmac` | `paymob.hmacSecret` in production |

### Stripe

- Signs the **exact raw request body bytes**. Parsed/re-serialized JSON **never** verifies.
- Frameworks that auto-parse JSON need a raw-body route (e.g. `express.raw({ type: 'application/json' })`) or `request.text()` before `JSON.parse`.

### PayPal

- Verification is an **API postback**, not a local HMAC. The SDK embeds raw body bytes/text as `webhook_event` **without** parse→stringify reordering.
- Parsed objects are accepted but re-serialized and **may fail** verification.
- Extra guards: `paypal-cert-url` must be HTTPS under `*.paypal.com`; `paypal-transmission-time` older than **15 minutes** (or unparseable) is rejected before calling PayPal.
- Transient PayPal API failures during verification throw (return 5xx so PayPal retries); use 4xx only for invalid transmissions.

### Moyasar

- No raw-body requirement. Compares payload `secret_token` to config.

### Paymob

- HMAC over gateway-defined field orderings (transaction vs token vs redirect shapes), not the raw HTTP body. Do not mutate fields before verifying.
- Redirect-only callbacks must **not** be used as sole fulfillment truth; prefer processed backend `TRANSACTION` notifications. See [paymob.md](./paymob.md).

### Shared webhook contracts

- Deduplicate by **`event.id`** (or equivalent provider event id) before fulfillment — the SDK does **not** store processed ids.
- Hook ordering: `onWebhookReceived` (untrusted) → verify → parse → `onWebhookVerified` (trusted). See [hooks.md](./hooks.md) and [webhooks.md](./webhooks.md).

---

## 4. Terminal and non-terminal `PaymentStatus` values

Canonical union (`src/types/payment.types.ts`):

```typescript
type PaymentStatus =
  | "pending"
  | "processing"
  | "authorized"
  | "approved"
  | "paid"
  | "partially_captured"
  | "failed"
  | "cancelled"
  | "reversed"
  | "refunded"
  | "partially_refunded"
  | "refund_completed"
  | "refund_pending"
  | "refund_failed"
  | "setup_completed";
```

There is **no** single exported `isTerminalStatus()` helper in v0.8.0. Classification below is the **product meaning for fulfillment guidance** used across README and gateway docs. Gateway-specific mapping tables remain authoritative for each provider.

### Non-terminal (do not treat as final “ship goods / money settled” without further checks)

| Status | Typical meaning for integrators |
|--------|----------------------------------|
| `pending` | Awaiting customer action, provider processing, or async settlement (3DS, PayPal echeck/review, etc.) |
| `processing` | In-flight processing (provider-dependent) |
| `authorized` | Auth hold only — funds reserved, **not** captured/paid unless your product intentionally treats holds as reserved inventory |
| `approved` | Buyer approved (e.g. PayPal order approved **before capture**). **Not** paid-like — `isPaidOutcome` is false; never ship on approval alone. Aligns with webhook `payment.processing` for `CHECKOUT.ORDER.APPROVED` |
| `partially_captured` | Some but not all authorized amount captured — still an open capture story |
| `partially_refunded` | Some money returned; remaining captured balance may still exist |
| `refund_pending` | Refund accepted/pending at provider (e.g. PayPal refund lifecycle) — not a settled payment state |
| `refund_failed` | Refund attempt failed — original capture may still be paid |

### Terminal-ish for **payment collection / order outcome** (fulfillment guidance)

Use these as **signals**, still re-check amount/currency and your business rules:

| Status | Fulfillment guidance |
|--------|----------------------|
| `paid` | **Primary (and only runtime paid-like) fulfill signal** for capture/sale success. Prefer **`isPaidOutcome(result)`** (`outcome === 'succeeded'` + status `paid`); bare `success: true` is never enough |
| `approved` | **Not paid-like.** PayPal buyer approval / pre-capture only. Operation outcome is `requires_action` (not `succeeded`). Never ship on approval alone — wait for capture / `status === 'paid'` / `PAYMENT.CAPTURE.COMPLETED` |
| `failed` | Terminal failure of the payment attempt — do not fulfill |
| `cancelled` | Voided / cancelled / expired holds or orders — do not fulfill as paid |
| `reversed` | Provider reversed the payment — treat as money no longer good for fulfillment |
| `refunded` | Full refund of captured amount (as mapped) — reverse fulfillment/inventory as your policy requires |
| `refund_completed` | Refund object completed (often Stripe refund webhooks when aggregate payment state is not fully known) — **not** the same as original payment still paid |
| `setup_completed` | Card setup / zero-amount verification / setup-mode checkout — **not** a paid charge; vault/setup flows only |

### Critical integrator rules (current product meaning)

1. **`success: true` is not “paid”.** Creates/captures can return `success: true` with `status: 'pending'`, `authorized`, or `approved` (API-ok ≠ settled). **Fulfill only on paid-like settlement:** **`paid` only** (runtime `PAID_LIKE_PAYMENT_STATUSES`). Prefer Phase 6 **`isPaidOutcome(result)`**, which requires `outcome === 'succeeded'` **and** status `paid` (**`authorized` and `approved` are excluded**). Checking `status === 'paid'` is also valid; do **not** fulfill on bare `success`, auth holds, or PayPal buyer approval alone. See [operation-results.md](./operation-results.md).
2. **Indeterminate is not failure.** Timeouts or ambiguous outcomes after a mutation may have been accepted must use `outcome: 'indeterminate'` + `reconciliationRequired: true` — never treat as a definitive decline without reconciliation.
3. **Prefer verified webhooks** (or a fresh `getPayment`) over browser redirects for fulfillment.
4. **Partial statuses** (`partially_captured`, `partially_refunded`) require amount-aware business logic; do not assume full capture or full refund.
5. Unmapped provider statuses are generally **fail-closed** toward non-fulfillment (`failed` or safe `pending` depending on gateway — see each gateway’s status table). Do not invent fulfillment from unknown strings.

Refund-specific SDK type `RefundStatus` (`"pending" | "completed" | "failed"`) applies to `GatewayRefundResult.status`, separate from payment `PaymentStatus`.

---

## 5. After-hooks cannot roll back provider-side effects

Hooks run through `BaseGateway.executeWithHooks` (and client webhook paths). Full detail: [hooks.md](./hooks.md).

### Before hooks (can abort cleanly)

- `onBefore`, `beforeCreatePayment`, `beforeCapture`, `beforeRefund`, `beforeVoid`, `beforeAuthorize`, etc. run **before** the provider API call.
- `{ proceed: false }` or throw → **`PaymentAbortedError`**, **no** provider money side effect.

### After hooks (isolation only — no financial undo)

After hooks (`afterCreatePayment`, `afterCapture`, `afterRefund`, `afterVoid`, `afterAuthorize`, global `onAfter`) run **after** the provider operation has **already succeeded**.

| After-hook outcome | SDK behavior | Provider side effect |
|--------------------|--------------|----------------------|
| `{ proceed: false }` | **Ignored** (warn-logged); later after-handlers still run | **Stays committed** |
| throw | **Isolated** (error-logged); later after-handlers still run; success still returned to caller | **Stays committed** |
| `modifiedResult` money/identity fields | Critical fields restored from original gateway result | N/A — cannot flip paid status, amounts, fees, gateway IDs, etc. |

Restored identity/money fields include (when present on the original result): `success`, `outcome`, `status`, `amount`, `gatewayId`, `captureId`, `authorizationId`, `orderId`, `totalRefunded`, `refundId`, `gatewayRefundId`, `fee`, `capturedAmount`, `refundedAmount`, `clientSecret`, `references`, `decline`, `reconciliationRequired`, `providerRequestId`.

**Contract:** after-hooks are for analytics, logging, and non-money `modifiedResult` annotations. They **cannot** abort, roll back, or convert a successful capture/refund/void into a caller-facing payment failure. Idempotency records (where used) may already be marked completed when after-hooks run.

`onError` runs for executor/API failures, **not** for intentional before-hook aborts or after-hook isolation noise.

---

## 6. Outcomes that may be indeterminate

### Transport-level indeterminate

| Situation | Current SDK surface | Integrator action |
|-----------|---------------------|-------------------|
| Request timeout (`AbortError` / configured `timeoutMs`) | Thrown as **`NetworkError`** | Reconcile before re-mutating without protection |
| Connection failure / DNS / fetch failure | **`NetworkError`** | Same |
| Provider 5xx after request may have applied | May surface as **`GatewayApiError`** or gateway-specific mapping; may be retried only if operation is retry-safe | If retries exhausted on a mutation, reconcile |
| Rate limit | **`RateLimitError`** (may include `retryAfterSeconds`) | Back off; retry only when safe |

`NetworkError` is a subclass of `PaymentError` with code `NETWORK_ERROR` and statusCode `503`. It is an **error at the call boundary**, not a normalized payment with `status: 'failed'`.

Phase 6 adds a first-class result arm: **`outcome: 'indeterminate'`** with **`reconciliationRequired: true`** on `GatewayPaymentResult` / `PaymentOperationResult` (see [operation-results.md](./operation-results.md)). Transport-level timeouts may still **throw** `NetworkError`; after-submit ambiguity should prefer the typed indeterminate arm when the gateway can return a result.

### Idempotency-store “unknown” (Moyasar / Paymob)

When a keyed mutation fails with a **retryable/transient** error after the request may have mutated the provider:

- **Moyasar** (`idempotencyStore` + `idempotencyKey`): store record status **`unknown`**; subsequent calls with the same key refuse rather than double-apply. Message class: `InvalidRequestError` indicating in progress / unknown outcome — resolve via `getPayment` (or dashboard) before retrying.
- **Paymob** (`idempotencyKey`, optional store): marks outcome **unknown** and blocks automatic replay; reconcile via verified callback, transaction inquiry, or dashboard.

Definite client/validation failures clear the reservation so a corrected retry is allowed.

### Result-level non-final success (not errors, but not fulfillable)

Examples that return successfully from the SDK **without** meaning “safe to ship”:

- `success: true` + `status: 'pending'` (Moyasar initiated/3DS; PayPal pending capture)
- `status: 'authorized'` / `approved` without capture
- PayPal / Stripe refund `pending` statuses on refund results

### What is **not** claimed

- The SDK does **not** currently convert uncertain timeouts into a synthetic terminal failure payment status.
- The SDK does **not** automatically reverse provider state when the client throws or after-hooks fail.
- Exact provider-side state after a timeout is **unknown** until you poll or receive a webhook.

---

## 7. Current runtime assumptions

| Assumption | Current contract |
|------------|------------------|
| **Module system** | **ESM-only** (`"type": "module"`, `exports` with `import` only). No CommonJS `require` build. Single portable entry `exports["."]`. |
| **Engines** | `node: ">=18"` (minimum; LTS 18/20/22 recommended), `bun: ">=1.0.0"` (`package.json` `engines`). Deno / Cloudflare Workers supported via Web APIs + pure crypto (see [runtime.md](./runtime.md)). |
| **HTTP** | Gateways use **injected** `PaymentRuntime.fetch` / `GatewayContext.fetch` (defaults delegate to live `globalThis.fetch`). Timeouts via `AbortController` / `AbortSignal`. Node ≥ 18 and Bun ≥ 1.0. |
| **Crypto** | **Portable pure HMAC-SHA256/SHA512, SHA-256/512, timing-safe compare, and encoding helpers** — no production dependency on `node:crypto` or `node:buffer`. UUID via Web Crypto / `getRandomValues`. Sync `verifyWebhook` remains available. |
| **PaymentRuntime** | Optional `createPaymentClient({ runtime?: Partial<PaymentRuntime> })` and `createPaymentRuntime()` inject `fetch` / `crypto` / `clock` / `randomUUID`. **No secrets** on the runtime bag. |
| **Persistence** | **No required database or Redis.** Optional injectable idempotency stores for Moyasar/Paymob. Lease-aware inbox/idempotency/reconciliation **store contracts** are defined in `@paykernel/testkit` (Phase 9) — not shipped as core engines. |
| **Default idempotency** | Core `InMemoryIdempotencyStore` and Paymob’s built-in cache are **process-local** (per isolate). Multi-worker / serverless / restarts need a **shared** store for mutation safety. Distinct from testkit lease-aware `IdempotencyStore` / `LeaseAwareIdempotencyStore` ([store-contracts.md](../../testkit/docs/store-contracts.md)). |
| **Secrets** | Server-side only. Secret keys must not ship to browsers. Publishable keys are optional on config and are not used for money mutations or webhook verification in this package. |
| **Amounts** | Public APIs accept `AmountInput` (`Money` preferred; plain major-unit `number` still allowed, deprecated). Response amount fields remain major-unit `number` in 0.x. |
| **Published surface** | Package ships `dist`, `docs`, `README`, `LICENSE` (see `package.json` `files`). Portability gate: production `src` + published `dist` must not static-import `node:` builtins (`bun run check:runtime-portability`). |

Full Phase 8 guide: [runtime.md](./runtime.md).

### Idempotency locality summary

| Gateway | Native provider keys | SDK store |
|---------|---------------------|-----------|
| Stripe | Yes (`Idempotency-Key`; auto-generated if omitted) | Not required |
| PayPal | Yes (`PayPal-Request-Id`; auto-generated if omitted) | Not required |
| Moyasar create | Yes via `given_id` when caller supplies UUID `idempotencyKey` | N/A for create |
| Moyasar capture/refund/void | **No** | Optional `moyasar.idempotencyStore` (process-local if `InMemoryIdempotencyStore`) |
| Paymob create/mutations | **No** native keys | Per-instance cache + optional `paymob.idempotencyStore` |

---

## Document maintenance

- **Source of truth for behavior:** tests under `src/**/*.test.ts` and the gateway implementations.
- **When behavior changes in a breaking or product-visible way:** update this file in the same change as code/docs/tests.
- **Do not** extend this file with Phase 1+ designs unless they ship and tests assert them.

### Unknowns / explicit non-claims (v0.8.0)

- No SDK-wide exported helper classifies terminal vs non-terminal `PaymentStatus`; the table in §4 is documentation guidance aligned with existing docs, not a runtime API.
- Exact issuer capture/void time windows (e.g. Moyasar mada ~14 days, void-after-capture ~2 hours) are **provider policy** documented as guidance, not enforced timers in the SDK.
- Consumer environments without `fetch` or below stated engines are **unsupported**; the SDK does not polyfill them.
