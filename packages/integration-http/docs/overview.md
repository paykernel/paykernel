# @paykernel/integration-http overview

## Boundary

- Depends only on `@paykernel/core` and `@paykernel/webhooks` among workspace packages.
- No framework imports (`hono`, `elysia`, `express`, `cloudflare:workers`).
- `core`/`webhooks` must not depend on this package.

## HTTP policy

See README table. Default `provider_redelivery` never ACKs 200 for `scheduled_for_retry`. `durable_worker` ACKs 200 only for persisted deferrals (`parked`/`handler_retry`) when a `processRetryable` worker is guaranteed.

## processWebhookHttp

- `rawBody` is `string | Uint8Array` — always `TextDecoder` for bytes, never `JSON.parse`.
- Validates required header signatures (stripe `stripe-signature`, tap `hashstring`, myfatoorah `MyFatoorah-Signature`) before calling the client; missing required header → 400 without calling `handleWebhook`.
- Calls `engine.processWithVerifier` with verify-only `handleWebhook` on the raw string.
- `InvalidWebhookError` → `invalid_webhook` → 400. Other throws → `handler_failed { retryable: true }` → 500.
- Missing `providerEventId` throws so engine maps to retryable 500, never inventing an id.
- Headers always include `x-request-id`; `Retry-After` only on 503 with known `retryAfterMs`.

Sample in README.
