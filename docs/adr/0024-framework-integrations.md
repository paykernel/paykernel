# 0024 — Framework integrations are thin HTTP adapters

Date: 2026-08-25
Status: accepted

Phase 24 adds optional HTTP adapters (`@paykernel/integration-*`) so apps do not copy raw-body handling, header extraction, inbox integration, and HTTP mapping.

## Decisions

- `@paykernel/core` and `@paykernel/webhooks` stay framework-agnostic. HTTP status tables do **not** enter `webhooks`; the package description already forbids HTTP hardcoding.
- Shared `@paykernel/integration-http` owns the status table and raw-body orchestration so the four framework packages cannot drift. It depends only on `@paykernel/core` and `@paykernel/webhooks` (and `testkit` in dev).
- Each framework package (`hono`, `elysia`, `express`, `cloudflare-workers`) depends only on `@paykernel/integration-http` among workspace packages. They convert the framework's Request/IncomingMessage to `processWebhookHttp` and the `WebhookHttpResult` to the framework's response. No `createPayment`, capture, refund, fulfillment, or store adapters in these packages.
- Default acknowledgment policy is fail-closed `provider_redelivery`: `scheduled_for_retry` (`parked`/`handler_retry`/`not_available`) maps to HTTP 503 so the provider redelivers unless the caller explicitly opts into `durable_worker`. `durable_worker` ACKs 200 only for persisted deferrals (`parked`/`handler_retry`); `not_available` stays 503 in both policies. `already_processing` is always 503.
- Webhook handlers use `engine.processWithVerifier` with verify-only `handleWebhook` on the raw body string. Framework adapters never `JSON.parse`/`JSON.stringify` the body for Stripe; Express fails closed on parsed-object bodies.
