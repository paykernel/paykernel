# @paykernel/integration-http overview

## Boundary

- Depends only on `@paykernel/core` and `@paykernel/webhooks` among workspace packages.
- No framework imports (`hono`, `elysia`, `express`, `cloudflare:workers`).
- `core`/`webhooks` must not depend on this package.

## HTTP policy

See README table. Default `provider_redelivery` never ACKs 200 for `scheduled_for_retry`. `durable_worker` ACKs 200 only for persisted deferrals (`parked`/`handler_retry`) when a `processRetryable` worker is guaranteed.

## processWebhookHttp

- `rawBody` is `string | Uint8Array` — `Uint8Array` decoded via `TextDecoder("utf-8",{fatal:true})`; invalid UTF-8 is fail-closed 400 `invalid_webhook` rather than silent replacement. Stripe HMAC is byte-exact so the raw string is passed unchanged for `stripe`/`paypal`/`myfatoorah` (never `JSON.parse`/`JSON.stringify` at the HTTP layer for those). For `tap`/`moyasar`/`paymob` (object-HMAC over parsed fields) `processWebhookHttp` defensively parses via `maybeParsedBody(rawBodyString)` — valid JSON **object** is passed as parsed object to `handleWebhook`, arrays are intentionally not parsed and fall back to the raw string (fail-closed). This keeps Stripe byte-exact while making Tap/Moyasar/Paymob work whether the gateway verifier accepts strings (Slice A) or still expects objects.
- Tap (`hashstring`), Moyasar (`secret_token`), and Paymob (HMAC) verifiers accept `string | Uint8Array | object` and JSON-parse internally when the payload is a string, so `processWebhookHttp` passing either the raw string or the parsed object verifies correctly for those gateways (historically only an object verified). Gateways fail closed on parse failure; Stripe/PayPal remain string-verified. The `maybeParsedBody` bridge and the gateway string-acceptance together make the flow gateway-agnostic regardless of fix ordering.
- Validates required header signatures (stripe `stripe-signature`, tap `hashstring`, myfatoorah `MyFatoorah-Signature`) before calling the client; missing required header → 400 without calling `handleWebhook`. PayPal requires all 5 `paypal-*` headers; partial → 400.
- Calls `engine.processWithVerifier` with verify-only `handleWebhook` on the (gateway-appropriate) payload. WEBHOOKS-2: `client` (aka `ProcessWebhookHttpInput.client` / `WebhookClient`) MUST be a `PaymentClient` with **no `onWebhookVerified` fulfillment** — fulfillment belongs only in the `handler` after the inbox claim/lease. See `docs/getting-started.md` “Never fulfill in onWebhookVerified”. If you add a runtime guard, it MUST warn, not throw, to avoid breaking existing clients.
- Forgery-class `InvalidWebhookError` (signature/HMAC verification failed) → `invalid_webhook` → 400. Parse-stage (`invalid paymob`/`invalid moyasar`/`webhook parse failed`) or missing-config (`webhookSecret`/`hmacSecret`/`webhookId`) `InvalidWebhookError` is **retryable** → `handler_failed {retryable:true}` → 500 so provider redelivers authentic paid events. Other throws → `handler_failed { retryable: true }` → 500.
- Missing `providerEventId` throws so engine maps to retryable 500, never inventing an id.
- Headers always include `x-request-id`; `Retry-After` only on 503 with known `retryAfterMs`.

Sample in README.
