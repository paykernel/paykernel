# Logging

The SDK never writes to `console` directly. Card data, tokens, auth headers, and
customer PII can leak into logs, so all gateway logging is routed through an
injectable, **redacting** logger. The default is a no-op — the SDK is silent
unless you provide a logger.

## Configuration

```typescript
import { PaymentClient, type Logger } from '@paykernel/core';

const logger: Logger = {
  debug: (msg, ctx) => console.debug(msg, ctx),
  info: (msg, ctx) => console.info(msg, ctx),
  warn: (msg, ctx) => console.warn(msg, ctx),
  error: (msg, ctx) => console.error(msg, ctx),
};

const client = new PaymentClient({
  moyasar: { secretKey: process.env.MOYASAR_SECRET_KEY! },
  logger,
});
```

You can plug in any logger (Pino, Winston, a Cloudflare Workers logger, etc.) as
long as it implements the four methods.

## Redaction

Structured context passed as the second argument to a log method is deep-cloned
and scrubbed before it reaches your logger. Keys whose names look sensitive
(containing `secret`, `token`, `authorization`, `card`, `cvv`, `pan`, `email`,
`phone`, `name`, `address`, `signature`, `hmac`, `given_id`, and similar) are
replaced with `[REDACTED]`. Redaction is recursive and applies to nested objects
and arrays.

Operational identifiers that would otherwise match those broad substrings are
**allow-listed** so diagnostic logs stay useful. Examples:

`gateway`, `gatewayName`, `operation`, `operationName`, `event`, `eventName`,
`eventType`, `status`, `idempotencyKey`, `authorizationId`, `gatewayPaymentId`,
`gatewayId`, `captureId`, `orderId`, `paymentId`

Phase 20 `OperationContext` / telemetry diagnostics (same `redact` path):

`operationId`, `operationType`, `providerRequestId`, `providerObjectId`,
`internalReference`, `attemptNumber`, `durationMs`, `duration`, `tenant`,
`namespace`, `inboxEventKey`, `eventKey`, `normalizedOutcome`, `outcome`,
`reconciliationRequired`, `retry`, `retryable`

For structured operation bags and `createRedactingTelemetrySink`, see
[telemetry.md](./telemetry.md). Metrics, spans, and `withPaymentOperation` (which
always redacts telemetry before emit) live in
[`@paykernel/opentelemetry`](../../observability/docs/redaction.md).

```typescript
import { redact } from '@paykernel/core';

redact({ amount: 100, card: { number: '4242...' }, customerEmail: 'a@b.com' });
// => { amount: 100, card: '[REDACTED]', customerEmail: '[REDACTED]' }

redact({ gatewayId: 'pi_123', idempotencyKey: 'idem_abc', authorization: 'Bearer x' });
// => { gatewayId: 'pi_123', idempotencyKey: 'idem_abc', authorization: '[REDACTED]' }
```

### Messages and opaque tokens

`createRedactingLogger` (what gateways actually call) scrubs **both** the
structured context and the message string:

- Context keys that look sensitive (`secret`, `token`, `authorization`, …)
- Opaque leaves that look like PANs (13–19 digits)
- Embedded `sk_live_` / `whsec_` / `Bearer …` / Stripe `pi|seti_…_secret_…`
  client secrets / PayPal `A21AA…` access tokens, even on allow-listed keys
  (`internalReference`, `hookError`, …)
- Short public ids (`seti_1MqLiJ…` without `_secret_`, prefix-only `A21AA`) stay visible

```typescript
// Still bad style — keep secrets out of messages — but the default redacting
// logger replaces sk_live_ / seti_…_secret_… / A21AA… tokens in the string.
logger.error(`charge failed token=${token}`);

// Preferred: secret only in structured context
logger.error('charge failed', { token });
```

A raw `Logger` you pass in is wrapped. Do not bypass `createRedactingLogger`
and interpolate card data or tokens into free text. Observability
[`redaction.md`](../../observability/docs/redaction.md) applies the same
patterns to span messages.
