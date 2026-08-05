# Metrics (20.3)

Portable payment metrics: counters and histograms with **non-sensitive** attribute bags only.

## API

```typescript
import {
  createInMemoryPaymentMetrics,
  createNoopPaymentMetrics,
  METRIC_NAMES,
  PAYMENT_METRICS_KEYS,
  type PaymentMetrics,
  type MetricAttributes,
  type MetricsSnapshot,
  type InMemoryPaymentMetrics,
} from "@paykernel/opentelemetry";
```

| Export | Role |
| --- | --- |
| `PaymentMetrics` | Domain surface: named counter/histogram instruments |
| `createInMemoryPaymentMetrics()` | Test / local registry with `snapshot()` + `reset()` |
| `createNoopPaymentMetrics()` | No-op defaults when metrics are disabled |
| `METRIC_NAMES` | Stable wire names (`payments.*`) for dashboards/bridges |
| `PAYMENT_METRICS_KEYS` | Exhaustiveness list of instrument property names |

There is no separate `MetricsRegistry` / `PaymentMeter` type — use `PaymentMetrics` + the factories above.

## Instruments

| Property | Kind | `METRIC_NAMES` value | Typical attributes |
| --- | --- | --- | --- |
| `operationOutcomes` | counter | `payments.operation.outcomes` | `gateway`, `operationType`, `outcome` |
| `providerLatencyMs` | histogram | `payments.provider.latency_ms` | `gateway`, `operationType` |
| `rateLimits` | counter | `payments.provider.rate_limits` | `gateway` |
| `retries` | counter | `payments.operation.retries` | `gateway`, `operationType` |
| `webhookDuplicates` | counter | `payments.webhook.duplicates` | (none required) |
| `payloadConflicts` | counter | `payments.webhook.payload_conflicts` | (none required) |
| `handlerFailures` | counter | `payments.webhook.handler_failures` | (none required) |
| `expiredLeases` | counter | `payments.store.expired_leases` | (none required) |
| `reclaimedLeases` | counter | `payments.store.reclaimed_leases` | (none required) |
| `reconciliationDrift` | counter | `payments.reconciliation.drift` | `gateway`, `operationType` |
| `indeterminateOperations` | counter | `payments.operation.indeterminate` | `gateway`, `operationType` |
| `adapterLatencyMs` | histogram | `payments.adapter.latency_ms` | `adapter`, `operation` |
| `adapterErrors` | counter | `payments.adapter.errors` | `adapter`, `errorKind` |

> **OBS-3 money-drift honesty:** `reconciliationDrift` increments only when
> `countReconciliationDrift: true` **and** the op is `payment.reconcile` with
> `reconciliationRequired: true` (proven recon path). Transport-indeterminate
> creates that flag recon-needed do **not** auto-count. Default for the option
> is `false` (opt-in).

### Manual emit

```typescript
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

metrics.rateLimits.add(1, { gateway: "stripe" });
metrics.retries.add(1, { gateway: "stripe", operationType: "payment.create" });
metrics.webhookDuplicates.add(1);
metrics.payloadConflicts.add(1);
metrics.handlerFailures.add(1);
metrics.expiredLeases.add(1);
metrics.reclaimedLeases.add(1);
metrics.reconciliationDrift.add(1, {
  gateway: "stripe",
  operationType: "payment.reconcile",
});
metrics.indeterminateOperations.add(1, {
  gateway: "stripe",
  operationType: "payment.capture",
});
metrics.adapterLatencyMs.record(3, { adapter: "postgres", operation: "claim" });
metrics.adapterErrors.add(1, { adapter: "postgres", errorKind: "timeout" });
```

### Tests / snapshots

```typescript
const snap = metrics.snapshot();
// snap.samples — ordered MetricSample[]
// snap.counters[METRIC_NAMES.operationOutcomes] — summed
// snap.histograms[METRIC_NAMES.providerLatencyMs] — observations
metrics.reset();
```

`createInMemoryPaymentMetrics` is **not** a production time-series backend — use it as a test double or bridge target into your backend.

## Attribute rules (no secrets)

`MetricAttributes` is `Record<string, string | number | boolean>` only.

**Never** pass as attribute values:

- API keys, webhook secrets, auth headers, tokens
- Card numbers, PANs, CVV, client secrets
- Emails, phones, names, addresses, or other PII
- Raw request/response bodies or webhook payloads
- Full error messages that may embed secrets

**Safe** attributes: gateway name, operation type, normalized outcome enum, adapter id, error kind enum, attempt counts as numbers, durations as numbers (on histograms, not as secret-bearing strings).

Prefer allow-listed diagnostic keys aligned with `OperationContext` (see [redaction.md](./redaction.md)). Spans use the same discipline.

> **OBS-1 redaction honesty:** `createInMemoryPaymentMetrics` auto-redacts attribute keys via `redactAttributeBag` (defense-in-depth). A custom `PaymentMetrics` bridge may not — treat labels as caller-owned discipline either way.

## Instrumentation helpers

`withPaymentOperation` / `recordPaymentOperation` ([instrumentation.md](./instrumentation.md)) automatically:

1. Record `operationOutcomes` with `outcome` from `normalizedOutcome` (default label `unknown` if missing).
2. Record `providerLatencyMs` with measured `durationMs`.
3. If outcome is indeterminate (`indeterminate` or `indeterminate.*`), also increment `indeterminateOperations`.
4. If `retry === true`, increment `retries`.
5. If `countReconciliationDrift` is true **and** `reconciliationRequired === true` **and** `operationType` is `payment.reconcile` (or `payment.reconcile.*`), increment `reconciliationDrift` (OBS-3 proven money-drift path only).

Webhook duplicate/conflict/handler and lease reclaim counters are **app-owned** — increment them at the composition root when the domain package reports those outcomes (webhooks/reconciliation do not hard-depend on this package).

## Indeterminate honesty

Do not map indeterminate money outcomes to `failed` for dashboards. Keep the outcome label accurate and use `indeterminateOperations` as a dedicated counter for alerting.

## Bridging to backends

Implement `PaymentMetrics` yourself (or wrap the in-memory registry) and forward samples to Prometheus, StatsD, CloudWatch, OTEL metrics, etc. This package does not ship exporters — that keeps core and this package free of vendor SDKs.
