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
- **TAP-CAPTURE-BODY:** Capture requires authorize status `AUTHORIZED`, or `VOID` to replay a completed capture with the same `idempotencyKey`. Capture POST sends `merchant.id` from config and `post.url` from `webhookUrl` when set.
- **TAP-VOID-RETRY:** Void is not Tap-idempotent. The adapter does not retry void after `afterProviderSubmit`. Successful void is `outcome: "succeeded"` + `status: "cancelled"`.
- **TAP-REFUND-REASON:** Refund `reason` is `tapReason`, else caller `reason`, else `requested_by_customer`.
- **TAP-TYPES-CREATE:** `TapGateway.createPayment` accepts `tap*` fields (`TapCreatePaymentParams`) without excess-property errors.
- **TAP-1151-TIMEOUT:** Tap error code `1151` ("Gateway timed out") maps to `NetworkError`. Mutating 1151 is `afterProviderSubmit` (indeterminate after keyed retries), not a clean `GatewayApiError` failure.
- **TAP-PCI-DEAD:** PCI fence rejects `source.card` and PCI `on_file` independently.
- **TAP-TIMEOUT-MS:** `timeoutMs` is a positive millisecond timeout (default 30000). Non-positive values are rejected, not treated as "use default" or an instant abort.
- **TAP-HASH-CATCH:** `hashstring` verification fails closed on malformed payload or non-hex signature (`false`). Canonical amount remains ISO-padded.
- **TAP-HASH-VECTOR:** Tests verify Tap’s published Create-a-Charge `hashstring` header (docs example `sk_test_` + posted charge JSON). ISO amount padding is load-bearing for that vector.
