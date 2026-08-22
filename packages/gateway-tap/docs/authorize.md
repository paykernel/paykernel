# Authorize, capture, and void

`createPayment({ capture: false })` calls `POST /v2/authorize`. Success status is `AUTHORIZED` (`status: "authorized"`). That is **not** paid settlement.

**Capture** (`capturePayment`): `gatewayPaymentId` must be `auth_…`. The adapter GETs the authorize. `AUTHORIZED` captures normally. `VOID` still `POST /v2/charges` with the same `reference.idempotent` so a crash-retry can replay the original charge. Any other status fails closed before POST. Optional `amount` is a partial capture. When set, config `merchantId` is sent as `merchant.id` and config `webhookUrl` as `post.url`. **Requires** `idempotencyKey`.

**Void** (`voidPayment`): `POST /v2/authorize/{id}/void`. `gatewayPaymentId` must be `auth_…`. **Requires** `idempotencyKey`. Success is `outcome: "succeeded"` + `status: "cancelled"` (not a failed payment). Tap does not natively idempotent-void; the adapter does **not** retry void after submit. See [idempotency](./idempotency.md).

`getPayment` dispatches on prefix: `chg_…` → `GET /charges/{id}`, `auth_…` → `GET /authorize/{id}`.

Result `redirectUrl` / `nextAction` is **`transaction.url` only** (hosted checkout / 3DS). Merchant `redirect.url` (`callbackUrl`) is an echo of the return URL, not a next action. Never treat a CAPTURED or AUTHORIZED merchant callback as checkout redirect.
