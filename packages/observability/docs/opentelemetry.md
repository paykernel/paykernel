# Optional OpenTelemetry bridge (20.2)

Optional, **duck-typed** bridge from this package’s `PaymentTracer` port to an injected OpenTelemetry API object.

## Hard rules

| Rule | Meaning |
| --- | --- |
| Core never depends on OTEL | `@paykernel/core` has **no** `@opentelemetry/*` dependency |
| No mandatory OTEL here | Root `import "@paykernel/opentelemetry"` works **without** `@opentelemetry/api` installed |
| No static root OTEL import | Bridge factory accepts an **injected** API; no `import … from "@opentelemetry/api"` in package production sources |
| Optional peer | `@opentelemetry/api` is an **optional** peerDependency for apps that use a real API |
| Metrics-only is fine | Counters/histograms do not require OTEL |

This is **0.14.x-style diagnostics** — not a full exporter/productization stack (that is later).

## Install (only when bridging)

```bash
bun add @paykernel/opentelemetry
# only if you use createOpenTelemetryBridge with a real API:
bun add @opentelemetry/api
```

## Span names

Canonical names (roadmap §20.2) — prefer these over free-form strings:

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

```typescript
import {
  PAYMENT_SPAN_NAMES,
  spanNameForOperationType,
  createNoopTracer,
  type PaymentTracer,
  type PaymentSpan,
} from "@paykernel/opentelemetry";

// Map OperationContext.operationType → span name (identity for known types)
const name = spanNameForOperationType("payment.create"); // "payment.create"
```

`spanNameForOperationType` returns the input string for custom operation types (passthrough).

## PaymentTracer port

```typescript
type PaymentTracer = {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): PaymentSpan;
};

type PaymentSpan = {
  end(status?: { code: "ok" | "error"; message?: string }): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException?(error: unknown): void;
};
```

| Factory | Use |
| --- | --- |
| `createNoopTracer()` | Spans disabled / default |
| `createOpenTelemetryBridge(api, options?)` | Bridge to injected OTEL API |
| App-owned `PaymentTracer` | Any other backend |

## createOpenTelemetryBridge

```typescript
import { createOpenTelemetryBridge } from "@paykernel/opentelemetry";
// or: import { createOpenTelemetryBridge } from "@paykernel/opentelemetry/otel";

import { trace, SpanStatusCode } from "@opentelemetry/api"; // app only

const tracer = createOpenTelemetryBridge(
  { trace, SpanStatusCode },
  {
    tracerName: "paykernel", // default
    // tracerVersion: "0.1.0",  // optional
  },
);
```

### Duck-typed API shape

```typescript
type OpenTelemetryApiLike = {
  trace: {
    getTracer(
      name: string,
      version?: string,
    ): {
      startSpan(
        name: string,
        options?: {
          attributes?: Record<string, string | number | boolean>;
        },
      ): OpenTelemetrySpanLike;
    };
  };
  SpanStatusCode?: { OK: number; ERROR: number };
};
```

If `SpanStatusCode` is omitted, the bridge falls back to numeric codes (`OK=1`, `ERROR=2`) when calling `setStatus`.

### Subpath export

| Import | Notes |
| --- | --- |
| `@paykernel/opentelemetry` | Root — includes bridge factory; **no** OTEL package load |
| `@paykernel/opentelemetry/otel` | Same factory on a dedicated entry for tree-shaking clarity |

Neither entry statically imports `@opentelemetry/api`.

## Span attributes (no secrets)

Only set non-sensitive primitives. Instrumentation (`withPaymentOperation`) sets from `OperationContext` when present:

- `gateway`, `operationType`, `operationId`
- optional: `tenant`, `namespace`, `internalReference`, `providerObjectId`, `providerRequestId`, `attemptNumber`, `inboxEventKey`
- on end: `normalizedOutcome`, `durationMs`, and updated provider ids

**Never** set card data, tokens, raw payloads, full error messages with secrets, or auth headers as attributes. Structured bags still go through [redaction](./redaction.md). The OTEL bridge **and** `withPaymentOperation` auto-redact attributes via `redactAttributeBag` (defense-in-depth, including secret-shaped `internalReference`). A custom `PaymentTracer` started *outside* `withPaymentOperation` may not scrub — still treat those attributes as caller-owned discipline.

## With instrumentation

```typescript
import {
  createOperationContext,
  createOpenTelemetryBridge,
  createInMemoryPaymentMetrics,
  withPaymentOperation,
} from "@paykernel/opentelemetry";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = createOpenTelemetryBridge({ trace, SpanStatusCode });
const metrics = createInMemoryPaymentMetrics();

const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.create",
});

await withPaymentOperation(
  { context: started, metrics, tracer },
  async () => ({
    result: { id: "pi_1" },
    contextPatch: {
      normalizedOutcome: "succeeded",
      providerRequestId: "req_1",
    },
  }),
);
```

See [instrumentation.md](./instrumentation.md).

## What is not included

- No OTEL SDK, resource detectors, exporters, or collectors
- No automatic Node auto-instrumentation
- No hard requirement that apps install `@opentelemetry/api` for metrics-only use
- No coupling of core or domain packages to OTEL
