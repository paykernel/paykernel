# Authorize, capture, and void

`createPayment({ capture: false })` calls `POST /v2/authorize`. Success status is `AUTHORIZED` (`status: "authorized"`). That is **not** paid settlement.

**Capture** (`capturePayment`): `gatewayPaymentId` must be `auth_…`. The adapter GETs the authorize, then `POST /v2/charges` with `source.id` set to that authorize id. Optional `amount` is a partial capture. **Requires** `idempotencyKey`.

**Void** (`voidPayment`): `POST /v2/authorize/{id}/void`. `gatewayPaymentId` must be `auth_…`. **Requires** `idempotencyKey`.

`getPayment` dispatches on prefix: `chg_…` → `GET /charges/{id}`, `auth_…` → `GET /authorize/{id}`.
