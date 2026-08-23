# Authorize, capture, and void

`createPayment({ capture: false })` calls `POST /v2/authorize`. Success status is `AUTHORIZED` (`status: "authorized"`). That is **not** paid settlement. Authorize create POST sends `save_card: false`.

Omitted `tapSource` defaults to `src_card` (not `src_all`). `createPayment` rejects `auth_…` source ids — capture with `capturePayment`.

Optional config `autoVoidHours` is sent **only** on authorize create as `auto: { type: "VOID", time }`. It is **not** defaulted. Omit it unless you want Tap to auto-VOID the hold.

**Capture** (`capturePayment`): `gatewayPaymentId` must be `auth_…`. The adapter GETs the authorize.

- `AUTHORIZED`: captures (`POST /v2/charges` with `source.id` = authorize id). Result `authorizationId` is the `auth_…` id; `gatewayId` is the charge (`chg_…`) id. Store both — refunds need `chg_…`.
- `CAPTURED`: the hold was already captured (crash-retry after a completed capture). The adapter does **not** POST `/charges`. When nested `charge_id` / `charge.id` is present, `gatewayId` is that `chg_…` and `authorizationId` is the `auth_…` id. Without a nested charge id it returns `status: "paid"` with `authorizationId` as the `auth_…` id (`gatewayId` stays `auth_…`). Refunds still need a `chg_…` from capture POST or a charge webhook.
- `VOID`: rejected — the hold was released, not captured.
- Any other status fails closed before POST.

Tap error `1114` ("Please check the Authorize status") is `InvalidRequestError`. Tap `1126` ("Source already used") is `InvalidRequestError` (do not treat a completed capture as a new charge POST). Optional `amount` is a partial capture. When the caller passes `currency`, it must match the authorize currency (`InvalidRequestError`; Tap `1149`). Capture POST sends `threeDSecure: true`, `customer_initiated: true`, `save_card: false`, and `redirect.url` from `tapRedirectUrl` or the authorize object’s `redirect.url` (required; Tap `1110`). `tapThreeDSecure: false` / `tapCustomerInitiated: false` throw `InvalidRequestError` (Tap forbids setting those false on authorize capture). When set, config `merchantId` is sent as `merchant.id` and config `webhookUrl` as `post.url`. Capture may still be `outcome: "requires_action"` if Tap returns `INITIATED`. **Requires** `idempotencyKey`.

**Void** (`voidPayment`): `POST /v2/authorize/{id}/void`. `gatewayPaymentId` must be `auth_…`. **Requires** `idempotencyKey`. Success is `outcome: "succeeded"` + `status: "cancelled"` (not a failed payment). Tap does not natively idempotent-void; the adapter does **not** retry void after submit. See [idempotency](./idempotency.md).

`getPayment` dispatches on prefix: `chg_…` → `GET /charges/{id}`, `auth_…` → `GET /authorize/{id}`. A CAPTURED authorize uses nested `charge_id` when present (`gatewayId` is `chg_…`, `authorizationId` is `auth_…`). Without `charge_id`, it is `status: "paid"` with `authorizationId` `auth_…` — refunds still need a `chg_…` from capture POST or a charge webhook. A VOID authorize is `outcome: "succeeded"` + `status: "cancelled"` (same as `voidPayment`), not a failed payment, and is not capturable.

Result `redirectUrl` / `nextAction` is **`transaction.url` only** (hosted checkout / 3DS) and only when outcome is `requires_action`. Merchant `redirect.url` (`callbackUrl`) is an echo of the return URL, not a next action. Leftover `transaction.url` on AUTHORIZED or CAPTURED is **not** `requires_action`.
