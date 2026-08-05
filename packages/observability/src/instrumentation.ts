/**
 * Compose OperationContext + metrics + spans + redacting telemetry for one op.
 */

import {
  createRedactingTelemetrySink,
  finalizeOperationContext,
  operationContextToTelemetryData,
  systemClock,
  type Clock,
  type OperationContext,
  type TelemetrySink,
} from "@paykernel/core";
import type { PaymentMetrics } from "./metrics";
import type { PaymentTracer } from "./spans";
import { spanNameForOperationType } from "./spans";

/** Options for {@link withPaymentOperation} / {@link recordPaymentOperation}. */
export type PaymentOperationInstrumentation = {
  /** Started operation context (required). */
  context: OperationContext;
  metrics?: PaymentMetrics;
  tracer?: PaymentTracer;
  /**
   * Optional raw telemetry sink. Emissions are always scrubbed via
   * {@link createRedactingTelemetrySink} before reaching the sink.
   */
  telemetry?: TelemetrySink;
  /** Injectable clock (portable; defaults to systemClock / Date.now). */
  clock?: Clock;
  /** Telemetry event name. Default: payment.operation */
  telemetryEvent?: string;
  /**
   * When true (default), reconciliationRequired on finalize increments
   * reconciliationDrift once.
   */
  countReconciliationDrift?: boolean;
};

export type PaymentOperationResult<T> = {
  result: T;
  /** Finalized context (includes durationMs and any patch from the callback). */
  context: OperationContext;
  durationMs: number;
};

export type PaymentOperationFnResult<T> =
  | T
  | {
      result: T;
      /** Optional finalize patch (outcome, provider ids, flags, …). */
      contextPatch?: Parameters<typeof finalizeOperationContext>[1];
    };

/**
 * Treat as instrumented wrapper only when the object keys are exactly
 * `result` and/or `contextPatch` — avoids mistaking domain objects that
 * happen to have a `result` field.
 */
function isWrappedResult<T>(
  value: PaymentOperationFnResult<T>,
): value is {
  result: T;
  contextPatch?: Parameters<typeof finalizeOperationContext>[1];
} {
  if (value === null || typeof value !== "object") return false;
  const keys = Object.keys(value as object);
  if (keys.length === 0 || keys.length > 2) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "result")) return false;
  return keys.every((k) => k === "result" || k === "contextPatch");
}

function isIndeterminateOutcome(outcome: string | undefined): boolean {
  if (outcome === undefined) return false;
  const lower = outcome.toLowerCase();
  return lower === "indeterminate" || lower.startsWith("indeterminate.");
}

/**
 * Classify known definitive `@paykernel/core` payment errors thrown from the
 * instrumented callback (OBS-2). Transport-ambiguous errors (NetworkError,
 * generic Error, etc.) return undefined so the default stays indeterminate.
 *
 * Uses `error.name` (not `instanceof`) so duplicate package copies still match.
 */
function normalizedOutcomeFromThrown(
  error: unknown,
): string | undefined {
  if (!(error instanceof Error) || typeof error.name !== "string") {
    return undefined;
  }
  switch (error.name) {
    case "CardDeclinedError":
    case "InsufficientFundsError":
      return "declined";
    case "InvalidRequestError":
    case "OperationNotSupportedError":
    case "GatewayNotConfiguredError":
    case "ResourceNotFoundError":
    case "AuthenticationError":
    case "InvalidWebhookError":
      return "failed";
    // NetworkError / PaymentAbortedError / RateLimitError / GatewayApiError /
    // unknown → transport or provider-ambiguous; keep indeterminate default.
    default:
      return undefined;
  }
}

/**
 * Non-throw outcomes that should end the span as error (OBS-1).
 * Failed / declined / error / indeterminate money results must not report
 * span status OK — OTEL error rates would undercount payment failures.
 * `requires_action` / `succeeded` / missing outcome stay OK.
 */
function isSpanErrorOutcome(outcome: string | undefined): boolean {
  if (outcome === undefined) return false;
  if (isIndeterminateOutcome(outcome)) return true;
  const lower = outcome.toLowerCase();
  return (
    lower === "failed" ||
    lower === "declined" ||
    lower === "error" ||
    lower.startsWith("failed.") ||
    lower.startsWith("declined.")
  );
}

