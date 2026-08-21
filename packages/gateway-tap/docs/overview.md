# Tap Payments adapter overview

`@paykernel/gateway-tap` is a portable `GatewayAdapter<"tap", TapGateway>` for [`createPaymentClient`](../../core/docs/plugin-architecture.md).

- **API base:** `https://api.tap.company/v2`
- **Auth:** `Authorization: Bearer <secretKey>`
- **Test vs live:** key prefix (`sk_test_` / `sk_live_`), not a sandbox flag
- **IDs:** charges `chg_…`, authorizes `auth_…`, refunds `re_…`
- **Customer:** required on create (`tapCustomer` or `customerId`)
- **Redirect:** `callbackUrl` → `redirect.url` (required for 3DS / KNET / mada)
- **Default source:** `src_all` (hosted methods page). Tokens: `tok_…`. Local methods: `src_kw.knet`, `src_sa.mada`, …

Core `PaymentClient` is unchanged. Do not import this package from `@paykernel/core`.
