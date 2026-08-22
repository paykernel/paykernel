# Charges

`createPayment` with `capture: true` (default) calls `POST /v2/charges`.

Required: `amount`, `currency`, `callbackUrl`, and `tapCustomer` (or `customerId`).

Optional: `tapSource` (default `src_all`), `tapPostUrl`, `tapThreeDSecure` (default `true`), `tapMerchantId`, `idempotencyKey` → `reference.idempotent`, `orderId` → `reference.order`, scalar `metadata`.

`TapGateway.createPayment` accepts those `tap*` fields (`TapCreatePaymentParams`).

Raw PAN / `source.card` PCI blobs are rejected.

`INITIATED` and `IN PROGRESS` (Fawry / `src_eg.fawry`) with `transaction.url` are `outcome: "requires_action"` — not paid. Redirect the payer to `transaction.url` only.

`CAPTURED` is `status: "paid"` / `outcome: "succeeded"`. It must **not** set `nextAction` or `redirectUrl` from merchant `redirect.url` or a leftover receipt `transaction.url`. `redirectUrl` / `nextAction` are only published when outcome is `requires_action` (`transaction.url`).
