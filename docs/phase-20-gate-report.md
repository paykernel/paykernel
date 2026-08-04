# Phase 20 gate report (pointer)

**Verdict:** **PASS** (adversarial, fail-closed)  
**Date (UTC):** 2026-08-04

Full report (baseline convention):

→ **[`packages/core/docs/baseline/phase-20-gate-report.md`](../packages/core/docs/baseline/phase-20-gate-report.md)**

Package-local twin:

→ **[`packages/observability/docs/phase-20-gate-report.md`](../packages/observability/docs/phase-20-gate-report.md)**

Primary Phase 20 deliverable:

→ **[`packages/observability`](../packages/observability)** — `@paykernel/opentelemetry` (portable; core-only; `PaymentMetrics`, span names, redacting telemetry glue, optional injected OTEL bridge — **no** hard OTEL dep in core)

Core foundation:

→ **[`packages/core/docs/telemetry.md`](../packages/core/docs/telemetry.md)** — `OperationContext`, `createRedactingTelemetrySink`, `providerRequestId` allow-list
