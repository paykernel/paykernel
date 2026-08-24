# Refunds

`refundPayment` requires `idempotencyKey` and `gatewayPaymentId` = the **InvoiceId** (digits).

Flow:

1. `POST /v2/GetRefundStatus` (`KeyType: InvoiceId`) — official `Data.RefundStatusResult[]` (legacy `Refunds` still accepted). Each entry has `RefundId`, `RefundStatus`, `Amount`/`RefundAmount`, `BaseCurrency` (account base, e.g. KWD), `ExternalIdentifier`.
2. `POST /v2/GetPaymentStatus` — invoice value + currency (from `InvoiceTransactions`; official field is `InvoiceTransactions`, legacy `Transactions` fallback; `"KD"` alias → `"KWD"`). `InvoiceValue` is base currency.
3. `remaining = InvoiceValue − (Refunded/Pending refunds)`. Canceled refunds do not count. Negative or unparseable remaining **fails closed** (even with explicit `amount`); empty refund list → `remaining = InvoiceValue` (no refunds yet). Amounts compared via minor units to avoid IEEE error. **Before any `MakeRefund`, if any `RefundStatusResult` entry has `ExternalIdentifier` exactly equal to this `idempotencyKey`, that refund is returned immediately (idempotent partial-refund replay) — `MakeRefund` is never re-POSTed, even when `remaining > 0`.**
4. Remaining `0` with no matching `ExternalIdentifier` → `InvalidRequestError` — never re-POST the invoice amount and never map a single unkeyed refund to an unrelated key. Lookup handles both `RefundStatusResult` and `Refunds` shapes.
5. `POST /v2/MakeRefund` with `ServiceChargeOnCustomer: false`, `Amount` (**account base currency**, not display/pay currency — e.g. KWD when you charged SAR), `ExternalIdentifier: idempotencyKey`, optional `Comment` (`myfatoorahComment` or trimmed `reason`, max 500 chars), `KeyType: InvoiceId`, `Key: invoiceId`. `currency` must match the **base currency** (`RefundStatusResult[].BaseCurrency` when present; first refund with empty history uses the caller `currency` as base — pass KWD/base explicitly when you charged a different currency) — mismatch throws.
MakeRefund acceptance is **never** settlement: the result is `pending` / `refund_pending`. Fulfill refunds only after a `REFUND_STATUS_CHANGED` webhook with `Refund.Status=REFUNDED` (or `GetRefundStatus` `Refunded`). `Idempotency-Key` header is only honored in KWT/SAU; elsewhere a provider `Idempotency` validation error retries once without the header (`ExternalIdentifier` still deduplicates for replay).
