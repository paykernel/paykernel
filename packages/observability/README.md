# @paykernel/opentelemetry

Portable **payment metrics**, **span instrumentation**, and an **optional OpenTelemetry bridge** for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core).

> **Package name:** this folder is `packages/observability` in the monorepo; the published npm name is **`@paykernel/opentelemetry`**. Always install/import `@paykernel/opentelemetry`.

> **Portable.** No Node-only imports. No hard `@opentelemetry/*` dependency on the package root. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web APIs). Depends only on `@paykernel/core`.

## Explicit guarantees

| Guarantee | Detail |
| --- | --- |
| **Core has no mandatory OTEL** | `@paykernel/core` never depends on `@opentelemetry/*` or this package |
| **Structured telemetry redacted by default** | `withPaymentOperation` / `createRedactingTelemetrySink` scrub bags via core `redact()`; **in-package metric registry + OTEL bridge also auto-redact labels/span attrs** via `redactAttributeBag` (defense-in-depth). Still set only non-sensitive primitives — custom tracers/backends may not scrub |
| **Exceptions sanitized on spans** | `recordException` exports name (+ optional code) only — never raw `Error.message` / stack |
| **Failed/indeterminate spans end error** | Non-throw `failed` / `declined` / `indeterminate` outcomes end span `code: "error"` (not OK) so OTEL error rates track payment failures |
| **`providerRequestId` for debugging** | Allow-listed and visible on `OperationContext` / redacted telemetry (A1) |
| **Metrics without OTEL** | In-memory / no-op metrics work with zero OTEL install |
| **Optional peer only** | `@opentelemetry/api` is optional; root import works without it |

## Install

```bash
bun add @paykernel/opentelemetry
# peer / workspace: @paykernel/core
# optional: bun add @opentelemetry/api   # only if you use the OTEL bridge with a real API
```

## Quickstart

### 1. Metrics (in-memory for tests / local adapters)

```typescript
import {
  createInMemoryPaymentMetrics,
  METRIC_NAMES,
} from "@paykernel/opentelemetry";

const metrics = createInMemoryPaymentMetrics();
metrics.operationOutcomes.add(1, {
  gateway: "stripe",
  operationType: "payment.create",
  outcome: "succeeded",
});
metrics.providerLatencyMs.record(42, {
  gateway: "stripe",
  operationType: "payment.create",
});

// tests
const snap = metrics.snapshot();
console.log(snap.counters[METRIC_NAMES.operationOutcomes]);
```

**Never pass secrets, tokens, card data, or PII as metric attribute values.** Labels must be non-sensitive primitives only.

### 2. Redacting telemetry + OperationContext

```typescript
import {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  createRedactingTelemetrySink,
} from "@paykernel/opentelemetry";

const telemetry = createRedactingTelemetrySink({
  emit(event, data) {
    console.info(event, data);
  },
});

const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.create",
  internalReference: "ord_123",
});

const finished = finalizeOperationContext(started, {
  durationMs: 42,
  normalizedOutcome: "succeeded",
  providerRequestId: "req_abc", // visible after redaction
});

telemetry.emit?.(
  "payment.operation",
  operationContextToTelemetryData(finished),
);
// cardNumber / token / secret keys → [REDACTED]
```

Core surface (same APIs): see [`packages/core/docs/telemetry.md`](../core/docs/telemetry.md) and [docs/redaction.md](./docs/redaction.md).

### 3. Instrument one operation (`withPaymentOperation`)

```typescript
import {
  createOperationContext,
  createInMemoryPaymentMetrics,
  createNoopTracer,
  withPaymentOperation,
  createRedactingTelemetrySink,
} from "@paykernel/opentelemetry";

const metrics = createInMemoryPaymentMetrics();
const telemetry = createRedactingTelemetrySink({
  emit(event, data) {
    console.info(event, data);
  },
});

const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.create",
  internalReference: "ord_123",
});

const { result, context } = await withPaymentOperation(
  {
    context: started,
    metrics,
    tracer: createNoopTracer(),
    telemetry,
  },
  async () => {
    // … call gateway …
    return {
      result: { id: "pi_123" },
      contextPatch: {
        normalizedOutcome: "succeeded",
        providerObjectId: "pi_123",
        providerRequestId: "req_abc",
      },
    };
  },
);

// Indeterminate is labeled as-is and also increments indeterminateOperations.
void result;
void context;
```

