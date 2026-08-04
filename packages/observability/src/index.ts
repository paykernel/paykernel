/**
 * @paykernel/opentelemetry — portable metrics, spans, and redacting telemetry glue.
 *
 * Depends only on `@paykernel/core` (core). No testkit, adapters, webhooks, or reconciliation.
 * No hard `@opentelemetry/*` dependency on the root entry — pass an injected API to
 * {@link createOpenTelemetryBridge} or import `@paykernel/opentelemetry/otel`.
 *
 * @packageDocumentation
 */

// Metrics (20.3)
export {
  METRIC_NAMES,
  PAYMENT_METRICS_KEYS,
  createInMemoryPaymentMetrics,
  createNoopPaymentMetrics,
} from "./metrics";
export type {
  Counter,
  Histogram,
  MetricAttributes,
  MetricName,
  MetricSample,
  MetricsSnapshot,
  PaymentMetrics,
  InMemoryPaymentMetrics,
} from "./metrics";

// Spans (20.2)
export {
  PAYMENT_SPAN_NAMES,
  createNoopTracer,
  spanNameForOperationType,
} from "./spans";
export type {
  PaymentSpanName,
  PaymentSpanStatus,
  PaymentSpan,
  PaymentTracer,
} from "./spans";

// Optional OTEL bridge (injected API — no static OTEL import)
export { createOpenTelemetryBridge } from "./otel";
export type {
  OpenTelemetryApiLike,
  OpenTelemetrySpanLike,
  CreateOpenTelemetryBridgeOptions,
} from "./otel";

// Instrumentation helpers
export {
  withPaymentOperation,
  recordPaymentOperation,
} from "./instrumentation";
export type {
  PaymentOperationInstrumentation,
  PaymentOperationResult,
  PaymentOperationFnResult,
} from "./instrumentation";

// Redaction (core re-exports + helper)
export {
  createRedactingTelemetrySink,
  redactTelemetryData,
} from "./redaction";
export type { TelemetrySink } from "./redaction";

// OperationContext (core re-exports)
export {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  systemClock,
} from "./context";
export type {
  OperationContext,
  CreateOperationContextInput,
  FinalizeOperationContextPatch,
  PaymentOperationType,
  Clock,
} from "./context";
