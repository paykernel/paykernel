# MyFatoorah adapter overview

`@paykernel/gateway-myfatoorah` is a portable `GatewayAdapter<"myfatoorah", MyFatoorahGateway>` for [`createPaymentClient`](../../core/docs/plugin-architecture.md).

- **API base:** sandbox `https://apitest.myfatoorah.com/`; live hosts by portal country (`api`, `api-ae`, `api-sa`, `api-qa`, `api-eg`)
- **Auth:** `Authorization: Bearer <apiToken>` (config `apiToken` is trimmed; whitespace-only is invalid)
- **Surface:** V3 hosted payments (`POST /v3/payments`), V2 inquiry/refund (`GetPaymentStatus`, `MakeRefund`, `GetRefundStatus`), Webhook V2 signatures
- **IDs:** `gatewayId` is the **InvoiceId**. PaymentId (when present) rides `references.relatedIds.paymentId`
- **Customer:** optional (`myfatoorahCustomer` or `customerId` → `{ Reference }`; `orderId` is also sent as `Customer.Reference` so the payment webhook `Invoice.ExternalIdentifier` carries it)
- **Redirect:** `PaymentURL` → `requires_action` + `redirectUrl`. `callbackUrl` → `IntegrationUrls.Redirection`
- **No auth/capture/void:** `capture: false` and `capturePayment` throw `OperationNotSupportedError` (capability `authorization`). `voidPayment` is not implemented
- **Idempotency:** `createPayment` requires a caller `idempotencyKey`, sent as the `Idempotency-Key` header **only in KWT/SAU** (omitted elsewhere). Refunds also require the key (`ExternalIdentifier` + header only in KWT/SAU). Header 2xx `IsSuccess:false` `ValidationErrors`/`FieldsErrors` string-body rejections are retried once without the header. `SR`→`SAR` aliased. Any existing `ExternalIdentifier === idempotencyKey` refund is returned before `MakeRefund` (partial-replay safe)
- **Refunds:** MakeRefund is **base currency only** (e.g. KWD), never display/pay (e.g. SAR). Results are `refund_pending`, never `completed`. Settlement arrives via `REFUND_STATUS_CHANGED` or `GetRefundStatus` `Refunded`. `PaymentId` on refunds is `ReferencedInvoice.ExternalIdentifier`
- **Amount:** must be `> 0`. JSON amounts are ISO-padded number tokens (`10.50` / `1.200`), never strings
- **Webhooks:** separate `webhookSecret` (portal secure key), never the API token. Verification fails closed when omitted
- **Client types:** `createPaymentClient({ defaultGateway: "myfatoorah" })` types the facade `createPayment` with `MyFatoorahCreatePaymentParams`. Core does not import this package

Do not import this package from `@paykernel/core`.
