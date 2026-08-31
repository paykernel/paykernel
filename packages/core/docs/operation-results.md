# Operation results & outcomes (Phase 6)

Prefer **`outcome`** discrimination over the legacy **`success: boolean`** field when deciding what to do after `createPayment` / `capturePayment` / `getPayment`. Hosted checkout, customers, disputes, and payment links (Phase 22) are outcome-only — they have no `success` boolean. Checkout create success is **not** paid; use `isHostedCheckoutRedirect` then fulfill from payment settlement.

## Why not `success` alone?

Historically gateways set `success: true` when the **HTTP/API call completed** without a transport failure — including **pending**, **3DS / requires_action**, and authorized holds. That is **not** the same as “customer paid; fulfill the order.”

| Signal | Meaning |
| --- | --- |
| `success: true` | API call OK (0.x, **deprecated for fulfillment**) |
| `outcome: 'succeeded'` | Operation completed in a terminal success sense (may still be auth-only — check `status`) |
| `outcome: 'requires_action'` | Customer must complete 3DS, redirect, OTP, or client SDK confirm |
| `outcome: 'declined'` | Definitive issuer/provider decline |
| `outcome: 'failed'` | Definitive failure |
| `outcome: 'indeterminate'` | **Uncertain** after submit — **must reconcile**; never treat as decline or paid |

**Fulfill only when money is settled**, e.g.:

```ts
import {
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  mapGatewayResultToOperationResult,
} from '@paykernel/core';

const result = await client.createPayment(params);

if (isPaidOutcome(result)) {
  // status paid + outcome succeeded (approved/authorized are never paid)
  await fulfillOrder(result.gatewayId);
} else if (isRequiresActionOutcome(result)) {
  // redirect / OTP / Stripe confirm — do not fulfill
} else if (isIndeterminateOutcome(result)) {
  // do NOT mark failed; reconcile with getPayment / webhooks
}
```

**Post-submit transport (P610-IND-1 / NEW-CORE-1):** `createPayment` / `capturePayment` / `refundPayment` / `voidPayment` no longer throw `NetworkError` when the mutating HTTP request may already have been accepted (timeout, connection drop, or 5xx after POST). `BaseGateway` returns `outcome: 'indeterminate'` + `reconciliationRequired: true`. Preflight auth and GET still throw `NetworkError`. Caller abort **before** submit still throws `PaymentAbortedError`. Caller abort **after** a mutating POST maps to `NetworkError` with `afterProviderSubmit: true` (same uncertainty class as a timeout) so the idempotency fence is not cleared.

## `PaymentOperationResult` arms

Preferred union (via `mapGatewayResultToOperationResult`):

```ts
type PaymentOperationResult =
  | { outcome: 'succeeded'; payment: Payment }
  | { outcome: 'requires_action'; payment: Payment; action: PaymentAction }
  | { outcome: 'declined'; failure: PaymentDecline; payment?: Payment }
  | { outcome: 'failed'; error: PaymentErrorLike; payment?: Payment }
  | {
      outcome: 'indeterminate';
      reconciliationRequired: true;
      providerRequestId?: string;
      payment?: Payment;
      message?: string;
    };
```

### Examples

**Succeeded (paid):**

```ts
const op = mapGatewayResultToOperationResult(result, { gateway: 'stripe' });
if (op.outcome === 'succeeded' && op.payment.status === 'paid') {
  await fulfillOrder(op.payment.references.providerObjectId);
}
// Auth hold: outcome can be 'succeeded' with status 'authorized' — isPaidOutcome is false
// Partial capture: bare `{ success: true, status: 'partially_captured' }` infers
// `requires_action` (open money). Gateways (Paymob/Stripe) may also dual-write
// `outcome: 'requires_action'`; Phase-6 must not upgrade that to succeeded.
// `paid` / `authorized` / `refunded` / `partially_refunded` remain settled-success
// for **outcome only** — `isPaidOutcome` stays paid-only.
// Successful void: outcome 'succeeded' + status 'cancelled' stays succeeded on
// map/infer (not coerced to failed); isPaidOutcome remains false.
```

**Requires action (3DS / redirect):**

```ts
if (op.outcome === 'requires_action') {
  // op.action: { type: 'redirect', url } | use_stripe_sdk | stcpay_otp | …
  return respondWithNextAction(op.action);
}
```

**Declined:**

```ts
if (op.outcome === 'declined') {
  // op.failure.code / message — not a transport error
  return showDecline(op.failure);
}
```

**Indeterminate (must reconcile):**

```ts
if (op.outcome === 'indeterminate') {
  // op.reconciliationRequired === true always
  await scheduleReconciliation(op.payment?.references);
  // Never mark order failed or paid from this arm alone
}
```

## 1.0: `success` removed — `outcome` required

`success: boolean` was removed in 1.0. `GatewayPaymentResult.outcome` and `GatewayRefundResult.outcome` are **required** (`PaymentOperationOutcome` / `RefundOperationOutcome`). Never branch on `success` — use `isPaidOutcome` / `outcome === 'succeeded'` with paid-like status.

