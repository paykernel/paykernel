# @paykernel/gateway-tap

## Unreleased

### Minor

- **Phase 23:** first-party portable Tap Payments adapter (`tapGateway` / `TapGateway`). Charges, authorize/capture/void, refunds, and HMAC-SHA256 `hashstring` webhooks. Conservative capability claims. Not a core built-in.

### Patch

- **TAP-REDIRECT-URL:** Result `redirectUrl` / `nextAction` is `transaction.url` only. Merchant `redirect.url` (`callbackUrl`) is never a checkout next action. CAPTURED / AUTHORIZED must not redirect from that echo URL.
- **TAP-UDF1-PAYMENT-ID:** Webhook `paymentId` is `metadata.paymentId` / `metadata.orderId` / `reference.order` — never `metadata.udf1`.
- **TAP-REFUND-POST:** Refund POST includes `post.url` from config `webhookUrl` when set.
- **TAP-FAWRY-IN-PROGRESS:** Charge status `IN PROGRESS` (Fawry) maps to `pending` / `requires_action` when `transaction.url` is present — not `failed`.
- **TAP-TOTAL-REFUNDED:** Refund results omit `totalRefunded`. A single refund `amount` is not a cumulative total; the adapter does not invent `0`.
- **TAP-CAPTURE-BODY:** Capture POST sends `merchant.id` from config and `post.url` from `webhookUrl` when set.
- **TAP-CAPTURE-STATUS:** Capture requires GET authorize `AUTHORIZED` (normal) or `CAPTURED` (idempotent replay of `POST /charges` with the same `idempotencyKey`). `VOID` is rejected — the hold was released, not captured.
- **TAP-REFUND-ACCEPTED:** Refund object `ACCEPTED` maps to pending / `refund_pending`, not failed. Do not fulfill or retry as failure.
- **TAP-AUTH-LEFTOVER-URL:** Leftover `transaction.url` on AUTHORIZED / CAPTURED is not `requires_action`.
- **TAP-CAPTURE-FIELDS:** Capture POST sends `threeDSecure: true` and `customer_initiated: true`.
- **TAP-AUTHORIZE-AUTO:** Optional config `autoVoidHours` is sent as authorize-create `auto: { type: "VOID", time }` only. It is not defaulted.
- **TAP-AUTHORIZE-SOURCE:** `capture: false` omitted `tapSource` defaults to `src_card` (charges still default `src_all`).
- **TAP-CREATE-AUTH-SOURCE:** `createPayment` rejects `auth_…` source ids. Capture with `capturePayment`.
- **TAP-IN-PROGRESS-UNDERSCORE:** Charge / refund status `IN_PROGRESS` is treated like `IN PROGRESS` (pending).
- **TAP-HTTP-50X:** HTTP 5xx maps to `NetworkError` (mutating → `afterProviderSubmit`). It is not a card decline even if a JSON error code looks like `50x`.
- **TAP-1106-CUSTOMER:** Tap error `1106` ("Customer not found") is `InvalidRequestError`, not payment `ResourceNotFoundError`.
- **TAP-ZERO-AMOUNT:** Outbound amounts must be `> 0`. Zero is rejected.
- **TAP-1114-STATUS:** Tap error `1114` ("Please check the Authorize status") is a typed `InvalidRequestError` (fail closed), not an untyped `GatewayApiError`.
- **TAP-LAST-NAME:** Inline `tapCustomer` requires `lastName` (Tap error `1132`). Existing `cus_…` ids are unchanged.
- **TAP-CAPTURE-REDIRECT:** Capture `POST /charges` sends `redirect.url` from `tapRedirectUrl` or the authorize object’s `redirect.url`. Missing both fails closed (Tap `1110`).
- **TAP-VOID-RETRY:** Void is not Tap-idempotent. The adapter does not retry void after `afterProviderSubmit`. Successful void is `outcome: "succeeded"` + `status: "cancelled"`.
- **TAP-REFUND-REASON:** Refund `reason` is `tapReason`, else caller `reason`, else `requested_by_customer`.
- **TAP-TYPES-CREATE:** `TapGateway.createPayment` accepts `tap*` fields (`TapCreatePaymentParams`) without excess-property errors.
- **TAP-1151-TIMEOUT:** Tap error code `1151` ("Gateway timed out") maps to `NetworkError`. Mutating 1151 is `afterProviderSubmit` (indeterminate after keyed retries), not a clean `GatewayApiError` failure.
- **TAP-PCI-DEAD:** PCI fence rejects `source.card` and PCI `on_file` independently.
- **TAP-TIMEOUT-MS:** `timeoutMs` is a positive millisecond timeout (default 30000). Non-positive values are rejected, not treated as "use default" or an instant abort.
- **TAP-HASH-CATCH:** `hashstring` verification fails closed on malformed payload or non-hex signature (`false`). Canonical amount remains ISO-padded.
- **TAP-HASH-VECTOR:** Tests verify Tap’s published Create-a-Charge `hashstring` header (docs example `sk_test_` + posted charge JSON). ISO amount padding is load-bearing for that vector.
