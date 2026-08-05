/**
 * Telemetry redaction helpers built on core `redact`.
 * Layers operational-key restore for known core over-matches (OBS-1) and
 * attribute scrubbers for spans/metrics (OBS-2). Does not re-export core's
 * sink wrapper — this package owns the OBS restore path.
 */

import {
  redact,
  type TelemetrySink,
} from "@paykernel/core";

export type { TelemetrySink };

/**
 * Exact keys that core substring patterns over-match as sensitive but that are
 * operational payment-domain flags (OBS-1: pattern `auth` → `authorized`).
 * Values are restored after core redact when the original bag still holds them.
 */
const OPERATIONAL_KEY_RESTORE = new Set(["authorized"]);

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/**
 * After core `redact`, restore known operational keys that were over-matched.
 * Recurses into plain objects only (same depth budget as core).
 */
function restoreOperationalOverRedacts(
  original: unknown,
  redacted: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return redacted;
  if (
    original === null ||
    typeof original !== "object" ||
    redacted === null ||
    typeof redacted !== "object"
  ) {
    return redacted;
  }
  if (Array.isArray(original) || Array.isArray(redacted)) {
    return redacted;
  }

  const orig = original as Record<string, unknown>;
  const red = redacted as Record<string, unknown>;
  const out: Record<string, unknown> = { ...red };

  for (const [key, origVal] of Object.entries(orig)) {
    const lower = key.toLowerCase();
    if (
      OPERATIONAL_KEY_RESTORE.has(lower) &&
      red[key] === REDACTED &&
      origVal !== undefined
    ) {
      out[key] = origVal;
      continue;
    }
    if (
      origVal !== null &&
      typeof origVal === "object" &&
      !Array.isArray(origVal) &&
      red[key] !== null &&
      typeof red[key] === "object" &&
      !Array.isArray(red[key])
    ) {
      out[key] = restoreOperationalOverRedacts(origVal, red[key], depth + 1);
    }
  }
  return out;
}

/**
 * Scrub a structured telemetry bag with the same model as logs, then restore
 * operational keys core over-redacts (e.g. `authorized`).
 * Prefer {@link createRedactingTelemetrySink} when wrapping a sink end-to-end.
 */
export function redactTelemetryData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return restoreOperationalOverRedacts(
    data,
    redact(data),
  ) as Record<string, unknown>;
}

/**
 * Redact span/metric attribute bags (string | number | boolean values only).
 * Sensitive keys become `"[REDACTED]"`; operational `authorized` is preserved (OBS-1/2).
 * Returns a new object; undefined input stays undefined.
 */
export function redactAttributeBag(
  attributes?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> | undefined {
  if (attributes === undefined) return undefined;
  const scrubbed = redactTelemetryData(
    attributes as Record<string, unknown>,
  );
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(scrubbed)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Wrap a telemetry sink so every structured bag is redacted (with OBS-1 restore)
 * before reaching the underlying sink.
 */
export function createRedactingTelemetrySink(sink: TelemetrySink): TelemetrySink {
  return {
    emit(event: string, data?: Record<string, unknown>): void {
      if (sink.emit === undefined) return;
      if (data === undefined) {
        sink.emit(event);
        return;
      }
      sink.emit(event, redactTelemetryData(data));
    },
  };
}
