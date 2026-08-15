/**
 * Optional OpenTelemetry bridge — duck-typed injected API only.
 *
 * Root package import must work without `@opentelemetry/api` installed.
 * Never static-import OTEL here; callers pass the API object into the factory.
 *
 * @packageDocumentation
 */

import { redactAttributeBag, sanitizeExceptionIdentity } from "./redaction";
import type { PaymentSpan, PaymentSpanStatus, PaymentTracer } from "./spans";

/**
 * Minimal duck-typed OpenTelemetry API surface accepted by
 * {@link createOpenTelemetryBridge}. Matches `@opentelemetry/api` shape enough
 * for startSpan / attributes / status / exception — no hard dependency.
 */
export type OpenTelemetryApiLike = {
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
  /** Optional: map string status to OTEL numeric codes when present. */
  SpanStatusCode?: {
    OK: number;
    ERROR: number;
  };
};

export type OpenTelemetrySpanLike = {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus?(status: { code: number; message?: string }): void;
  recordException?(exception: unknown): void;
};

export type CreateOpenTelemetryBridgeOptions = {
  /** Tracer name registered with the OTEL provider. Default: paykernel. */
  tracerName?: string;
  /** Optional tracer version string. */
  tracerVersion?: string;
};

/** OTEL numeric status codes (UNSET=0, OK=1, ERROR=2) used when SpanStatusCode is absent. */
const OTEL_STATUS_OK = 1;
const OTEL_STATUS_ERROR = 2;

/**
 * Sanitize exceptions before OTEL `recordException`.
 * Name (+ optional non-secret code) only — never raw message/stack.
 * Secret-shaped `code` values (sk_live / PAN / Bearer) are dropped.
 */
function sanitizeOtelException(error: unknown): {
  name: string;
  code?: string;
} {
  return sanitizeExceptionIdentity(error);
}

function applyOtelSpanStatus(
  otelSpan: OpenTelemetrySpanLike,
  status: PaymentSpanStatus | undefined,
  statusCodes: OpenTelemetryApiLike["SpanStatusCode"] | undefined,
): void {
  if (status === undefined || otelSpan.setStatus === undefined) {
    return;
  }
  const code =
    statusCodes !== undefined
      ? status.code === "error"
        ? statusCodes.ERROR
        : statusCodes.OK
      : status.code === "error"
        ? OTEL_STATUS_ERROR
        : OTEL_STATUS_OK;
  if (status.message !== undefined) {
    otelSpan.setStatus({ code, message: status.message });
  } else {
    otelSpan.setStatus({ code });
  }
}

/**
 * Build a {@link PaymentTracer} from an injected OpenTelemetry API object.
 *
 * ```ts
 * import { trace, SpanStatusCode } from '@opentelemetry/api';
 * import { createOpenTelemetryBridge } from '@paykernel/opentelemetry/otel';
 *
 * const tracer = createOpenTelemetryBridge({ trace, SpanStatusCode });
 * ```
 *
 * Span attributes are auto-redacted (OBS-2) via {@link redactAttributeBag}
 * so secrets/card/token keys never reach exporters. Prefer allow-listed
 * diagnostics; use redacting sinks for rich structured telemetry bags.
 */
export function createOpenTelemetryBridge(
  otelApi: OpenTelemetryApiLike,
  options: CreateOpenTelemetryBridgeOptions = {},
): PaymentTracer {
  const tracerName = options.tracerName ?? "paykernel";
  const otelTracer =
    options.tracerVersion !== undefined
      ? otelApi.trace.getTracer(tracerName, options.tracerVersion)
      : otelApi.trace.getTracer(tracerName);

  const statusCodes = otelApi.SpanStatusCode;

  return {
    startSpan(
      name: string,
      attributes?: Record<string, string | number | boolean>,
    ): PaymentSpan {
      const safeAttrs = redactAttributeBag(attributes);
      const spanOptions =
        safeAttrs !== undefined ? { attributes: safeAttrs } : {};
      const otelSpan = otelTracer.startSpan(name, spanOptions);

      return {
        end(status?: PaymentSpanStatus): void {
          applyOtelSpanStatus(otelSpan, status, statusCodes);
          otelSpan.end();
        },
        setAttribute(key: string, value: string | number | boolean): void {
          // OBS-2: scrub single-key attributes the same way as startSpan bags.
          const scrubbed = redactAttributeBag({ [key]: value });
          if (scrubbed === undefined) return;
          const next = scrubbed[key];
          if (next === undefined) return;
          otelSpan.setAttribute(key, next);
        },
        recordException(error: unknown): void {
          if (otelSpan.recordException !== undefined) {
            // Never forward raw Error (message/stack may hold secrets).
            otelSpan.recordException(sanitizeOtelException(error));
          }
        },
      };
    },
  };
}
