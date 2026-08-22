# Charges

`createPayment` with `capture: true` (default) calls `POST /v2/charges`.

Required: `amount` (must be **> 0**), `currency`, `callbackUrl`, and `tapCustomer` (or `customerId`). Inline `tapCustomer` requires `firstName`, `lastName`, and `email` (Tap error `1132`). Tap error `1106` ("Customer not found") is `InvalidRequestError`, not a missing charge.

Optional: `tapSource` (default `src_all`), `tapPostUrl`, `tapThreeDSecure` (default `true`), `tapMerchantId`, `idempotencyKey` → `reference.idempotent`, `orderId` → `reference.order`, scalar `metadata`.

`TapGateway.createPayment` accepts those `tap*` fields (`TapCreatePaymentParams`).

Raw PAN / `source.card` PCI blobs are rejected. `auth_…` source ids are rejected on `createPayment` — use `capturePayment` to capture an authorize.

`INITIATED` and `IN PROGRESS` / `IN_PROGRESS` (Fawry / `src_eg.fawry`) with `transaction.url` are `outcome: "requires_action"` — not paid. Redirect the payer to `transaction.url` only.

`CAPTURED` is `status: "paid"` / `outcome: "succeeded"`. It must **not** set `nextAction` or `redirectUrl` from merchant `redirect.url` or a leftover receipt `transaction.url`. `redirectUrl` / `nextAction` are only published when outcome is `requires_action` (`transaction.url`).
