# Telemetry & Operation Context

Phase 20 core foundation for structured diagnostics. The SDK does **not** hard-depend on OpenTelemetry (or any metrics backend). Integrators inject an optional `TelemetrySink`; prefer wrapping it with `createRedactingTelemetrySink` so secrets never leave the SDK path.

Full metrics / span bridge lives in the optional package **`@paykernel/opentelemetry`** (`packages/observability`). This document covers the **core** surface only.

| Layer | Package | Docs |
| --- | --- | --- |
| Core hooks | `@paykernel/core` | this page, [logging.md](./logging.md), [runtime.md](./runtime.md) |
| Metrics, spans, OTEL bridge, `withPaymentOperation` | `@paykernel/opentelemetry` | [overview](../../observability/docs/overview.md), [instrumentation](../../observability/docs/instrumentation.md), [redaction](../../observability/docs/redaction.md) |
| Gateway selection (select-only) | `@paykernel/routing` | [routing telemetry](../../routing/docs/telemetry.md), [overview](../../routing/docs/overview.md) |

When using Phase 21 routing, pass `decision.gateway` into `createPayment` and into `OperationContext.gateway`, and emit `decisionToTelemetryAttributes(decision)` for non-sensitive match metadata. Core does **not** depend on the routing package — apps compose at the root.

## TelemetrySink

`GatewayContext.telemetry` is optional:

```typescript
import {
  createDefaultGatewayContext,
  createRedactingTelemetrySink,
  type TelemetrySink,
} from '@paykernel/core';

const raw: TelemetrySink = {
  emit(event, data) {
    // app-owned: metrics, logs, OTEL bridge, etc.
    console.info(event, data);
  },
};

const ctx = createDefaultGatewayContext({
  telemetry: createRedactingTelemetrySink(raw),
});
```

`TelemetrySink` remains additive and optional for 0.x compatibility. Do **not** put secrets, card data, tokens, or raw webhook payloads on emit data.

### Redacting sink (required for safe defaults)

```typescript
import { createRedactingTelemetrySink, redact } from '@paykernel/core';

// Same scrubbing model as logs (`redact` / `createRedactingLogger`)
const safe = createRedactingTelemetrySink(mySink);
safe.emit?.('payment.operation', {
  providerRequestId: 'req_abc', // visible (allow-listed)
  cardNumber: '4242…',          // → [REDACTED]
});
```

Always wrap application sinks with `createRedactingTelemetrySink` unless you have already scrubbed every payload yourself with `redact`.

## OperationContext

Structured bag for one operation attempt — correlation ids and outcome metadata without secrets:

| Field | Notes |
| --- | --- |
| `operationId` | Required — app/SDK attempt id |
| `gateway` | Required — gateway name |
| `operationType` | Required — e.g. `payment.create`, `payment.webhook.process` |
| `tenant` / `namespace` | Multi-tenant diagnostics |
| `internalReference` | App order / intent reference |
| `providerObjectId` | Provider payment / object id |
| `providerRequestId` | Provider request / correlation id (**for operational debugging**) |
| `attemptNumber` | Retry attempt index |
| `durationMs` | Set on finalize |
| `normalizedOutcome` | e.g. `succeeded` \| `declined` \| `failed` \| `indeterminate` |
| `retry` / `reconciliationRequired` | Flags |
| `inboxEventKey` | Webhook inbox key |

Optional fields use exactOptionalPropertyTypes: helpers **omit** keys when absent (never assign `undefined`).

```typescript
import {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  createRedactingTelemetrySink,
} from '@paykernel/core';

const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: 'stripe',
  operationType: 'payment.create',
  internalReference: 'ord_123',
});

// … perform work, measure duration with your clock (portable: Date.now / injected clock) …

const finished = finalizeOperationContext(started, {
  durationMs: 42,
  normalizedOutcome: 'succeeded',
  providerObjectId: 'pi_…',
  providerRequestId: 'req_…',
});

telemetry.emit?.(
  'payment.operation',
  operationContextToTelemetryData(finished),
);
```

### `providerRequestId` for debugging (A1)

Payment / refund results and `ProviderReferences` already carry optional `providerRequestId` (Phase 6). Put the same value on `OperationContext` so telemetry and logs can correlate a single provider request without raw payloads. The redaction allow-list keeps `providerRequestId` visible; secrets remain scrubbed.

See also [operation-results.md](./operation-results.md) and [logging.md](./logging.md).

## PaymentOperationType

Canonical labels (open string union for custom types):

- `payment.create` / `payment.capture` / `payment.refund` / `payment.void`
- `payment.webhook.verify` / `payment.webhook.claim` / `payment.webhook.process`
- `payment.reconcile` / `payment.store.claim`

## Redaction allow-list (diagnostics)

Shared with logs via `redact()`. Phase 20 allow-listed keys (lowercase match) include:

`operationId`, `operationType`, `providerRequestId`, `providerObjectId`, `internalReference`, `attemptNumber`, `durationMs`, `duration`, `tenant`, `namespace`, `inboxEventKey`, `eventKey`, `normalizedOutcome`, `outcome`, `reconciliationRequired`, `retry`, `retryable`

Still redacted by substring patterns: `secret`, `token`, `card`, `email`, `phone`, `authorization`, `clientSecret`, etc. Do not broaden the allow-list for PII field names.

## Portability

- No `node:perf_hooks` — measure duration with injectable `Clock` / `Date.now`.
- No `@opentelemetry/*` dependency in core.
- Optional OTEL bridge (if used) must be composed outside core, with injected API only — see [`@paykernel/opentelemetry` opentelemetry.md](../../observability/docs/opentelemetry.md).

## Related

- [logging.md](./logging.md) — shared `redact()` / allow-list (telemetry uses the same model)
- [runtime.md](./runtime.md) — `PaymentRuntime`, `GatewayContext.telemetry?`, clocks
- [operation-results.md](./operation-results.md) — outcomes / `providerRequestId` on results
- Observability package: [README](../../observability/README.md)
