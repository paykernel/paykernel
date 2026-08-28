# Stability (1.0)

This is the consumer-facing stability policy frozen at 1.0. For the canonical ADR, see [ADR 0025](./adr/0025-1-0-stability.md).

## Versioning

- Each public `packages/*` is versioned independently (`fixed: []`, `linked: []` in `.changeset/config.json`). `0.x` had no stability guarantee.
- **Major** — breaking change of exported types/runtime symbols, `PaymentEvent` required-field/arm removal or rename, or changing already-applied SQL migration bodies.
- **Minor** — additive compatible exports, optional `PaymentEvent` fields, or new `STABLE_PAYMENT_EVENT_TYPES` members with `PAYMENT_EVENT_SCHEMA_VERSION` still `'1'`.
- **Patch** — fixes without contract change.
- After 1.0.0, a public API may be removed only after **one published minor** and **≥ 90 days** of `@deprecated`. The 1.0 cut itself removed 0.x shims with no further wait.

## Payment events

- `PAYMENT_EVENT_SCHEMA_VERSION = "1"` in `packages/core/src/types/payment-event.ts`. A new schemaVersion `'2'` is required only when an existing arm's required shape breaks.
- `WebhookEvent.type` stays provider-native. Fulfillment uses `event` / `stableType`.
- `WebhookEvent.rawPayload` stays **required request-local**. Persist via `toPersistedPaymentEventEnvelope`.

## Store schema

- `MIGRATIONS` in `packages/sql-foundation/src/migrations/metadata.ts` is append-only. Editing SQL of an already-shipped version is forbidden; add `SCHEMA_VERSION_V3` + migration instead.
- `CURRENT_SCHEMA_VERSION` stays `2` in this phase (no DDL) — snapshot only.

## Runtimes

- Engines: Node `>=18`, Bun `>=1.0.0`.
- Portable packages stay under `bun run check:runtime-portability`.
- Deno is Web-API-intended, **not CI-gated**.
- Workers: portable packages + `@paykernel/store-d1` / `@paykernel/store-durable-objects` / `@paykernel/integration-cloudflare-workers`.

## Provider APIs

- Each gateway doc keeps the implemented provider API version.
- Breaking a **normalized** public mapping is a major of the package that owns the adapter (`@paykernel/core` for built-ins, `@paykernel/gateway-*` for extras).

## Adapter drivers

- Subpath-only optional drivers.
- Dropping a published driver subpath = major of that adapter package.
