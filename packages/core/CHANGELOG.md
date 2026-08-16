# @paykernel/core

## Unreleased

### Behavior (0.x)

- **Deep audit 2026-08-16:** Uncertain refunds (`success: false` / omitted + `pending`) are `indeterminate`, not `failed`. Stripe `refund.failed` maps to `refund_failed` (does not overwrite payment status). Succeeded PaymentIntents read charge refunds; unexpanded `latest_charge` fail-closes to `processing`. PayPal `CAPTURE.REFUNDED` on a refund resource is `partially_refunded`, not full `refunded`; `ORDER.COMPLETED` does not invent paid from a capture-id string. Paymob Intention HTTP 200 missing id/URL keeps the create fence. After-hooks freeze money/identity between composed handlers. `handleWebhook` awaits a thenable `verifyWebhook` and rejects thin 3-field `PaymentEvent`s. Moyasar incomplete `refund_completed` inquiry is `requires_action`, not `succeeded`.
- **PayPal partial auth capture dual-write (N11):** `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` dual-writes stable type **`payment.processing`** (was `capture.completed`) with domain status `partially_captured`. Type-only fulfillment must not treat partial auth capture as full settlement; `isPaidOutcome` remains false. Full `PAYMENT.AUTHORIZATION.CAPTURED` / `PAYMENT.CAPTURE.COMPLETED` still map to `capture.completed`.
- **Paymob partial capture outcome (N12):** `mapPaymobOutcome` demotes status `partially_captured` to **`requires_action`** (not `succeeded`) so outcome-only callers cannot fulfill remaining uncaptured funds. Auth holds still use `outcome: 'succeeded'` with `isPaidOutcome` false. **Always use `isPaidOutcome` / `status === 'paid'` for fulfillment.**
- **Paymob inquiry success fail-closed (N13):** `getPayment` defaults missing transaction `success` to **`false`** (was `true`). Paid/authorized paths cannot invent success when Paymob omits the field; amount-derived refunds still surface honestly.

- **Stripe partial PI success dual-write:** `payment_intent.succeeded` with status `partially_captured` (`amount_received < amount`) now dual-writes **`payment.processing`**, not `payment.succeeded`. Full paid still maps to `payment.succeeded`. Aligns type-only fulfillment with `isPaidOutcome` / Paymob partial policy — do not fulfill remaining uncaptured funds on stable type alone.
- **Stripe `charge.refunded` incomplete snapshots:** when `refunded !== true` and `amount_refunded` is missing/non-finite, status is **`refund_completed`** (not fail-open full `refunded`), matching safer refund-object incomplete handling.
- **BREAKING (fulfillment helpers):** Domain status `approved` (PayPal buyer approval, pre-capture) is **no longer paid-like**. `PAID_LIKE_PAYMENT_STATUSES` is `paid` only; `isPaidLikePaymentStatus('approved')` and `isPaidOutcome(...)` for approved results are **false**. PayPal `mapPayPalOutcome` and `inferOperationOutcome` map uncaptured `approved` to `requires_action` (not `succeeded`), aligning operation helpers with webhook `CHECKOUT.ORDER.APPROVED` → `payment.processing`. Capture `COMPLETED` / `status: 'paid'` still yields `isPaidOutcome` true. Fulfill only on captured paid — never ship on approval alone.

### Patch

- **Docs (N16):** Moyasar/Paymob capture/refund/void multi-worker double-mutate footgun clarified in gateway docs and behavioral contracts — shared `idempotencyStore` + `idempotencyKey` required for safe multi-worker mutations (store remains API-optional).

- PayPal `PAYMENT.REFUND.COMPLETED` is now parsed as `status=refunded` with Phase 7 dual-write `refund.completed` (was map-only; parse threw Unsupported).
- **Paymob dual-write (amount-only refunds / auth+capture):** Phase 7 stable-type mapping prefers normalized `WebhookEvent.status` and amount-derived refund/capture signals over bare `success` / sticky `is_auth`. Amount-only `refunded_amount_cents` TRANSACTION webhooks dual-write `refund.completed` (not `payment.succeeded`). `is_auth` + full `captured_amount` dual-writes `payment.succeeded` when status is `paid` (not `payment.authorized`). Failed refund/void action callbacks dual-write `payment.failed` in agreement with status. Optional `ProviderEventMapContext.amounts` minor-unit fields support amount-aware dual-write.
- **Paymob redirect honesty (N1):** `TRANSACTION_RESPONSE` (browser/redirect) success, paid, or capture signals dual-write **`payment.processing`**, never `payment.succeeded` / `capture.completed`. Processed server `TRANSACTION` webhooks still settle as before. Prefer fulfill on processed TRANSACTION + settlement stable type (or inquiry + `isPaidOutcome`); do not fulfill on redirect-only.
- **Paymob partial capture dual-write (N2/N7):** `partially_captured` (status or amount-derived partial capture without `is_capture`) dual-writes **`payment.processing`**, not `payment.succeeded`, so type-only fulfillment matches `isPaidOutcome` (partial excluded). Explicit `is_capture` + success still maps to `capture.completed` (amount-aware).


## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
