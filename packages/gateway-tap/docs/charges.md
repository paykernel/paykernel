# Charges

`createPayment` with `capture: true` (default) calls `POST /v2/charges`.

Required: `amount` (must be **> 0**), `currency`, `callbackUrl`, and `tapCustomer` (or `customerId`). Inline `tapCustomer` requires non-empty `firstName`, `lastName`, and `email` (Tap errors `1130` / `1132` / `1138`). Blank names or email are not sent. Tap error `1106` ("Customer not found") is `InvalidRequestError`, not a missing charge.

Optional: `tapSource` (default `src_all`), `tapPostUrl`, `tapThreeDSecure` (default `true`), `tapMerchantId`, `idempotencyKey` → `reference.idempotent`, `orderId` → `reference.order`, scalar `metadata`.

`TapGateway.createPayment` accepts those `tap*` fields (`TapCreatePaymentParams`).

Raw PAN / `source.card` PCI blobs are rejected. `auth_…` source ids are rejected on `createPayment` — use `capturePayment` to capture an authorize.

`INITIATED` and `IN PROGRESS` / `IN_PROGRESS` (including Fawry / `src_eg.fawry`) are `status: "pending"` / `outcome: "requires_action"` — not paid and not `failed`. All pending statuses share that outcome; `transaction.url` is only the redirect target when present.

`CAPTURED` is `status: "paid"` / `outcome: "succeeded"`. It must **not** set `nextAction` or `redirectUrl` from merchant `redirect.url` or a leftover receipt `transaction.url`. `redirectUrl` / `nextAction` are only published when outcome is `requires_action` (`transaction.url`).

`FAILED` with charge `response.code` `501`–`516` is `outcome: "declined"` (with decline extras), not a generic `failed`. `DECLINED` is unchanged.

After create timeout / HTTP 5xx / Tap `1151` you have no `chg_…` id yet — replay `createPayment` with the same `idempotencyKey`. Do not `getPayment` until you have an id. See [production checklist](./production-checklist.md).
