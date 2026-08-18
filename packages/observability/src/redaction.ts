/**
 * Telemetry redaction helpers built on core `redact`.
 *
 * **OBS-1 honesty:** this module is **package-owned**, not a pure re-export of
 * core’s `createRedactingTelemetrySink`. It wraps core `redact()` and adds
 * attribute-bag scrubbing for spans/metrics.
 *
 * **OBS-2 honesty:** `authorized` restore is **defense-in-depth**. Core already
 * allow-lists `authorized` in `SAFE_KEY_ALLOWLIST` (substring `auth` does not
 * redact it). The restore only fires if a future core change over-matches the
 * *key* — never when the *value* is secret-shaped (core `redact` already
 * replaced it with `[REDACTED]`). Only operational booleans are restored.
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
 * Residual secret-shaped leaves that core `redact()` may not match
 * (OBS-2 / NEW-OBS-3): Stripe Checkout `cs_live_` / `cs_test_`, Paymob-style
 * `csk_`, PaymentIntent / SetupIntent `pi|seti_…_secret_…` client secrets,
 * and PayPal `A21AA…` / long `A21…` access tokens. Applied even on
 * allow-listed span keys (`internalReference`, `providerObjectId`).
 */
const STRIPE_TYPED_CLIENT_SECRET =
  String.raw`(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+`;
const PAYPAL_ACCESS_TOKEN =
  String.raw`(?:A21AA[A-Za-z0-9_-]{16,}|A21[A-Za-z0-9._-]{40,})`;

const CLIENT_SECRET_VALUE =
  /^(?:cs_(?:live|test)_|csk_(?:live|test)_)/i;
const PI_CLIENT_SECRET_VALUE = new RegExp(
  `^${STRIPE_TYPED_CLIENT_SECRET}$`,
  "i",
);
const PAYPAL_ACCESS_TOKEN_VALUE = new RegExp(
  `^${PAYPAL_ACCESS_TOKEN}$`,
  "i",
);

/** Embedded credentials in free-form span status messages (OBS-1 / NEW-OBS-3). */
const EMBEDDED_SECRET_IN_MESSAGE = new RegExp(
  String.raw`(?:sk|rk|pk|cs|csk)_(?:live|test)_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9]+|Bearer\s+\S+|${STRIPE_TYPED_CLIENT_SECRET}|${PAYPAL_ACCESS_TOKEN}`,
  "gi",
);

/** Entire message is a credential — drop it. Do not use core `redact()` for this:
 * that helper treats any string *containing* a secret substring as fully redacted. */
const WHOLE_STRING_SECRET = new RegExp(
  String.raw`^(?:(?:sk|rk|pk|cs|csk)_(?:live|test)_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9]+|Bearer\s+\S+|${STRIPE_TYPED_CLIENT_SECRET}|${PAYPAL_ACCESS_TOKEN})$`,
  "i",
);

/** Digit run that may be an embedded PAN (13–19 digits, optional spaces/dashes). */
const EMBEDDED_PAN_IN_MESSAGE = /\d[\d\s-]{11,21}\d/g;

function isPanDigitRun(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);
}

function redactEmbeddedPans(message: string): string {
  return message.replace(EMBEDDED_PAN_IN_MESSAGE, (run) =>
    isPanDigitRun(run) ? REDACTED : run,
  );
}

/**
 * Operational `authorized` restore is only for booleans (`true`/`false`).
 * Never unmask a leaf core already replaced because the *value* was
 * secret-shaped (sk_live / PAN / Bearer).
 */
function isRestorableOperationalPrimitive(value: unknown): boolean {
  return typeof value === "boolean";
}

/**
 * After core `redact`, restore known operational keys **if** they were redacted
 * *and* the original leaf is a non-secret operational primitive (boolean).
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
      isRestorableOperationalPrimitive(origVal)
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

function isClientSecretShapedValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return (
    CLIENT_SECRET_VALUE.test(trimmed) ||
    PI_CLIENT_SECRET_VALUE.test(trimmed) ||
    PAYPAL_ACCESS_TOKEN_VALUE.test(trimmed)
  );
}

function redactResidualSecretLeaves(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") {
    return isClientSecretShapedValue(value) ? REDACTED : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactResidualSecretLeaves(item, depth + 1));
  }
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, leaf] of Object.entries(out)) {
    out[key] = redactResidualSecretLeaves(leaf, depth + 1);
  }
  return out;
}

/**
 * Scrub a structured telemetry bag with core `redact()`, then defense-in-depth
 * restore for operational boolean keys (e.g. `authorized: false`) if ever
 * over-redacted. Secret-shaped `authorized` leaves stay `[REDACTED]`.
 * Residual `cs_live_` / `seti_…_secret_…` / PayPal `A21AA…` values are scrubbed
 * even on allow-listed keys (OBS-2 / NEW-OBS-3). Prefer
 * {@link createRedactingTelemetrySink} for end-to-end wrap.
 */
export function redactTelemetryData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const restored = restoreOperationalKeysIfRedacted(
    data,
    redact(data),
  );
  return redactResidualSecretLeaves(restored) as Record<string, unknown>;
}

/**
 * Sanitize a span `end()` status message before it reaches OTEL `setStatus`
 * (OBS-1 / NEW-OBS-1). Whole-string secrets and opaque PANs are dropped;
 * embedded `sk_live_` / `cs_live_` / Bearer / PI/SetupIntent client-secret /
 * PayPal `A21AA…` / 13–19 digit PAN fragments are replaced with `[REDACTED]`.
 */
export function sanitizeSpanStatusMessage(
  message: string | undefined,
): string | undefined {
  if (message === undefined) return undefined;
  const trimmed = message.trim();
  if (trimmed.length === 0) return undefined;
  if (
    WHOLE_STRING_SECRET.test(trimmed) ||
    isClientSecretShapedValue(trimmed) ||
    isPanDigitRun(trimmed)
  ) {
    return undefined;
  }
  const scrubbed = redactEmbeddedPans(
    trimmed.replace(EMBEDDED_SECRET_IN_MESSAGE, REDACTED),
  );
  if (scrubbed === REDACTED) return undefined;
  return scrubbed;
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
 * Keep operational exception `code` strings; drop secret-shaped values
 * (sk_live / PAN / Bearer) via core `redact`. Exception *name* is not filtered.
 */
export function sanitizeExceptionCode(code: unknown): string | undefined {
  if (typeof code !== "string" || code.length === 0) return undefined;
  return redact(code) === REDACTED ? undefined : code;
}

/** Name + optional non-secret code for span / OTEL exception export. */
export function sanitizeExceptionIdentity(error: unknown): {
  name: string;
  code?: string;
} {
  if (error instanceof Error) {
    const code = sanitizeExceptionCode(
      "code" in error ? (error as { code?: unknown }).code : undefined,
    );
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
    const code = sanitizeExceptionCode(
      "code" in error ? (error as { code?: unknown }).code : undefined,
    );
    return code !== undefined ? { name, code } : { name };
  }
  return { name: "unknown" };
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
