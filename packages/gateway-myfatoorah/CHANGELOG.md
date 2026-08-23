# @paykernel/gateway-myfatoorah

## Unreleased

### Minor

- **Phase 23:** first-party portable MyFatoorah adapter (`myfatoorahGateway` / `MyFatoorahGateway`). V3 hosted payments (sale), refunds via MakeRefund, and Webhook V2 HMAC-SHA256 signatures. Conservative capability claims. Not a core built-in.

### Patch

- **MYF-CREATE-KEY:** `createPayment` requires a caller `idempotencyKey`, sent as the `Idempotency-Key` header (official cache: 250 minutes). The adapter does not mint an ephemeral UUID.
- **MYF-AMOUNT-TOKEN:** Mutating JSON amounts are ISO-padded **number** tokens on the wire (`Order.Amount` / `Amount` as `10.50` SAR, `1.200` KWD), never strings and never float-multiplied.
- **MYF-NO-AUTH:** `capture: false` is rejected (`authorization` unclaimed). `capturePayment` throws `OperationNotSupportedError`. `voidPayment` is not implemented.
- **MYF-REDIRECT:** `PaymentURL` maps to `requires_action` + `redirectUrl`; `PaymentCompleted` + paid evidence maps to `succeeded` / `paid` with no redirect.
- **MYF-WEBHOOK-SECRET:** Webhook verification uses a separate `webhookSecret` (portal secure key), never the API token. Missing secret or header fails closed (`false`).
- **MYF-REFUND-PENDING:** MakeRefund results are `refund_pending` / `pending`, not `completed`. Settlement arrives via `REFUND_STATUS_CHANGED` or `GetRefundStatus` `Refunded`.
- **MYF-REFUND-REMAINING:** Refund amount defaults to remaining (`InvoiceValue` − non-canceled refunds). Remaining `0` maps the nested refund for this `idempotencyKey` or throws — never re-POSTs the invoice amount.
- **MYF-INVOICE-ID:** `gatewayId` is the InvoiceId. `getPayment` uses `POST /v2/GetPaymentStatus` (never `GET /v3/invoices/{id}` for unpaid invoices).
- **MYF-PCI:** `SourceOfFund.Card` / raw card objects are rejected before any fetch. Only `myfatoorahSessionId` (SessionId) or `myfatoorahToken` (Token) are sent.
- **MYF-METADATA:** Create `metadata` accepts only `UDF1`..`UDF5` string values.
- **MYF-REFUND-RETRY:** MakeRefund is not auto-retried after submit (no provider dedupe of `ExternalIdentifier`). Create IS retried (header dedupe).
