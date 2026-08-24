# Refunds

`refundPayment` requires `idempotencyKey` and `gatewayPaymentId` = the **InvoiceId** (digits).

Flow:

1. `POST /v2/GetRefundStatus` (`KeyType: InvoiceId`) — official `Data.RefundStatusResult[]` (legacy `Refunds` still accepted). Each entry has `RefundId`, `RefundStatus`, `Amount`/`RefundAmount`, `BaseCurrency` (account base, e.g. KWD), `ExternalIdentifier`.
2. `POST /v2/GetPaymentStatus` — invoice value + currency (from `InvoiceTransactions`; official field is `InvoiceTransactions`, legacy `Transactions` fallback; `"KD"` alias → `"KWD"`). `InvoiceValue` is base currency.
3. `remaining = InvoiceValue − (Refunded/Pending refunds)`. Canceled refunds do not count. Negative or unparseable remaining fails closed; empty refund list → `remaining = InvoiceValue` (no refunds yet). Amounts compared via minor units to avoid IEEE error. If caller supplies `amount` and remaining cannot be parsed, validation against remaining is skipped (fail-open for explicit amount).
4. Remaining `0` → map the nested refund matching this `idempotencyKey` (`ExternalIdentifier`); otherwise `InvalidRequestError` — never re-POST the invoice amount. Lookup handles both `RefundStatusResult` and `Refunds` shapes.
5. `POST /v2/MakeRefund` with `ServiceChargeOnCustomer: false`, `Amount` (**account base currency**, not display/pay currency), `ExternalIdentifier: idempotencyKey`, optional `Comment` (`myfatoorahComment` or trimmed `reason`, max 500 chars), `KeyType: InvoiceId`, `Key: invoiceId`. `currency` must match the **base currency** (`RefundStatusResult[].BaseCurrency` when present, otherwise invoice currency) — mismatch throws.

MakeRefund acceptance is **never** settlement: the result is `pending` / `refund_pending`. Fulfill refunds only after a `REFUND_STATUS_CHANGED` webhook with `Refund.Status=REFUNDED` (or `GetRefundStatus` `Refunded`). `Idempotency-Key` header is only honored in KWT/SAU; elsewhere a provider `Idempotency` validation error retries once without the header (`ExternalIdentifier` still deduplicates for replay).