function spanAttributesFromContext(
  ctx: OperationContext,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    gateway: ctx.gateway,
    operationType: ctx.operationType,
    operationId: ctx.operationId,
  };
  if (ctx.tenant !== undefined) attrs.tenant = ctx.tenant;
  if (ctx.namespace !== undefined) attrs.namespace = ctx.namespace;
  if (ctx.internalReference !== undefined) {
    attrs.internalReference = ctx.internalReference;
  }
  if (ctx.providerObjectId !== undefined) {
    attrs.providerObjectId = ctx.providerObjectId;
  }
  if (ctx.providerRequestId !== undefined) {
    attrs.providerRequestId = ctx.providerRequestId;
  }
  if (ctx.attemptNumber !== undefined) {
    attrs.attemptNumber = ctx.attemptNumber;
  }
  if (ctx.inboxEventKey !== undefined) {
    attrs.inboxEventKey = ctx.inboxEventKey;
  }
  return attrs;
}

/**
 * Record metrics + telemetry for a completed operation (no span lifecycle).
 * Useful when duration/outcome are already known.
 */
export function recordPaymentOperation(
  options: PaymentOperationInstrumentation & {
    durationMs: number;
    normalizedOutcome?: string;
    error?: unknown;
  },
): OperationContext {
  const {
    context,
    metrics,
    telemetry,
    durationMs,
    normalizedOutcome,
    error,
    telemetryEvent = "payment.operation",
    countReconciliationDrift = true,
  } = options;

  const patch: Parameters<typeof finalizeOperationContext>[1] = {
    durationMs,
  };
  if (normalizedOutcome !== undefined) {
    patch.normalizedOutcome = normalizedOutcome;
  }

  const finished = finalizeOperationContext(context, patch);
  applyMetrics(metrics, finished, durationMs, countReconciliationDrift);
  emitRedactedOperationTelemetry(telemetry, telemetryEvent, finished, error);
  return finished;
}

function applyMetrics(
  metrics: PaymentMetrics | undefined,
  finished: OperationContext,
  durationMs: number,
  countReconciliationDrift: boolean,
): void {
  if (metrics === undefined) return;

  const labels = {
    gateway: finished.gateway,
    operationType: finished.operationType,
  };
  const outcome = finished.normalizedOutcome ?? "unknown";

  metrics.operationOutcomes.add(1, { ...labels, outcome });
  metrics.providerLatencyMs.record(durationMs, labels);

  if (isIndeterminateOutcome(finished.normalizedOutcome)) {
    metrics.indeterminateOperations.add(1, labels);
  }
  if (finished.retry === true) {
    metrics.retries.add(1, labels);
  }
  // reconciliationRequired signals need for recon work; optional drift counter
  // for ops dashboards (not "money drifted" alone). Disable via flag if noisy.
  if (countReconciliationDrift && finished.reconciliationRequired === true) {
    metrics.reconciliationDrift.add(1, labels);
  }
}

function errorNameForTelemetry(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (typeof error === "string") return "Error";
  return "unknown";
}

/**
 * Sanitize exceptions for span export: name (+ optional code) only.
 * Never forward raw Error.message / stack (may carry tokens or card fragments).
 */
export function sanitizeExceptionForSpan(error: unknown): {
  name: string;
  code?: string;
} {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return code !== undefined
      ? { name: error.name || "Error", code }
      : { name: error.name || "Error" };
  }
  if (typeof error === "string") {
    return { name: "Error" };
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
  ) {
    const name = (error as { name: string }).name || "Error";
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return code !== undefined ? { name, code } : { name };
  }
  return { name: "unknown" };
}

function emitRedactedOperationTelemetry(
  telemetry: TelemetrySink | undefined,
  event: string,
  finished: OperationContext,
  error: unknown | undefined,
): void {
  if (telemetry === undefined) return;
  const sink = createRedactingTelemetrySink(telemetry);
  const data = operationContextToTelemetryData(finished);
  if (error !== undefined) {
    // Name only — never attach error.message (may contain secrets).
    data.errorName = errorNameForTelemetry(error);
  }
  sink.emit?.(event, data);
}

