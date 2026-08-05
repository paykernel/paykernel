# Observability overview

**Phase 20** package: vendor-neutral operational diagnostics for payment systems built on [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core).

Package: **`@paykernel/opentelemetry`** · path: `packages/observability`

## Purpose

Make production payment behavior **observable** without coupling the core SDK (or your app) to a single metrics/tracing vendor:

| Surface | Role |
| --- | --- |
| **Metrics** | Portable `PaymentMetrics` counters/histograms (`createInMemoryPaymentMetrics`, `createNoopPaymentMetrics`) |
| **Spans** | Duck-typed `PaymentTracer` + `PAYMENT_SPAN_NAMES` |
| **Instrumentation** | `withPaymentOperation` / `recordPaymentOperation` compose context + metrics + spans + redacted telemetry |
| **Redaction** | Same model as logs — package-owned `createRedactingTelemetrySink` / `redactTelemetryData` on core `redact()` (not a pure re-export; OBS-1) |
| **Optional OTEL** | `createOpenTelemetryBridge(injectedApi)` — **no** hard `@opentelemetry/*` on the package root |

Core remains free of OpenTelemetry. Metrics-only paths do **not** require `@opentelemetry/api`.

## Package boundary

```text
@paykernel/opentelemetry
  └── depends on @paykernel/core (core) only

MUST NOT depend on:
  testkit · adapters · webhooks · reconciliation · internal/sql-store

Core MUST NOT depend on this package (boundary inversion forbidden).
```

| Rule | Meaning |
| --- | --- |
| Portable | `paymentsSdk.portable: true` — no `node:`, `bun:`, or `cloudflare:` in production sources; no `node:perf_hooks` |
| Optional peer | `@opentelemetry/api` is **optional**; root `import "@paykernel/opentelemetry"` works without it |
| Composition | Webhooks / reconciliation stay free of a hard observability dependency — apps inject metrics/tracer/sink at the composition root |
| Secrets | Structured telemetry bags are redacted by default (`createRedactingTelemetrySink`). **In-package** metric registry (`createInMemoryPaymentMetrics`) and OTEL bridge auto-redact metric labels / span attributes via `redactAttributeBag` (OBS-1 honesty). Callers should still set only non-sensitive primitives — a hand-rolled `PaymentMetrics` / `PaymentTracer` may not scrub. Span exceptions are sanitized to name/code (no raw message/stack). |

See monorepo policy: [`docs/workspace-boundaries.md`](../../../docs/workspace-boundaries.md).

## Design rules

1. **Core stays free of OTEL** — bridge lives here, duck-typed, injected.
2. **Redaction** — structured telemetry bags use core `redact()` via this package’s `createRedactingTelemetrySink` (same allow-list as logs; package-owned, not a pure re-export).
3. **Portable duration** — `Clock.nowMs()` / `systemClock` (no `node:perf_hooks`).
4. **Optional peer** — metrics and redacting telemetry work without OTEL installed.
5. **No secret labels** — metric attributes and span attributes must not carry secrets/PII/raw payloads.
6. **`providerRequestId` visible** — allow-listed for operational debugging after redaction (A1).
7. **Indeterminate honesty** — never collapse `indeterminate` to a generic failure label for metrics.

## Instruments (20.3)

| Property | Kind | Typical labels |
| --- | --- | --- |
| `operationOutcomes` | counter | gateway, operationType, outcome |
| `providerLatencyMs` | histogram | gateway, operationType |
| `rateLimits` | counter | gateway |
| `retries` | counter | gateway, operationType |
| `webhookDuplicates` | counter | — |
| `payloadConflicts` | counter | — |
| `handlerFailures` | counter | — |
| `expiredLeases` | counter | — |
| `reclaimedLeases` | counter | — |
| `reconciliationDrift` | counter | gateway, operationType (opt-in: `countReconciliationDrift` + `payment.reconcile` + `reconciliationRequired` — OBS-3) |
| `indeterminateOperations` | counter | gateway, operationType |
| `adapterLatencyMs` | histogram | adapter, operation |
| `adapterErrors` | counter | adapter, errorKind |

Stable wire names live in `METRIC_NAMES` (`payments.*` prefix). Full guide: [metrics.md](./metrics.md).

## Indeterminate handling

`withPaymentOperation` / `recordPaymentOperation` keep `normalizedOutcome: "indeterminate"` (and `indeterminate.*` prefixes) on the outcome counter **and** increment `indeterminateOperations`. They do not rewrite indeterminate to `failed` for metrics labels.

## Composition model

```text
App composition root
  ├── createInMemoryPaymentMetrics() | createNoopPaymentMetrics() | custom PaymentMetrics
  ├── createNoopTracer() | createOpenTelemetryBridge(api) | custom PaymentTracer
  ├── createRedactingTelemetrySink(appSink)
  └── withPaymentOperation({ context, metrics?, tracer?, telemetry? }, fn)

Domain packages (webhooks / reconciliation / adapters)
  └── remain free of hard @paykernel/opentelemetry dependency
      (inject ports at the app layer when you want metrics/spans)
```

Core types (`OperationContext`, `TelemetrySink`) live in `@paykernel/core` and are re-exported here. `createRedactingTelemetrySink` / `redactTelemetryData` are **package-owned** implementations on core `redact()` (OBS-1 honesty — not pure re-exports). Core also exports its own sink wrapper for gateway context. Core docs: [`packages/core/docs/telemetry.md`](../../core/docs/telemetry.md).

## Docs in this package

| Doc | Content |
| --- | --- |
| [overview.md](./overview.md) | This page — purpose, boundary, no mandatory OTEL |
| [operation-context.md](./operation-context.md) | 20.1 fields, builders, `providerRequestId` debugging |
| [metrics.md](./metrics.md) | 20.3 counters/histograms, names, attribute rules |
| [redaction.md](./redaction.md) | Same model as logs; redacting sink; allow-listed keys |
| [opentelemetry.md](./opentelemetry.md) | Optional bridge, span names, core never depends on OTEL |
| [instrumentation.md](./instrumentation.md) | `withPaymentOperation` usage samples |

## What this package is not

- Not a full OTEL SDK, exporter, or collector product (that is 1.1.x productization territory).
- Not a routing package (Phase 21).
- Not a mandatory dependency of webhooks, reconciliation, or core.
- Not a place to put secrets or raw provider payloads.