`applyOutcomeToGatewayResult(base, outcome)` writes `outcome` + `references` (+ `reconciliationRequired` for indeterminate) — no `success`.

`successFromOutcome` / `successFromRefundOutcome` were removed in 1.0 (use `isPaidOutcome`).

### Helpers (1.0)

| Helper | Role |
| --- | --- |
| `isPaidOutcome(result)` | `outcome === 'succeeded'` **and** paid-like status (`paid` only; not `approved` / `authorized`) |
| `isRequiresActionOutcome(result)` | Customer action required |
| `isIndeterminateOutcome(result)` | Explicit indeterminate / must reconcile |
| `mapGatewayResultToOperationResult(result)` | Gateway shape → preferred union |
| `applyOutcomeToGatewayResult(base, outcome)` | Write `outcome` + `references` |
| `inferOperationOutcome(result)` | Infer when gateway has not set `outcome` yet |
| `buildProviderReferences(input)` | Structured provider IDs |
## Throw vs outcome (policy)

Aligned with Engineering Rule 3 (uncertain outcomes must not become failure):

1. **Pre-submit / validation / auth config** may **throw** (`InvalidRequestError`, `GatewayNotConfiguredError`, …).
2. **Transport errors before the provider may have accepted the mutation** may **throw** (`NetworkError`).
3. **After submit is ambiguous** (timeout after request may have been accepted, unknown idempotency replay): return **`outcome: 'indeterminate'`** with **`reconciliationRequired: true`**. Do **not** map to `failed` / decline.
4. **Hard declines** may appear as `outcome: 'declined'` **or** (0.x) as thrown `CardDeclinedError` / `InsufficientFundsError`. Integrators should handle both until gateways fully migrate to outcome arms.

The testkit encodes this:

- `{ outcome: 'timeout' }` / `{ outcome: 'network_error' }` → throw `NetworkError`
- `{ outcome: 'indeterminate' }` → result with `outcome: 'indeterminate'`, `reconciliationRequired: true`
- `{ outcome: 'provider_ok_client_timeout' }` → provider-side paid success retained; client throws `NetworkError`

## Common inputs vs provider extensions (1.0)

`CommonPaymentInput` is the shared create shape **without** provider keys:

```ts
type CommonPaymentInput = {
  amount: AmountInput; // money("10.50", "SAR")
  orderId?: string;
  description?: string;
  metadata?: PaymentMetadata;
};
```

`CreatePaymentParams` is **closed** in 1.0: only `CommonPaymentInput` + `currency` + `callbackUrl` + `capture`/`idempotencyKey`/`customerId`/`paymentMethodId`/`offSession`. Provider fields live on per-gateway `MoyasarCreatePaymentParams`, `StripeCreatePaymentParams`, `PayPalCreatePaymentParams`, `PaymobCreatePaymentParams` via `createPaymentClient` registry. `tokenId` was removed (use `moyasarSource: {type:'token', token}`).

| Union | Use for |
| --- | --- |
| `PaymentDomainStatus` (=`PaymentStatus`) | Charge / intent lifecycle (`pending`,`paid`,...) |
| `AuthorizationStatus` | Auth holds |
| `CaptureStatus` | Capture lifecycle |
| `RefundDomainStatus` (=`RefundStatus`) | Refund objects (`pending`,`completed`,`failed`) |
| `SetupTokenStatus` | Setup / vault |
| `WebhookEnvelopeStatus` | `WebhookEvent.status` (`PaymentDomainStatus` \| `RefundDomainStatus` \| `SetupTokenStatus`) |
| `GatewayPaymentStatus` | `GatewayPaymentResult.status` — envelope plus legacy `refund_*`/`setup_completed` aliases for gateway internal mapping (prefer `WebhookEnvelopeStatus` values) |
| `DisputeStatus` | Disputes |
```ts
import { buildProviderReferences } from '@paykernel/core';

const references = buildProviderReferences({
  gateway: 'paypal',
  gatewayId: orderId,
  status: 'pending',
  orderId,
  captureId,
  authorizationId,
  providerNativeStatus: 'CREATED',
});
```

| Field | Meaning |
| --- | --- |
| `providerObjectId` | Primary provider object id (also dual-written as `gatewayId`) |
| `providerRequestId` | Provider request / correlation id when available |
| `internalReference` | Merchant order / internal correlation |
| `parentId` | Parent resource when this is a child |
| `relatedIds` | order / capture / authorization / refund / charge / customer |
| `providerNativeStatus` | Unnormalized provider string |
| `normalizedStatus` | SDK-normalized status |
| `gateway` | Gateway id |
## Refund outcomes (1.0)

Refunds use `RefundOperationOutcome` / `RefundOperationResult` via `mapGatewayRefundToOperationResult`:

| `outcome` | Typical `status` |
| --- | --- |
| `succeeded` | `completed` |
| `pending` | `pending` |
| `failed` | `failed` |
| `indeterminate` | (ambiguous) + `reconciliationRequired: true` |

