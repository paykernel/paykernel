# Production checklist

- **Webhook secret:** configure `webhookSecret` (portal secure key) **separately** from `apiToken`. Never use the API token as the HMAC key. Verify before parse (`verifyWebhook`), then inbox-claim, then fulfill.
- **Fulfill only `paid`:** never fulfill `requires_action` / `redirectUrl` results. Redirect return URLs are browser callbacks, not webhooks — confirm settlement with `GetPaymentStatus` / the signed webhook.
- **Hosts & tokens:** sandbox is `apitest.myfatoorah.com` (currency KWD, no real money). Live uses per-country hosts (`api`, `api-ae`, `api-sa`, `api-qa`, `api-eg`) and a per-country live token.
- **HTTPS callback:** `callbackUrl` and `webhookUrl` must be HTTPS. MyFatoorah rejects localhost.
- **No raw cards:** this backend adapter never sends cardholder data. Embedded sessions use `myfatoorahSessionId`; saved cards use `myfatoorahToken`. Never store PAN/CVC.
- **Idempotency:** always pass a caller `idempotencyKey` on create/refund. On create timeout / 5xx, replay with the same key (250-minute cache). On refund submit-timeout, do **not** re-POST — reconcile with `GetRefundStatus` using the same `ExternalIdentifier`.
- **Refund settlement:** MakeRefund acceptance is not settlement. Wait for `REFUND_STATUS_CHANGED` `REFUNDED` (or `GetRefundStatus` `Refunded`) before treating a refund as complete.
- **Amounts:** major units, ISO-padded on the wire (`10.50` SAR, `1.200` KWD). Zero amounts are rejected.
