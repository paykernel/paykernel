# Operation results & outcomes (Phase 6)

Prefer **`outcome`** discrimination over the legacy **`success: boolean`** field when deciding what to do after `createPayment` / `capturePayment` / `getPayment`.

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

**Post-submit transport (P610-IND-1):** `createPayment` / `capturePayment` / `refundPayment` / `voidPayment` no longer throw `NetworkError` when the mutating HTTP request may already have been accepted (timeout, connection drop, or 5xx after POST). `BaseGateway` returns `outcome: 'indeterminate'` + `reconciliationRequired: true`. Preflight auth and GET still throw `NetworkError`. Caller abort still throws `PaymentAbortedError`.

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

## Dual-write: `success` from `outcome`

When gateways (or the testkit mock) use `applyOutcomeToGatewayResult`:

| `outcome` | `success` | Notes |
| --- | --- | --- |
| `succeeded` | `true` | Check `status` for paid vs authorized |
| `requires_action` | `true` | API OK; customer action needed |
| `declined` | `false` | Definitive decline |
| `failed` | `false` | Definitive failure |
| `indeterminate` | `false` | **Not** a decline — always `reconciliationRequired: true` |

`success: false` + `outcome: 'indeterminate'` means “do not treat as paid,” **not** “safe to mark order failed without reconciliation.”

`applyOutcomeToGatewayResult` attaches `reconciliationRequired: true` **only** when `outcome` is `indeterminate`. Passing `extras.reconciliationRequired` on a succeeded / requires_action / declined / failed write is ignored so stored `outcome` still matches `inferOperationOutcome` (no dual-write lie).

Bare inference (no explicit `outcome`):

| `success` | `status` | inferred `outcome` |
| --- | --- | --- |
| `true` | `paid` / `authorized` / `refunded` / `partially_refunded` | `succeeded` (fulfill only when `paid`) |
| `true` | `partially_captured` | `requires_action` (open money) |
| `true` | `pending` / `processing` / `approved` | `requires_action` |
| `false` | `pending` / `processing` / `approved` | `indeterminate` (not `failed`) |
| `false` | `failed` | `declined` |
| `false` | `cancelled` | `failed` |

### Helpers

| Helper | Role |
| --- | --- |
| `isPaidOutcome(result)` | `outcome === 'succeeded'` **and** paid-like status (`paid` only; not `approved` / `authorized`) |
| `isRequiresActionOutcome(result)` | Customer action required |
| `isIndeterminateOutcome(result)` | Explicit indeterminate / must reconcile |
| `mapGatewayResultToOperationResult(result)` | Gateway shape → preferred union |
| `applyOutcomeToGatewayResult(base, outcome)` | Dual-write `outcome` + `success` + `references` |
| `successFromOutcome(outcome)` | Map outcome → deprecated `success` boolean |
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

## Common inputs vs provider extensions

`CommonPaymentInput` is the shared create shape **without** provider keys:

```ts
type CommonPaymentInput = {
  amount: AmountInput; // prefer money("10.50", "SAR")
  orderId?: string;
  description?: string;
  metadata?: PaymentMetadata;
};
```

`CreatePaymentParams` still allows optional `stripe*` / `moyasar*` / `paypal*` / `paymob*` fields for 0.x convenience. Prefer typed extensions (`MoyasarCreatePaymentParams`, `StripeCreatePaymentParams`, …) or extend `CommonPaymentInput` in custom adapters so common code never sees provider pollution.

## Domain status unions vs legacy `PaymentStatus`

Prefer domain-specific unions instead of inventing cross-domain mega statuses:

| Union | Use for |
| --- | --- |
| `PaymentDomainStatus` | Charge / intent lifecycle |
| `AuthorizationStatus` | Auth holds |
| `CaptureStatus` | Capture lifecycle |
| `RefundDomainStatus` (= `RefundStatus`) | Refund objects |
| `SetupTokenStatus` | Setup / vault |
| `DisputeStatus` | Disputes |
| `TransferStatus` / `PayoutStatus` | Transfers / payouts |

