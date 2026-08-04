# @paykernel/core

## Unreleased

### Behavior (0.x)

- **BREAKING (fulfillment helpers):** Domain status `approved` (PayPal buyer approval, pre-capture) is **no longer paid-like**. `PAID_LIKE_PAYMENT_STATUSES` is `paid` only; `isPaidLikePaymentStatus('approved')` and `isPaidOutcome(...)` for approved results are **false**. PayPal `mapPayPalOutcome` and `inferOperationOutcome` map uncaptured `approved` to `requires_action` (not `succeeded`), aligning operation helpers with webhook `CHECKOUT.ORDER.APPROVED` → `payment.processing`. Capture `COMPLETED` / `status: 'paid'` still yields `isPaidOutcome` true. Fulfill only on captured paid — never ship on approval alone.

### Patch

- PayPal `PAYMENT.REFUND.COMPLETED` is now parsed as `status=refunded` with Phase 7 dual-write `refund.completed` (was map-only; parse threw Unsupported).
- **Paymob dual-write (amount-only refunds / auth+capture):** Phase 7 stable-type mapping prefers normalized `WebhookEvent.status` and amount-derived refund/capture signals over bare `success` / sticky `is_auth`. Amount-only `refunded_amount_cents` TRANSACTION webhooks dual-write `refund.completed` (not `payment.succeeded`). `is_auth` + full `captured_amount` dual-writes `payment.succeeded` when status is `paid` (not `payment.authorized`). Failed refund/void action callbacks dual-write `payment.failed` in agreement with status. Optional `ProviderEventMapContext.amounts` minor-unit fields support amount-aware dual-write.
- **Paymob redirect honesty (N1):** `TRANSACTION_RESPONSE` (browser/redirect) success, paid, or capture signals dual-write **`payment.processing`**, never `payment.succeeded` / `capture.completed`. Processed server `TRANSACTION` webhooks still settle as before. Prefer fulfill on processed TRANSACTION + settlement stable type (or inquiry + `isPaidOutcome`); do not fulfill on redirect-only.
- **Paymob partial capture dual-write (N2/N7):** `partially_captured` (status or amount-derived partial capture without `is_capture`) dual-writes **`payment.processing`**, not `payment.succeeded`, so type-only fulfillment matches `isPaidOutcome` (partial excluded). Explicit `is_capture` + success still maps to `capture.completed` (amount-aware).


## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
