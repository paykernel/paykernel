# Operation context (20.1)

Structured, **secret-free** bag describing a single payment operation attempt. Source of truth is **core** (`@paykernel/core`); this package re-exports the builders so apps can depend on observability alone for the diagnostics path.

Core guide: [`packages/core/docs/telemetry.md`](../../core/docs/telemetry.md).

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `operationId` | yes | App/SDK attempt id (correlation) |
| `gateway` | yes | Gateway name (e.g. `stripe`) |
| `operationType` | yes | e.g. `payment.create`, `payment.webhook.process` |
| `tenant` | no | Multi-tenant diagnostics |
| `namespace` | no | Logical partition / env namespace |
| `internalReference` | no | App order / intent reference |
| `providerObjectId` | no | Provider payment / object id |
| `providerRequestId` | no | Provider request / correlation id (**operational debugging**) |
| `attemptNumber` | no | Retry attempt index |
| `durationMs` | no | Set on finalize |
| `normalizedOutcome` | no | e.g. `succeeded` \| `declined` \| `failed` \| `indeterminate` |
| `retry` | no | Flag: this attempt is a retry |
| `reconciliationRequired` | no | Flag: recon needed after this op |
| `inboxEventKey` | no | Webhook inbox event key |

Optional fields use `exactOptionalPropertyTypes`: helpers **omit** keys when absent (never assign `undefined`).

## Builders

```typescript
import {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  type OperationContext,
  type PaymentOperationType,
} from "@paykernel/opentelemetry";
// or from "@paykernel/core"
```

### `createOperationContext(input)`

Requires `operationId`, `gateway`, `operationType`. Copies optional fields only when present.

```typescript
const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.create",
  internalReference: "ord_123",
  tenant: "acme",
});
```

### `finalizeOperationContext(ctx, patch?)`

Returns a **new** context (does not mutate the input). Patch keys overwrite when present.

```typescript
const finished = finalizeOperationContext(started, {
  durationMs: 42,
  normalizedOutcome: "succeeded",
  providerObjectId: "pi_123",
  providerRequestId: "req_abc",
});
```

### `operationContextToTelemetryData(ctx)`

Plain `Record<string, unknown>` with only defined keys — suitable for `TelemetrySink.emit` **after** redaction.

```typescript
import { createRedactingTelemetrySink } from "@paykernel/opentelemetry";

const sink = createRedactingTelemetrySink({
  emit(event, data) {
    console.info(event, data);
  },
});

sink.emit?.("payment.operation", operationContextToTelemetryData(finished));
```

Prefer `withPaymentOperation` ([instrumentation.md](./instrumentation.md)), which finalizes, records metrics/spans, and emits redacted telemetry for you.

## `PaymentOperationType`

Canonical labels (open string union for custom types):

| Value | Typical use |
| --- | --- |
| `payment.create` | Create / authorize |
| `payment.capture` | Capture |
| `payment.refund` | Refund |
| `payment.void` | Void / cancel |
| `payment.webhook.verify` | Signature verify |
| `payment.webhook.claim` | Inbox claim |
| `payment.webhook.process` | Inbox process |
| `payment.reconcile` | Reconciliation check |
| `payment.store.claim` | Lease-aware store claim |

Span mapping uses the same strings via `PAYMENT_SPAN_NAMES` / `spanNameForOperationType` — see [opentelemetry.md](./opentelemetry.md).

## `providerRequestId` for debugging (A1)

Payment / refund results and `ProviderReferences` already carry optional `providerRequestId` (Phase 6). Put the same value on `OperationContext` so telemetry, logs, and spans can correlate a single provider request **without** raw payloads.

- Redaction allow-list keeps `providerRequestId` **visible** (same as logs).
- Secrets, tokens, card data remain scrubbed.
- Prefer this over dumping full provider response bodies into telemetry.

See also [operation-results.md](../../core/docs/operation-results.md) and [redaction.md](./redaction.md).

## Duration (portable)

Do **not** use `node:perf_hooks`. Measure with injectable `Clock` / `Date.now`:

```typescript
import { systemClock, finalizeOperationContext } from "@paykernel/opentelemetry";

const startMs = systemClock.nowMs();
// … work …
const durationMs = Math.max(0, systemClock.nowMs() - startMs);
const finished = finalizeOperationContext(started, { durationMs });
```

`withPaymentOperation` does this automatically via `options.clock` (default `systemClock`).

## Wiring from domain flows

Builders are pure — any layer can construct context from payments, webhooks, reconciliation, or store claims:

```typescript
// Webhook process (app composition — webhooks package stays free of observability dep)
const ctx = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.webhook.process",
  inboxEventKey: eventKey,
  namespace: "prod",
});

// Reconciliation
const reconCtx = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: target.gateway,
  operationType: "payment.reconcile",
  providerObjectId: target.gatewayPaymentId,
  internalReference: target.internalReference,
});

// Store claim
const claimCtx = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: "stripe",
  operationType: "payment.store.claim",
  namespace: storeNamespace,
});
```

Pass the started context into `withPaymentOperation` or finalize + emit yourself.

## Types re-exported

| Export | Kind |
| --- | --- |
| `OperationContext` | type |
| `CreateOperationContextInput` | type |
| `FinalizeOperationContextPatch` | type |
| `PaymentOperationType` | type |
| `Clock` | type (from core runtime) |
| `createOperationContext` | function |
| `finalizeOperationContext` | function |
| `operationContextToTelemetryData` | function |
| `systemClock` | value |
