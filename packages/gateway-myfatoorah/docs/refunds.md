# Refunds

`refundPayment` requires `idempotencyKey` and `gatewayPaymentId` = the **InvoiceId** (digits).

Flow:

1. `POST /v2/GetRefundStatus` (`KeyType: InvoiceId`) — refund list
2. `POST /v2/GetPaymentStatus` — invoice value + currency (from the success transaction)
3. `remaining = InvoiceValue − (Refunded/Pending refunds)`. Canceled refunds do not count. Negative or unparseable remaining fails closed
4. Remaining `0` → map the nested refund matching this `idempotencyKey` (`ExternalIdentifier`); otherwise `InvalidRequestError` — never re-POST the invoice amount
5. `POST /v2/MakeRefund` with `ServiceChargeOnCustomer: false`, `Amount`, `ExternalIdentifier: idempotencyKey`, optional `Comment` (`myfatoorahComment` or trimmed `reason`, max 500 chars)

`currency` must match the invoice currency when provided. Caller `amount` greater than remaining throws.

MakeRefund acceptance is **never** settlement: the result is `pending` / `refund_pending`. Fulfill refunds only after a `REFUND_STATUS_CHANGED` webhook with `Refund.Status=REFUNDED` (or `GetRefundStatus` `Refunded`).
