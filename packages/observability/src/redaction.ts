/**
 * Telemetry redaction helpers built on core `redact`.
 *
 * **OBS-1 honesty:** this module is **package-owned**, not a pure re-export of
 * core’s `createRedactingTelemetrySink`. It wraps core `redact()` and adds
 * attribute-bag scrubbing for spans/metrics.
 *
 * **OBS-2 honesty:** `authorized` restore is **defense-in-depth**. Core already
 * allow-lists `authorized` in `SAFE_KEY_ALLOWLIST` (substring `auth` does not
 * redact it). The restore only fires if a future core change over-matches.
 */

import {
  redact,
  type TelemetrySink,
} from "@paykernel/core";

export type { TelemetrySink };

/**
 * Operational keys restored only if core ever marks them `[REDACTED]`.
 * Core already allow-lists `authorized` — this set is belt-and-suspenders (OBS-2).
 */
const OPERATIONAL_KEY_RESTORE = new Set(["authorized"]);

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/**
 * After core `redact`, restore known operational keys **if** they were redacted.
 * No-op when core already preserved them (current SAFE_KEY_ALLOWLIST behavior).
 * Recurses into plain objects only (same depth budget as core).
 */
function restoreOperationalKeysIfRedacted(
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
      out[key] = restoreOperationalKeysIfRedacted(origVal, red[key], depth + 1);
    }
  }
  return out;
}

/**
 * Scrub a structured telemetry bag with core `redact()`, then defense-in-depth
 * restore for operational keys (e.g. `authorized`) if ever over-redacted.
 * Prefer {@link createRedactingTelemetrySink} when wrapping a sink end-to-end.
 */
export function redactTelemetryData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return restoreOperationalKeysIfRedacted(
    data,
    redact(data),
  ) as Record<string, unknown>;
}

/**
 * Redact span/metric attribute bags (string | number | boolean values only).
 * Sensitive keys become `"[REDACTED]"`; operational `authorized` is preserved
 * (core allow-list + optional restore). Returns a new object; undefined input stays undefined.
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
 * Package-owned telemetry sink wrapper (OBS-1: **not** a pure core re-export).
 * Scrubs every structured bag via {@link redactTelemetryData} before emit.
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
