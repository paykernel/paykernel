# Tap Payments adapter overview

`@paykernel/gateway-tap` is a portable `GatewayAdapter<"tap", TapGateway>` for [`createPaymentClient`](../../core/docs/plugin-architecture.md).

- **API base:** `https://api.tap.company/v2`
- **Auth:** `Authorization: Bearer <secretKey>`
- **Test vs live:** key prefix (`sk_test_` / `sk_live_`), not a sandbox flag
- **IDs:** charges `chg_…`, authorizes `auth_…`, refunds `re_…`
- **Customer:** required on create (`tapCustomer` or `customerId`). Inline customers need first name, last name, and email
- **Redirect:** `callbackUrl` → `redirect.url` (required for 3DS / KNET / mada)
- **Default source:** charges omit `tapSource` → `src_all` (hosted methods page). Authorize (`capture: false`) omit `tapSource` → `src_card`. Tokens: `tok_…`. Local methods: `src_kw.knet`, `src_sa.mada`, … `createPayment` rejects `auth_…` source ids.
- **Authorize auto VOID:** optional config `autoVoidHours` on authorize create only; not defaulted
- **Amount:** must be `> 0`

Core `PaymentClient` is unchanged. Do not import this package from `@paykernel/core`.
