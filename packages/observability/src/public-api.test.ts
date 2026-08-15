/**
 * Public API surface — freezes runtime export names for @paykernel/opentelemetry.
 */
import { describe, it, expect } from "bun:test";
import * as observability from "./index";

describe("public API runtime surface", () => {
  it("re-exports every documented runtime symbol from the package root", () => {
    const runtimeExports: Array<[string, unknown]> = [
      // Metrics
      ["METRIC_NAMES", observability.METRIC_NAMES],
      ["PAYMENT_METRICS_KEYS", observability.PAYMENT_METRICS_KEYS],
      ["createInMemoryPaymentMetrics", observability.createInMemoryPaymentMetrics],
      ["createNoopPaymentMetrics", observability.createNoopPaymentMetrics],
      // Spans
      ["PAYMENT_SPAN_NAMES", observability.PAYMENT_SPAN_NAMES],
      ["createNoopTracer", observability.createNoopTracer],
      ["spanNameForOperationType", observability.spanNameForOperationType],
      // OTEL bridge (factory only — no static OTEL)
      ["createOpenTelemetryBridge", observability.createOpenTelemetryBridge],
      // Instrumentation
      ["withPaymentOperation", observability.withPaymentOperation],
      ["recordPaymentOperation", observability.recordPaymentOperation],
      ["sanitizeExceptionForSpan", observability.sanitizeExceptionForSpan],
      // Redaction
      ["createRedactingTelemetrySink", observability.createRedactingTelemetrySink],
      ["redactTelemetryData", observability.redactTelemetryData],
      ["redactAttributeBag", observability.redactAttributeBag],
      ["sanitizeExceptionCode", observability.sanitizeExceptionCode],
      ["sanitizeExceptionIdentity", observability.sanitizeExceptionIdentity],
      // OperationContext (core)
      ["createOperationContext", observability.createOperationContext],
      ["finalizeOperationContext", observability.finalizeOperationContext],
      ["operationContextToTelemetryData", observability.operationContextToTelemetryData],
      ["systemClock", observability.systemClock],
    ];

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
    }

    expect(typeof observability.createInMemoryPaymentMetrics).toBe("function");
    expect(typeof observability.createNoopPaymentMetrics).toBe("function");
    expect(typeof observability.createNoopTracer).toBe("function");
    expect(typeof observability.createOpenTelemetryBridge).toBe("function");
    expect(typeof observability.withPaymentOperation).toBe("function");
    expect(typeof observability.recordPaymentOperation).toBe("function");
    expect(typeof observability.createRedactingTelemetrySink).toBe("function");
    expect(typeof observability.createOperationContext).toBe("function");
    expect(typeof observability.finalizeOperationContext).toBe("function");
  });

  it("root module does not require @opentelemetry/api (A2)", async () => {
    // Dynamic re-import of root must succeed without OTEL installed.
    const mod = await import("./index");
    expect(mod.createOpenTelemetryBridge).toBeDefined();
    expect(mod.createInMemoryPaymentMetrics).toBeDefined();
    // Ensure no accidental default export of OTEL symbols
    expect((mod as Record<string, unknown>).trace).toBeUndefined();
    expect((mod as Record<string, unknown>).SpanStatusCode).toBeUndefined();
  });

  it("PAYMENT_SPAN_NAMES covers roadmap 20.2 names", () => {
    expect(Object.values(observability.PAYMENT_SPAN_NAMES).sort()).toEqual(
      [
        "payment.capture",
        "payment.create",
        "payment.reconcile",
        "payment.refund",
        "payment.store.claim",
        "payment.void",
        "payment.webhook.claim",
        "payment.webhook.process",
        "payment.webhook.verify",
      ].sort(),
    );
  });
});
