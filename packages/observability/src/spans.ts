/**
 * Phase 20.2 — span name constants and duck-typed PaymentTracer port.
 * No OpenTelemetry imports here; bridges live in otel.ts with injected API.
 */

/**
 * Canonical payment span names (roadmap §20.2).
 * Prefer these over free-form strings for interoperable dashboards.
 */
export const PAYMENT_SPAN_NAMES = {
  create: "payment.create",
  capture: "payment.capture",
  refund: "payment.refund",
  void: "payment.void",
  webhookVerify: "payment.webhook.verify",
  webhookClaim: "payment.webhook.claim",
  webhookProcess: "payment.webhook.process",
  reconcile: "payment.reconcile",
  storeClaim: "payment.store.claim",
} as const;

export type PaymentSpanName =
  (typeof PAYMENT_SPAN_NAMES)[keyof typeof PAYMENT_SPAN_NAMES];

/** Span end status (portable; not OTEL StatusCode numbers). */
export type PaymentSpanStatus = {
  code: "ok" | "error";
  message?: string;
};

/** Active span handle returned by {@link PaymentTracer.startSpan}. */
export type PaymentSpan = {
  end(status?: PaymentSpanStatus): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException?(error: unknown): void;
};

/**
 * Minimal tracer port. Implementations: {@link createNoopTracer},
 * {@link createOpenTelemetryBridge}, or app-owned adapters.
 */
export type PaymentTracer = {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): PaymentSpan;
};

/** No-op tracer (default when spans are disabled). */
export function createNoopTracer(): PaymentTracer {
  return {
    startSpan(
      _name: string,
      _attributes?: Record<string, string | number | boolean>,
    ): PaymentSpan {
      return {
        end(_status?: PaymentSpanStatus): void {
          /* no-op */
        },
        setAttribute(
          _key: string,
          _value: string | number | boolean,
        ): void {
          /* no-op */
        },
        recordException(_error: unknown): void {
          /* no-op */
        },
      };
    },
  };
}

/**
 * Map an OperationContext.operationType to a span name.
 *
 * Today operation types already use the roadmap span name strings
 * (`payment.create`, …). Custom types pass through unchanged so callers can
 * emit app-specific spans without a hard registry.
 */
export function spanNameForOperationType(operationType: string): string {
  return operationType;
}