`applyOutcomeToGatewayRefundResult(base, outcome)` writes `outcome` (+ `reconciliationRequired` when indeterminate) — no `success`.

| Helper | Role |
| --- | --- |
| `applyOutcomeToGatewayRefundResult(base, outcome)` | Write `outcome` (+ `reconciliationRequired` when indeterminate) |
| `inferRefundOperationOutcome(result)` | Infer / coerce when branching on refund outcomes |
| `mapGatewayRefundToOperationResult(result)` | Gateway refund shape → preferred refund union |

**P610-INF-2 (refunds):** `{ outcome: 'indeterminate' }` or
`reconciliationRequired: true` on refund infers **`indeterminate`**, not
`failed`. A forged decline would invite a retry and can **double-refund**.
Bare refund `status: 'pending'` (no recon flag) infers **`pending`**, not
indeterminate and not failed.
Reconcile; do not retry the mutation as a fresh failure.

**CORE-INF-2:** bare refund `status: 'completed'` infers **`succeeded`**.
Indeterminate only when `reconciliationRequired` or an explicit indeterminate
marker is set — do not retry a completed refund as a fresh failure.

Do not treat a pending refund as settled. Same Engineering Rule 3 applies after
submit when the refund request may have been accepted.

**CORE-5:** `applyOutcomeToGatewayResult` coerces stored `outcome`
against `status`. `outcome: 'succeeded'` with `status: 'failed'` /
`'refund_failed'` becomes **`declined` only when a `decline` object is
present, otherwise `failed`**. With `status: 'pending'` / `'processing'` /
`'approved'` / `'partially_captured'` / `'refund_completed'` /
`'refund_pending'` it becomes `requires_action`. Callers branching on
`result.outcome === 'succeeded'` must not see a failed or still-pending payment
as a successful operation.

**NEW-CORE-10:** `outcome: 'requires_action'` or `'succeeded'` with
`status: 'failed'` / `'refund_failed'` is stored and inferred as **`declined`
only when a `decline` object is present; otherwise `failed`**. A failed
snapshot is not customer action.

**NEW-CORE-9:** Bare payment infer: `refund_completed` / `refund_pending` →
**`requires_action`**; `reversed` → **`failed`**. Not indeterminate.
Refund coerce: `outcome: 'failed'` + gateway `status: 'completed'` becomes
**`succeeded`** (status wins — a settled refund is not a fresh-fail retry).

**CORE-7:** Post-submit create / OTP / capture / refund / void timeouts return
`outcome: 'indeterminate'` with `gatewayId` taken from params when present
(`gatewayPaymentId`, `orderId`, `transactionUrl`, `idempotencyKey`, …). Create
without any of those ids still uses `gatewayId: 'unknown'` because the provider
has not assigned an object id — reconcile via the idempotency store / inquiry,
not `getPayment('unknown')`.

## After-hook freeze

Money/identity fields restored after after-hooks include (when present): `outcome`, `status`, `amount`, `gatewayId`, capture/order/authorization/refund IDs, fees, `capturedAmount`, `refundedAmount`, `clientSecret`, `references`, `decline`, `reconciliationRequired`, `providerRequestId`. Restore runs **between** composed after-hooks as well as on the client return path, so a later handler cannot see a previous hook's forged paid/status/amount. After-hooks cannot flip a paid result into declined or invent a paid status.
## Migration checklist (0.x apps)

1. **Fulfillment:** replace `if (result.success)` with `if (isPaidOutcome(result))` (or `outcome === 'succeeded'` + paid-like `status`).
2. **3DS / redirect:** branch on `isRequiresActionOutcome(result)` / `outcome === 'requires_action'` (and `nextAction` / `redirectUrl`) — do not treat as paid.
3. **Declines:** handle both thrown `CardDeclinedError` / `InsufficientFundsError` **and** `outcome: 'declined'` when present.
4. **Timeouts / ambiguous mutations:** never map to “order failed” without reconciliation; prefer `isIndeterminateOutcome` / `reconciliationRequired` when results expose it; otherwise reconcile on `NetworkError` after submit.
5. **IDs:** read `result.references?.providerObjectId` when available; keep reading `gatewayId` / `orderId` / `captureId` for dual-write compatibility.
6. **Inputs:** prefer `money("10.50", "SAR")` and provider-typed create params; avoid putting provider keys on shared helpers that take only `CommonPaymentInput`.
7. **Tests:** use `@paykernel/testkit` `mockGateway` — scripted outcomes dual-write Phase 6 fields so app tests learn the real shape.
8. **Do not** remove reading `success` yet if you support older dual-write paths; treat it as deprecated for money decisions only.

## Related

- [Safe money model](./money.md)
- [Behavioral contracts](./behavioral-contracts.md)
- [Custom gateways](./custom-gateways.md) — adapters should dual-write `outcome` + `references`
- [Testkit](../../testkit/README.md) — mock outcomes map to Phase 6 result shape
- README production checklist: fulfill on paid status / `isPaidOutcome`, not `success` alone