Full samples: [docs/instrumentation.md](./docs/instrumentation.md).

### 4. Optional OpenTelemetry bridge (injected API)

Root import works **without** `@opentelemetry/api` installed. Pass the API in:

```typescript
import { createOpenTelemetryBridge } from "@paykernel/opentelemetry";
// or: import { createOpenTelemetryBridge } from "@paykernel/opentelemetry/otel";

// Only when the peer is installed in the app:
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = createOpenTelemetryBridge({ trace, SpanStatusCode });
```

There is **no** static import of `@opentelemetry/api` in this package’s root or `./otel` entry — factories are duck-typed. Details: [docs/opentelemetry.md](./docs/opentelemetry.md).

## Span names

| Constant | Name |
| --- | --- |
| `PAYMENT_SPAN_NAMES.create` | `payment.create` |
| `PAYMENT_SPAN_NAMES.capture` | `payment.capture` |
| `PAYMENT_SPAN_NAMES.refund` | `payment.refund` |
| `PAYMENT_SPAN_NAMES.void` | `payment.void` |
| `PAYMENT_SPAN_NAMES.webhookVerify` | `payment.webhook.verify` |
| `PAYMENT_SPAN_NAMES.webhookClaim` | `payment.webhook.claim` |
| `PAYMENT_SPAN_NAMES.webhookProcess` | `payment.webhook.process` |
| `PAYMENT_SPAN_NAMES.reconcile` | `payment.reconcile` |
| `PAYMENT_SPAN_NAMES.storeClaim` | `payment.store.claim` |

## Metrics instruments (20.3)

`operationOutcomes`, `providerLatencyMs`, `rateLimits`, `retries`, `webhookDuplicates`, `payloadConflicts`, `handlerFailures`, `expiredLeases`, `reclaimedLeases`, `reconciliationDrift`, `indeterminateOperations`, `adapterLatencyMs`, `adapterErrors`.

Wire names: `METRIC_NAMES` (`payments.*`). Guide: [docs/metrics.md](./docs/metrics.md).

## Documentation

| Doc | Content |
| --- | --- |
| [docs/overview.md](./docs/overview.md) | Purpose, package boundary, no mandatory OTEL |
| [docs/operation-context.md](./docs/operation-context.md) | 20.1 fields, builders, `providerRequestId` |
| [docs/metrics.md](./docs/metrics.md) | Counters/histograms, names, attribute rules |
| [docs/redaction.md](./docs/redaction.md) | Same model as logs; redacting sink |
| [docs/opentelemetry.md](./docs/opentelemetry.md) | Optional bridge, span names, core free of OTEL |
| [docs/instrumentation.md](./docs/instrumentation.md) | `withPaymentOperation` samples |
| [../core/docs/telemetry.md](../core/docs/telemetry.md) | Core `TelemetrySink` + OperationContext |
| [../core/docs/logging.md](../core/docs/logging.md) | Shared `redact()` / allow-list |

## Boundaries

- Depends **only** on `@paykernel/core` (core).
- Does **not** depend on testkit, adapters, webhooks, or reconciliation.
- Core must **not** depend on this package.
- Apps compose webhooks/reconciliation with metrics/spans via injection — no hard coupling.

See monorepo: [`docs/workspace-boundaries.md`](../../docs/workspace-boundaries.md), [`docs/monorepo.md`](../../docs/monorepo.md).

## Public exports (root)

```typescript
// Metrics
createInMemoryPaymentMetrics, createNoopPaymentMetrics, METRIC_NAMES, PAYMENT_METRICS_KEYS
// Spans
PAYMENT_SPAN_NAMES, createNoopTracer, spanNameForOperationType
// OTEL bridge (duck-typed injected API)
createOpenTelemetryBridge
// Instrumentation
withPaymentOperation, recordPaymentOperation
// Redaction (core re-exports + helper)
createRedactingTelemetrySink, redactTelemetryData
// OperationContext (core re-exports)
createOperationContext, finalizeOperationContext, operationContextToTelemetryData, systemClock
```

Subpath: `@paykernel/opentelemetry/otel` — same `createOpenTelemetryBridge` entry.
