# Charges

`createPayment` with `capture: true` (default) calls `POST /v2/charges`.

Required: `amount`, `currency`, `callbackUrl`, and `tapCustomer` (or `customerId`).

Optional: `tapSource` (default `src_all`), `tapPostUrl`, `tapThreeDSecure` (default `true`), `tapMerchantId`, `idempotencyKey` → `reference.idempotent`, `orderId` → `reference.order`, scalar `metadata`.

Raw PAN / `source.card` PCI blobs are rejected.

`INITIATED` plus `transaction.url` is `outcome: "requires_action"` — not paid. `CAPTURED` is `status: "paid"`.
