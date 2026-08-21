# Additional gateway packages stay outside core

Phase 23 adds extra providers as workspace packages (`@paykernel/gateway-*`), not as new `BuiltInGatewayName` values or `PaymentClient` constructor keys.

The plugin seam is already the supported path: a factory returns `GatewayAdapter`, `createPaymentClient({ gateways })` materializes it, and core stays free of `packages/gateway-*` dependencies. Built-in Stripe / Moyasar / PayPal / Paymob remain in `@paykernel/core` for 0.x. Extracting them is a separate compatibility project.

Tap Payments is the proving adapter (`@paykernel/gateway-tap`). Provider-specific input types live in the package (`TapCreatePaymentParams`); they are not added to core `CreatePaymentParams`. Capability claims are conservative: charges / authorize / capture / void / refunds / webhooks only. `src_all` is a redirect source, not `hostedCheckout`. Customers, payment links, destinations, and invoices stay unclaimed until implemented.

Tap amounts are major-unit ISO decimals converted through core `Money` / bigint. Webhook authenticity is HMAC-SHA256 `hashstring` over canonical fields keyed by the secret API key (no separate `whsec_`). Raw card / PCI `source.card` paths are rejected.
