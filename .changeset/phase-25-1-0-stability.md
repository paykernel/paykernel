---
"@paykernel/core": major
"@paykernel/testkit": major
"@paykernel/gateway-tap": major
"@paykernel/gateway-myfatoorah": major
---

1.0 contract cut (constructor, Money, outcomes, statuses, provider params, reserve required). Removes 0.x shims: `new PaymentClient({ moyasar, ... })` → `createPaymentClient({ gateways: { moyasar: moyasarGateway(...) } })`; `AmountInput = Money` only (`money("10.50", "SAR")`), `GatewayPaymentResult` amount fields `Money | undefined`; `outcome` required, `success` removed; `PaymentStatus` → `PaymentDomainStatus`, `WebhookEvent.status` → `WebhookEnvelopeStatus`; provider fields moved off `CreatePaymentParams` onto per-gateway `*CreatePaymentParams`; `IdempotencyStore.reserve` and `PaymobIdempotencyStore.reserve` required; `expectedAmountMinor` and `ScriptedStep` removed from `@paykernel/testkit`. Compat CI (`check:compat`) + baselines (`public-api.inventory.json`, `schema.inventory.json`) added; `bun-hono-postgres` RC with real Postgres via `store-postgres/pg`.
