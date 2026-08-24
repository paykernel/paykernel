# @paykernel/gateway-myfatoorah

## Unreleased

### Minor

- **Phase 23:** first-party portable MyFatoorah adapter (`myfatoorahGateway` / `MyFatoorahGateway`). V3 hosted payments (sale), refunds via MakeRefund, and Webhook V2 HMAC-SHA256 signatures. Conservative capability claims. Not a core built-in.

### Patch

- **MYF-CREATE-KEY:** `createPayment` requires a caller `idempotencyKey`, sent as the `Idempotency-Key` header **only in KWT/SAU** (https://docs.myfatoorah.com/docs/idempotency — omitted elsewhere). Official cache: 250 minutes. The adapter does not mint an ephemeral UUID. 2xx `IsSuccess:false` `ValidationErrors`/`FieldsErrors` string-body `Idempotency` rejections are retried once without the header; that headerless retry never auto-retries after submit (no double-charge).
- **MYF-AMOUNT-TOKEN:** Mutating JSON amounts are ISO-padded **number** tokens on the wire (`Order.Amount` / `Amount` as `10.50` SAR, `1.200` KWD), never strings and never float-multiplied.
- **MYF-NO-AUTH:** `capture: false` is rejected (`authorization` unclaimed). `capturePayment` throws `OperationNotSupportedError`. `voidPayment` is not implemented.
- **MYF-REDIRECT:** `PaymentURL` maps to `requires_action` + `redirectUrl`; `PaymentCompleted` + paid evidence maps to `succeeded` / `paid` with no redirect. Paid `PaymentId` also checked at `TransactionDetails.Transaction.PaymentId`.
- **MYF-WEBHOOK-SECRET:** Webhook verification uses a separate `webhookSecret` (portal secure key), never the API token. Missing secret or header fails closed (`false`). `Event.Code` `1`/`2` accepted as number or string `"1"`/`"2"`.
- **MYF-REFUND-PENDING:** MakeRefund results are `refund_pending` / `pending`, not `completed`. Settlement arrives via `REFUND_STATUS_CHANGED` or `GetRefundStatus` `Refunded`. `ReferencedInvoice.ExternalIdentifier` (never the refund `ExternalIdentifier` idempotency key) is `paymentId` on refund webhooks.
- **MYF-REFUND-REMAINING:** Refund amount defaults to remaining (`InvoiceValue` − non-canceled refunds). **Any existing refund with `ExternalIdentifier === idempotencyKey` is returned before `MakeRefund`, even for partial refunds (idempotent replay).** Remaining `0` with no match throws — never re-POSTs the invoice amount. Lookup handles both `RefundStatusResult` and `Refunds` shapes.
- **MYF-INVOICE-ID:** `gatewayId` is the InvoiceId. `getPayment` uses `POST /v2/GetPaymentStatus` (never `GET /v3/invoices/{id}` for unpaid invoices). `SR`→`SAR`/`KD`→`KWD` aliased. Paid amount prefers `PaidCurrencyValue`+`PaidCurrency` (pay currency, matching paid create); `InvoiceValue`+`Currency` (base) is the fallback.
- **MYF-PCI:** `SourceOfFund.Card` / raw card objects are rejected before any fetch. Only `myfatoorahSessionId` (SessionId) or `myfatoorahToken` (Token) are sent.
- **MYF-METADATA:** Create `metadata` accepts only `UDF1`..`UDF5` string values.
- **MYF-REFUND-RETRY:** MakeRefund is not auto-retried after submit (no provider dedupe of `ExternalIdentifier`). Create IS retried (header dedupe in KWT/SAU). `Idempotency-Key` header is **omitted outside KWT/SAU**. `orderId` is now sent as both `Order.ExternalIdentifier` and `Customer.Reference` so webhooks reliably carry it as `Invoice.ExternalIdentifier`. `MakeRefund` is **base currency only** (e.g. KWD).
- **MYF-REFUND-BASE:** First refund with empty history infers the account base currency from the portal country (KWD/SAR/BHD/… per ISO lookups) and fails closed on pay-currency amounts. `GetRefundStatus` 2xx with `Data: null` (nullable per OpenAPI) is an empty refund history.
- **MYF-WH-STRICT:** Webhook `KD`/`SR` currency aliases normalize to ISO. Signature header accepts `string[]` values. `callbackUrl`/`webhookUrl` reject localhost. V3 `PaymentMethod` allowlist is `CARD`/`APPLE_PAY`/`GOOGLE_PAY`/`KNET`/`INVOICE` — regional methods (`BENEFIT`, `MADA`, `STC_PAY`, `QPAY`, `OMANNET`) remain `DisplayPaymentMethods` lowercase tokens.
