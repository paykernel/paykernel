# Refunds

`refundPayment` calls `POST /v2/refunds`. `gatewayPaymentId` must be a **charge** id (`chg_…`). Authorize ids (`auth_…`) are rejected — store the capture result `gatewayId` separately from `authorizationId`.

Tap requires `amount`, `currency`, and `reason`. If `amount` is omitted, the adapter uses the **remaining** refundable amount when the charge exposes `refunded` / remaining. It does **not** resend `charge.amount` (that would retry a full refund after a partial). A charge whose status is `REFUNDED` cannot be refunded again. After a partial refund, pass remaining **explicitly** if the charge does not expose `refunded`.

If `currency` is omitted, it is taken from the charge. If the caller passes `currency`, it must match the charge (`InvalidRequestError`; Tap `1149`).

Reason is `tapReason` if set, else the caller `reason`, else `requested_by_customer`. Reason length must be less than 250 characters (Tap `1157`).

When config `webhookUrl` is set, the POST includes `post.url` from that value.

**Requires** `idempotencyKey` (`reference.idempotent`). Partial refunds are claimed.

Refund object `ACCEPTED` (Refund Logic v2) → refund `status: "pending"` / payment-domain `refund_pending`. That is in progress, **not** failed. Do not fulfill against it and do not retry the refund as a failure.

Refund object `REFUNDED` → refund `status: "completed"` / payment-domain `refunded`.

`totalRefunded` is omitted unless a true **cumulative** figure exists. This adapter does not treat a single refund `amount` as a lifetime total and therefore **omits** `totalRefunded` (including never inventing `0`).
