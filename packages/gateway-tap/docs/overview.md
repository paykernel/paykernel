# Tap Payments adapter overview

`@paykernel/gateway-tap` is a portable `GatewayAdapter<"tap", TapGateway>` for [`createPaymentClient`](../../core/docs/plugin-architecture.md).

- **API base:** `https://api.tap.company/v2`
- **Auth:** `Authorization: Bearer <secretKey>` (config `secretKey` is trimmed; whitespace-only is invalid)
- **Test vs live:** key prefix (`sk_test_` / `sk_live_`), not a sandbox flag
- **IDs:** charges `chg_…`, authorizes `auth_…`, refunds `re_…`. Capture result `authorizationId` is the `auth_…` id; `gatewayId` is the `chg_…` id. `getPayment(auth_…)` on CAPTURED uses nested `charge_id` when present (`gatewayId` is `chg_…`, `authorizationId` is `auth_…`); without it, paid + `authorizationId` `auth_…`. Refunds need `chg_…` (capture POST or charge webhook).
- **save_card:** create and capture POST send `save_card: false`
- **Customer:** required on create (`tapCustomer` or `customerId`). Inline customers need non-empty first name, last name, and email
- **Redirect:** `callbackUrl` → `redirect.url` (required for 3DS / KNET / mada)
- **Default source:** charges omit `tapSource` → `src_all` (hosted methods page). Authorize (`capture: false`) omit `tapSource` → `src_card`. Tokens: `tok_…`. Local methods: `src_kw.knet`, `src_sa.mada`, … `createPayment` rejects `auth_…` source ids.
- **Authorize auto VOID:** optional config `autoVoidHours` on authorize create only; not defaulted
- **Amount:** must be `> 0`
- **Webhooks:** config `webhookUrl` and `tapPostUrl` must be HTTPS
- **Client types:** `createPaymentClient({ defaultGateway: "tap" })` (gateways map or registry) types facade `createPayment` with `TapCreatePaymentParams`. Core does not import this package.

Do not import this package from `@paykernel/core`.
