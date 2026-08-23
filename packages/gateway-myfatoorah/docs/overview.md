# MyFatoorah adapter overview

`@paykernel/gateway-myfatoorah` is a portable `GatewayAdapter<"myfatoorah", MyFatoorahGateway>` for [`createPaymentClient`](../../core/docs/plugin-architecture.md).

- **API base:** sandbox `https://apitest.myfatoorah.com/`; live hosts by portal country (`api`, `api-ae`, `api-sa`, `api-qa`, `api-eg`)
- **Auth:** `Authorization: Bearer <apiToken>` (config `apiToken` is trimmed; whitespace-only is invalid)
- **Surface:** V3 hosted payments (`POST /v3/payments`), V2 inquiry/refund (`GetPaymentStatus`, `MakeRefund`, `GetRefundStatus`), Webhook V2 signatures
- **IDs:** `gatewayId` is the **InvoiceId**. PaymentId (when present) rides `references.relatedIds.paymentId`
- **Customer:** optional (`myfatoorahCustomer` or `customerId` → `{ Reference }`)
- **Redirect:** `PaymentURL` → `requires_action` + `redirectUrl`. `callbackUrl` → `IntegrationUrls.Redirection`
- **No auth/capture/void:** `capture: false` and `capturePayment` throw `OperationNotSupportedError` (capability `authorization`). `voidPayment` is not implemented
- **Idempotency:** `createPayment` requires a caller `idempotencyKey`, sent as the `Idempotency-Key` header (official cache 250 minutes). Refunds also require the key (`ExternalIdentifier` + header)
- **Refunds:** MakeRefund results are `refund_pending`, never `completed`. Settlement arrives via `REFUND_STATUS_CHANGED` or `GetRefundStatus` `Refunded`
- **Amount:** must be `> 0`. JSON amounts are ISO-padded number tokens (`10.50` / `1.200`), never strings
- **Webhooks:** separate `webhookSecret` (portal secure key), never the API token. Verification fails closed when omitted
- **Client types:** `createPaymentClient({ defaultGateway: "myfatoorah" })` types the facade `createPayment` with `MyFatoorahCreatePaymentParams`. Core does not import this package

Do not import this package from `@paykernel/core`.
