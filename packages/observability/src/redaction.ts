/**
 * Telemetry redaction helpers — reuse core `redact` / createRedactingTelemetrySink.
 * Observability must not reimplement redaction policy.
 */

import {
  createRedactingTelemetrySink,
  redact,
  type TelemetrySink,
} from "@paykernel/core";

export { createRedactingTelemetrySink };
export type { TelemetrySink };

/**
 * Scrub a structured telemetry bag with the same model as logs.
 * Prefer {@link createRedactingTelemetrySink} when wrapping a sink end-to-end.
 */
export function redactTelemetryData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return redact(data) as Record<string, unknown>;
}