Legacy `PaymentStatus` remains the 0.x mega-union (includes `refund_*` and `setup_completed`) and is **deprecated** for new modeling. Webhook payloads still use the legacy union in Phase 6 (webhook rewrite is Phase 7).

## ProviderReferences

Prefer structured `references: ProviderReferences` on results while dual-writing legacy flat ids:

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

## Refund outcomes

Refunds use a separate discriminant (`RefundOperationOutcome` /
`RefundOperationResult`) via `mapGatewayRefundToOperationResult`:

| `outcome` | Typical `status` | `success` (deprecated) |
| --- | --- | --- |
| `succeeded` | `completed` | `true` |
| `pending` | `pending` | `true` |
| `failed` | `failed` | `false` |
| `indeterminate` | (ambiguous) | `false` + `reconciliationRequired` |

### Dual-write on built-in refunds (0.x)

Built-in gateways (Stripe, Moyasar, PayPal, Paymob) and the testkit mock dual-write
`outcome` + `success` on `GatewayRefundResult` via `applyOutcomeToGatewayRefundResult`,
mirroring payment dual-write with `applyOutcomeToGatewayResult`:

- `success` is derived only from outcome (`successFromRefundOutcome`) — never forged
  from a failed status into `succeeded`.
- `outcome: 'indeterminate'` always sets `reconciliationRequired: true`.
- Callers may still use `mapGatewayRefundToOperationResult` / `inferRefundOperationOutcome`
  when `outcome` is absent (older results or custom adapters).

| Helper | Role |
| --- | --- |
| `applyOutcomeToGatewayRefundResult(base, outcome)` | Dual-write `outcome` + `success` (+ `reconciliationRequired` when indeterminate) |
| `successFromRefundOutcome(outcome)` | Map refund outcome → deprecated `success` boolean |
| `inferRefundOperationOutcome(result)` | Infer / coerce when branching on refund outcomes (see below) |
| `mapGatewayRefundToOperationResult(result)` | Gateway refund shape → preferred refund union |

**CORE-1:** `inferRefundOperationOutcome` coerces an explicit `outcome` against
gateway `status` (same family as payment `inferOperationOutcome`). Bare
`outcome: 'succeeded'` with `status: 'pending'` returns `'pending'`; bare
`outcome: 'pending'` with `status: 'completed'` returns `'succeeded'`. Prefer
`mapGatewayRefundToOperationResult` for Phase-6 union shapes; bare infer is safe
for status-consistent branching only after this coerce.

**P610-INF-2 (refunds):** `{ success: false, status: 'pending' }` (or omitted
`success` with `pending` / `processing` / `approved`) infers **`indeterminate`**,
not `failed`. A forged decline would invite a retry and can **double-refund**.
Reconcile; do not retry the mutation as a fresh failure.

Do not treat a pending refund as settled. Same Engineering Rule 3 applies after
submit when the refund request may have been accepted.

**CORE-5:** `applyOutcomeToGatewayResult` coerces stored `outcome` / `success`
against `status`. `outcome: 'succeeded'` with `status: 'failed'` becomes
`declined` + `success: false`; with `status: 'pending'` / `'processing'` /
`'approved'` it becomes `requires_action`. Callers branching on
`result.outcome === 'succeeded'` must not see a failed or still-pending payment
as a successful operation.

**CORE-7:** Post-submit create / OTP / capture / refund / void timeouts return
`outcome: 'indeterminate'` with `gatewayId` taken from params when present
(`gatewayPaymentId`, `orderId`, `transactionUrl`, `idempotencyKey`, …). Create
without any of those ids still uses `gatewayId: 'unknown'` because the provider
has not assigned an object id — reconcile via the idempotency store / inquiry,
not `getPayment('unknown')`.

## After-hook freeze

Money/identity fields restored after after-hooks include (when present): `success`, `outcome`, `status`, `amount`, `gatewayId`, capture/order/authorization/refund IDs, fees, `capturedAmount`, `refundedAmount`, `clientSecret`, `references`, `decline`, `reconciliationRequired`, `providerRequestId`. Restore runs **between** composed after-hooks as well as on the client return path, so a later handler cannot see a previous hook's forged paid/status/amount. After-hooks cannot flip a paid result into declined or invent a paid status.

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
