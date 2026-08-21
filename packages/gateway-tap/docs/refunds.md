# Refunds

`refundPayment` calls `POST /v2/refunds`. `gatewayPaymentId` must be a **charge** id (`chg_…`).

Tap requires `amount`, `currency`, and `reason`. If `amount` / `currency` are omitted, the adapter GETs the charge first. Reason defaults to `requested_by_customer` unless `tapReason` or a recognized `reason` (`duplicate` / `fraudulent`) is passed.

**Requires** `idempotencyKey` (`reference.idempotent`). Partial refunds are claimed.

Refund object `REFUNDED` → refund `status: "completed"` / payment-domain `refunded`.
