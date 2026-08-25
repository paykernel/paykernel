# @paykernel/integration-http

Portable HTTP mapping and webhook request helpers for `@paykernel/webhooks`. No framework imports. Framework packages (`hono`, `elysia`, `express`, `cloudflare-workers`) depend on this so status tables cannot drift.

## Install

```bash
bun add @paykernel/integration-http
# workspace peers: @paykernel/core @paykernel/webhooks
```

## HTTP policy

`@paykernel/webhooks` never hardcodes status codes. Map outcomes with `mapInboxOutcome`:

```ts
import { mapInboxOutcome, retryAfterSeconds, processWebhookHttp } from "@paykernel/integration-http";

const status = mapInboxOutcome(outcome); // default provider_redelivery
const statusWithWorker = mapInboxOutcome(outcome, { kind: "durable_worker" });

if (status === 503) {
  const seconds = retryAfterSeconds(outcome);
}
```

Policy table (exhaustive on `WebhookProcessingOutcome.outcome`):

| outcome | `provider_redelivery` (default) | `durable_worker` |
| --- | --- | --- |
| `processed` | 200 | 200 |
| `duplicate_completed` | 200 | 200 |
| `invalid_webhook` | 400 | 400 |
| `payload_conflict` | 409 | 409 |
| `already_processing` | 503 | 503 |
| `handler_failed` retryable | 500 | 500 |
| `handler_failed` not retryable | 200 | 200 |
| `scheduled_for_retry` `not_available` | 503 | 503 |
| `scheduled_for_retry` `parked` | 503 | 200 |
| `scheduled_for_retry` `handler_retry` | 503 | 200 |

`Retry-After` is set only when status is 503 and `retryAfterMs` is present (`ceil(ms/1000)`, at least 1).

## Webhook request helpers

```ts
import { getHeader, resolveCorrelationId, requireStringBindings, extractWebhookSignature, processWebhookHttp } from "@paykernel/integration-http";

// Headers are case-insensitive; array values take first entry.
getHeader(headers, "stripe-signature");

// Correlation ID lookup: x-request-id → x-correlation-id → cf-ray → crypto.randomUUID()
const correlationId = resolveCorrelationId(headers);

// Env bindings — message lists keys only, never values
const { STRIPE_WEBHOOK_SECRET } = requireStringBindings(env, ["STRIPE_WEBHOOK_SECRET"]);

// Signature extraction per gateway (header / headers / header_or_query / payload)
extractWebhookSignature("stripe", headers);

// Full orchestration — do not JSON.parse rawBody
const result = await processWebhookHttp({
  gateway: "stripe",
  rawBody, // string or Uint8Array from request.text()
  headers,
  client,
  engine,
  handler,
});
return webhookHttpResultToResponse(result);
```

Do not `JSON.parse`/`JSON.stringify` the Stripe body for verification — pass the raw string/bytes unchanged. `processWebhookHttp` uses `engine.processWithVerifier` so verify (`InvalidWebhookError` → 400) and parse (`handler_failed` retryable → 500) classification matches `packages/webhooks/README.md`.

## Env helpers

`PaykernelWebhookEnv` is structural: any `Record<string, string | undefined>` with required keys. Use `requireStringBindings` / `readWorkerBindings` wrappers.

## Docs

- `docs/overview.md` — boundary, policy table, process sample
- Packages depending on this: `integration-hono`, `integration-elysia`, `integration-express`, `integration-cloudflare-workers`
