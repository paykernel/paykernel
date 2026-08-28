# 0025 — 1.0 stability and versioning policy

Date: 2026-08-27
Status: accepted

Phase 25 freezes the 1.0 public contract, removes 0.x compatibility shims, and defines semver and schema stability for public packages, payment events, and persisted store schemas.

1.0 cut removes: `new PaymentClient({ moyasar, paypal, paymob, stripe })` → `createPaymentClient({ gateways: { moyasar: moyasarGateway(...) }, defaultGateway })`; `AmountInput = number | Money` → `Money` only (`money(number)` still constructs but payment APIs reject `number`; `moneyToMajorNumber` display-only); `success` boolean → required `outcome` (`isPaidOutcome`); mega `PaymentStatus` → `PaymentDomainStatus` / `RefundDomainStatus` / `WebhookEnvelopeStatus`; provider fields off `CreatePaymentParams` (`tokenId` deleted; per-gateway `*CreatePaymentParams`); `IdempotencyStore.reserve` required. No DDL — `CURRENT_SCHEMA_VERSION` stays `2`.

## Decisions
- 1.0 starts independent semver per public `packages/*` (existing `.changeset/config.json`: `fixed: []`, `linked: []`). `0.x` had no stability guarantee.
- Breaking change of exported types/runtime symbols, `PaymentEvent` required-field/arm removal or rename, or changing already-applied SQL migration bodies = **major** of the owning package.
- Additive compatible exports / optional event fields / new `STABLE_PAYMENT_EVENT_TYPES` members with `PAYMENT_EVENT_SCHEMA_VERSION` still `'1'` = **minor**.
- Fixes without contract change = **patch**.
- After 1.0.0: public API may be removed only after **one published minor** and **≥ 90 days** of `@deprecated`. This 1.0 cut itself removes 0.x shims with no further wait.
- Event schema: keep `PAYMENT_EVENT_SCHEMA_VERSION = "1"` (`packages/core/src/types/payment-event.ts`). New schemaVersion `'2'` is required only when an existing arm's required shape breaks. `WebhookEvent.type` stays provider-native; fulfillment uses `event` / `stableType`. `WebhookEvent.rawPayload` stays **required request-local**; persistence stays `toPersistedPaymentEventEnvelope`.
- Store schema: append-only `MIGRATIONS` in `packages/sql-foundation/src/migrations/metadata.ts`. Editing SQL of an already-shipped version is forbidden; add `SCHEMA_VERSION_V3` + migration instead. `CURRENT_SCHEMA_VERSION` stays `2` in this phase (snapshot only).
- Runtimes: engines remain Node `>=18`, Bun `>=1.0.0`. Portable packages stay under `bun run check:runtime-portability`. Deno is Web-API-intended, **not CI-gated**. Workers: portable packages + `@paykernel/store-d1` / `@paykernel/store-durable-objects` / `@paykernel/integration-cloudflare-workers`.
- Provider APIs: each gateway doc keeps the implemented provider API version. Breaking a **normalized** public mapping is a major of the package that owns the adapter (`@paykernel/core` for built-ins, `@paykernel/gateway-*` for extras).
- Adapter drivers: subpath-only optional drivers. Dropping a published driver subpath = major of that adapter package.
