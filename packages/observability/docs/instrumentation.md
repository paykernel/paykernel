# Instrumentation helpers

Compose `OperationContext` + metrics + spans + redacting telemetry for one payment operation.

## Exports

```typescript
import {
  withPaymentOperation,
  recordPaymentOperation,
  type PaymentOperationInstrumentation,
  type PaymentOperationResult,
  type PaymentOperationFnResult,
} from "@paykernel/opentelemetry";
```

| Function | Role |
| --- | --- |
| `withPaymentOperation(options, fn)` | Time `fn`, start/end span, finalize context, metrics, redacted emit; rethrows errors |
| `recordPaymentOperation(options)` | Record metrics + telemetry for an already-completed op (no span lifecycle) |

## Options (`PaymentOperationInstrumentation`)

| Field | Required | Notes |
| --- | --- | --- |
| `context` | yes | Started `OperationContext` |
| `metrics` | no | `PaymentMetrics` |
| `tracer` | no | `PaymentTracer` (`createNoopTracer` / OTEL bridge / custom) |
| `telemetry` | no | Raw or redacting `TelemetrySink` — **always** re-wrapped with `createRedactingTelemetrySink` before emit |
| `clock` | no | Injectable `Clock` (default `systemClock`) |
| `telemetryEvent` | no | Default `"payment.operation"` |
| `countReconciliationDrift` | no | Default `true` — when finalize has `reconciliationRequired: true`, increment `reconciliationDrift` |

## withPaymentOperation

### Basic success

```typescript
import {
  createOperationContext,
  createInMemoryPaymentMetrics,
  createNoopTracer,
  createRedactingTelemetrySink,
  withPaymentOperation,
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

const { result, context, durationMs } = await withPaymentOperation(
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
        providerRequestId: "req_abc", // visible after redaction
      },
    };
  },
);

console.log(result.id, context.normalizedOutcome, durationMs);
```

### Callback return shapes

The callback may return:

1. **Plain value** — used as `result`; no context patch beyond duration (and `failed` if thrown).
2. **Wrapped** `{ result, contextPatch? }` — only when object keys are exactly `result` and/or `contextPatch` (avoids mistaking domain objects that happen to have a `result` field).

```typescript
// Plain
await withPaymentOperation({ context: started }, async () => "ok");

// Wrapped with patch
await withPaymentOperation({ context: started }, async () => ({
  result: payment,
  contextPatch: {
    normalizedOutcome: "indeterminate",
    reconciliationRequired: true,
    providerRequestId: payment.providerRequestId,
  },
}));
```

### Errors

On throw:

- Span ends with `code: "error"` (optional `recordException`).
- Finalize sets `normalizedOutcome: "failed"` if the patch did not already set an outcome.
- Metrics record the failed outcome; latency still recorded.
- Telemetry may include `errorName` only (not `error.message` — may contain secrets).
- Error is **rethrown** after instrumentation.

```typescript
try {
  await withPaymentOperation(
    { context: started, metrics, tracer, telemetry },
    async () => {
      throw new Error("provider down");
    },
  );
} catch {
  // still rethrown after metrics/span/telemetry
}
```

### Indeterminate outcomes

```typescript
await withPaymentOperation(
  { context: started, metrics },
  async () => ({
    result: uncertain,
    contextPatch: { normalizedOutcome: "indeterminate" },
  }),
);
// operationOutcomes labeled outcome=indeterminate
// AND indeterminateOperations += 1
// (never collapsed to failed)
```

Outcomes matching `indeterminate` or `indeterminate.*` (case-insensitive) trigger the extra counter.

### Retries and reconciliation flags

```typescript
await withPaymentOperation(
  { context: started, metrics, countReconciliationDrift: true },
  async () => ({
    result: x,
    contextPatch: {
      normalizedOutcome: "succeeded",
      retry: true, // → retries counter
      reconciliationRequired: true, // → reconciliationDrift counter
    },
  }),
);
```

### Optional OTEL tracer

```typescript
import { createOpenTelemetryBridge } from "@paykernel/opentelemetry";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = createOpenTelemetryBridge({ trace, SpanStatusCode });

await withPaymentOperation(
  {
    context: createOperationContext({
      operationId: crypto.randomUUID(),
      gateway: "paypal",
      operationType: "payment.capture",
    }),
    metrics,
    tracer,
  },
  async () => ({
    result: capture,
    contextPatch: {
      normalizedOutcome: "succeeded",
      providerRequestId: capture.providerRequestId,
    },
  }),
);
```

Span name comes from `context.operationType` via `spanNameForOperationType`.

### Fake clock (tests)

```typescript
let now = 1_000;
const clock = {
  now: () => new Date(now),
  nowMs: () => now,
};

const p = withPaymentOperation(
  { context: started, metrics, clock },
  async () => {
    now = 1_042;
    return { result: true, contextPatch: { normalizedOutcome: "succeeded" } };
  },
);

const { durationMs } = await p; // 42
```

No `node:perf_hooks`.

### Webhook process (app composition)

Webhooks package stays free of a hard observability dependency — wrap at the app layer:

```typescript
const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.webhook.process",
  inboxEventKey: key,
  namespace: "prod",
});

await withPaymentOperation(
  { context: started, metrics, tracer, telemetry },
  async () => {
    const outcome = await engine.process(/* … */);
    if (outcome.kind === "duplicate") {
      metrics.webhookDuplicates.add(1);
    }
    return {
      result: outcome,
      contextPatch: {
        normalizedOutcome: mapOutcome(outcome),
      },
    };
  },
);
```

### Reconciliation (app composition)

```typescript
const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: target.gateway,
  operationType: "payment.reconcile",
  providerObjectId: target.gatewayPaymentId,
});

await withPaymentOperation(
  { context: started, metrics, tracer },
  async () => {
    const result = await reconciler.reconcile(target);
    return {
      result,
      contextPatch: {
        normalizedOutcome: result.kind,
        reconciliationRequired: result.kind === "drift",
      },
    };
  },
);
```

## recordPaymentOperation

When duration/outcome are already known (batch jobs, external timers):

```typescript
import { recordPaymentOperation } from "@paykernel/opentelemetry";

const finished = recordPaymentOperation({
  context: started,
  metrics,
  telemetry,
  durationMs: 15,
  normalizedOutcome: "succeeded",
  // error?: unknown  — sets errorName only on telemetry bag
});
```

Does not start/end a span. Still applies the same metrics rules and redacting emit.

## Return type

```typescript
type PaymentOperationResult<T> = {
  result: T;
  context: OperationContext; // finalized
  durationMs: number;
};
```

## Related

- [operation-context.md](./operation-context.md) — context fields and builders
- [metrics.md](./metrics.md) — instruments and attribute rules
- [redaction.md](./redaction.md) — redacting sinks
- [opentelemetry.md](./opentelemetry.md) — optional bridge
- [overview.md](./overview.md) — package boundary
