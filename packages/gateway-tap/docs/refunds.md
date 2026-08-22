# Refunds

`refundPayment` calls `POST /v2/refunds`. `gatewayPaymentId` must be a **charge** id (`chg_…`).

Tap requires `amount`, `currency`, and `reason`. If `amount` / `currency` are omitted, the adapter GETs the charge first. Reason is `tapReason` if set, else the caller `reason`, else `requested_by_customer`.

When config `webhookUrl` is set, the POST includes `post.url` from that value.

**Requires** `idempotencyKey` (`reference.idempotent`). Partial refunds are claimed.

Refund object `REFUNDED` → refund `status: "completed"` / payment-domain `refunded`.

`totalRefunded` is omitted unless a true **cumulative** figure exists. This adapter does not treat a single refund `amount` as a lifetime total and therefore **omits** `totalRefunded` (including never inventing `0`).
