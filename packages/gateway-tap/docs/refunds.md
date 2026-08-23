# Refunds

`refundPayment` calls `POST /v2/refunds`. `gatewayPaymentId` must be a **charge** id (`chg_…`). Authorize ids (`auth_…`) are rejected — store the capture result `gatewayId` separately from `authorizationId`.

Tap requires `amount`, `currency`, and `reason`. If `amount` is omitted, the adapter uses the **remaining** refundable amount when the charge exposes remaining / refunded amounts and remaining is **positive**. Remaining `0` means nothing left to refund — it is **not** a new `POST` of `charge.amount`. A `refunds` list with any unparseable amount is **fail-closed**. When the charge does **not** expose remaining / refunded, omitted amount throws `InvalidRequestError` — pass `amount` explicitly (Tap retrieve-charge does not document `amount_refunded`). Omitted amount still requires remaining/refunded fields for a positive remaining.

A charge whose status is already `REFUNDED` is fully refunded. Remaining `0` or status `REFUNDED` is **not** a new `POST` of `charge.amount`. Map the nested refund whose `reference.idempotent` matches this `idempotencyKey` (or `GET /refunds/{id}` when only an id is nested). A single nested refund with a **different** `reference.idempotent` is not this refund. Otherwise `InvalidRequestError`. A single nested refund is still mapped when Tap omits that field.

If `currency` is omitted, it is taken from the charge. If the caller passes `currency`, it must match the charge (`InvalidRequestError`; Tap `1149`).

Reason is `tapReason` if set, else the caller `reason`, else `requested_by_customer`. Reason length must be less than 250 characters (Tap `1157`).

When config `webhookUrl` is set, the POST includes `post.url` from that value.

**Requires** `idempotencyKey` (`reference.idempotent`). Partial refunds are claimed.

Refund object `ACCEPTED` (Refund Logic v2) → refund `status: "pending"` / payment-domain `refund_pending`. That is in progress, **not** failed. Do not fulfill against it and do not retry the refund as a failure.

Refund object `REFUNDED` → refund `status: "completed"` / payment-domain `refunded`.

`totalRefunded` is omitted unless a true **cumulative** figure exists. This adapter does not treat a single refund `amount` as a lifetime total and therefore **omits** `totalRefunded` (including never inventing `0`).