function finalizeSpan(
  span: ReturnType<PaymentTracer["startSpan"]> | undefined,
  finished: OperationContext,
  durationMs: number,
  thrown: unknown | undefined,
): void {
  if (span === undefined) return;

  if (finished.providerRequestId !== undefined) {
    span.setAttribute("providerRequestId", finished.providerRequestId);
  }
  if (finished.providerObjectId !== undefined) {
    span.setAttribute("providerObjectId", finished.providerObjectId);
  }
  if (finished.normalizedOutcome !== undefined) {
    span.setAttribute("normalizedOutcome", finished.normalizedOutcome);
  }
  span.setAttribute("durationMs", durationMs);

  if (thrown !== undefined) {
    // Never recordException(raw Error) — message/stack can carry secrets.
    span.recordException?.(sanitizeExceptionForSpan(thrown));
    // Status message uses Error.name only — never message (secrets risk).
    if (thrown instanceof Error && thrown.name.length > 0) {
      span.end({ code: "error", message: thrown.name });
    } else {
      span.end({ code: "error" });
    }
    return;
  }
  // OBS-1: non-throw failed/indeterminate money outcomes end error, not OK.
  // Message is the outcome label only (enum-ish — not secret-bearing text).
  const outcome = finished.normalizedOutcome;
  if (isSpanErrorOutcome(outcome) && outcome !== undefined) {
    span.end({
      code: "error",
      message: outcome,
    });
    return;
  }
  span.end({ code: "ok" });
}

/**
 * Run `fn` under a payment span, record latency + outcome metrics, emit
 * redacted telemetry, and return the finalized {@link OperationContext}.
 *
 * - Indeterminate outcomes are labeled as-is on `operationOutcomes` and also
 *   increment `indeterminateOperations` (never collapsed to a generic failure).
 * - Duration uses injectable {@link Clock}.nowMs() (no node:perf_hooks).
 *
 * Callback may return a plain value or `{ result, contextPatch }` to attach
 * outcome / provider ids on finalize.
 */
export async function withPaymentOperation<T>(
  options: PaymentOperationInstrumentation,
  fn: (ctx: OperationContext) => Promise<PaymentOperationFnResult<T>> | PaymentOperationFnResult<T>,
): Promise<PaymentOperationResult<T>> {
  const {
    context,
    metrics,
    tracer,
    telemetry,
    clock = systemClock,
    telemetryEvent = "payment.operation",
    countReconciliationDrift = true,
  } = options;

  const startMs = clock.nowMs();
  const spanName = spanNameForOperationType(context.operationType);
  const span = tracer?.startSpan(
    spanName,
    spanAttributesFromContext(context),
  );

  let thrown: unknown;
  let raw: PaymentOperationFnResult<T> | undefined;
  try {
    raw = await fn(context);
  } catch (error) {
    thrown = error;
  }

  const endMs = clock.nowMs();
  const durationMs = Math.max(0, endMs - startMs);

  let result: T | undefined;
  let contextPatch: Parameters<typeof finalizeOperationContext>[1] | undefined;

  if (thrown === undefined && raw !== undefined) {
    if (isWrappedResult(raw)) {
      result = raw.result;
      contextPatch = raw.contextPatch;
    } else {
      result = raw as T;
    }
  }

  const patch: Parameters<typeof finalizeOperationContext>[1] = {
    durationMs,
  };
  if (contextPatch !== undefined) {
    for (const [key, value] of Object.entries(contextPatch)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
  }
  // Thrown errors: classify known definitive payment errors (CardDeclinedError →
  // declined, InvalidRequestError → failed, …). Transport-ambiguous throws
  // (NetworkError, generic Error) default to indeterminate — never invent
  // definitive failed. Callers cannot attach contextPatch on a throw path;
  // for custom known-final outcomes return `{ result, contextPatch }` instead.
  if (thrown !== undefined && patch.normalizedOutcome === undefined) {
    patch.normalizedOutcome =
      normalizedOutcomeFromThrown(thrown) ?? "indeterminate";
  }

  const finished = finalizeOperationContext(context, patch);
  finalizeSpan(span, finished, durationMs, thrown);
  applyMetrics(metrics, finished, durationMs, countReconciliationDrift);
  emitRedactedOperationTelemetry(telemetry, telemetryEvent, finished, thrown);

  if (thrown !== undefined) {
    throw thrown;
  }

  return {
    result: result as T,
    context: finished,
    durationMs,
  };
}
