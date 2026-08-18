/**
 * Sanitize errors for inbox `lastError` and logs.
 * Never include raw payloads, signatures, or secret-like substrings.
 */

/** Default max length for sanitized error messages. */
export const DEFAULT_SANITIZE_MAX_LENGTH = 512;

/**
 * Residual secret-shaped leaves (I11 / same set as observability redaction.ts):
 * Stripe Checkout `cs_live_` / `cs_test_`, Paymob-style `csk_`, PI/SetupIntent
 * `pi|seti_…_secret_…`, PayPal `A21AA…` / long `A21…` access tokens.
 */
const STRIPE_TYPED_CLIENT_SECRET =
  String.raw`(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+`;
const PAYPAL_ACCESS_TOKEN =
  String.raw`(?:A21AA[A-Za-z0-9_-]{16,}|A21[A-Za-z0-9._-]{40,})`;

/** Digit run that may be an embedded PAN (13–19 digits, optional spaces/dashes). */
const EMBEDDED_PAN_IN_MESSAGE = /\d[\d\s-]{11,21}\d/g;

function isPanDigitRun(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);
}

function redactEmbeddedPans(message: string): string {
  return message.replace(EMBEDDED_PAN_IN_MESSAGE, (run) =>
    isPanDigitRun(run) ? "[REDACTED]" : run,
  );
}

/** Patterns that look like secrets / credentials (replaced with [REDACTED]). */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk_live_[A-Za-z0-9]+/gi,
  /\bsk_test_[A-Za-z0-9]+/gi,
  /\bwhsec_[A-Za-z0-9]+/gi,
  /\bBearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /\bBasic\s+[A-Za-z0-9._\-+/=]+/gi,
  /\bsecret_token\s*[:=]\s*\S+/gi,
  /\bclient_secret\s*[:=]\s*\S+/gi,
  /\bapi[_-]?key\s*[:=]\s*\S+/gi,
  /\bpassword\s*[:=]\s*\S+/gi,
  /\bauthorization\s*[:=]\s*\S+/gi,
  /\bsignature\s*[:=]\s*\S+/gi,
  /\bx-signature\s*[:=]\s*\S+/gi,
  /\bstripe-signature\s*[:=]\s*\S+/gi,
  /\bpk_live_[A-Za-z0-9]+/gi,
  /\bpk_test_[A-Za-z0-9]+/gi,
  /\brk_live_[A-Za-z0-9]+/gi,
  /\brk_test_[A-Za-z0-9]+/gi,
  /\bcs_(?:live|test)_[A-Za-z0-9_-]+/gi,
  /\bcsk_(?:live|test)_[A-Za-z0-9_-]+/gi,
  new RegExp(STRIPE_TYPED_CLIENT_SECRET, "gi"),
  new RegExp(PAYPAL_ACCESS_TOKEN, "gi"),
  // JSON-ish secret values after common keys
  /"(?:secret_token|client_secret|api_key|apiKey|password|authorization|signature)"\s*:\s*"[^"]*"/gi,
];

function applySecretPatterns(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[REDACTED]");
  }
  return redactEmbeddedPans(out);
}

/** Known secret object keys redacted when stringifying plain objects. */
const SECRET_OBJECT_KEYS = new Set([
  "secret_token",
  "client_secret",
  "api_key",
  "apiKey",
  "password",
  "authorization",
  "signature",
  "x-signature",
  "stripe-signature",
  "webhook_secret",
  "webhookSecret",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
]);

export type SanitizeWebhookErrorOptions = {
  /** Max message length (default 512). */
  maxLength?: number;
};

function redactObjectForSanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactObjectForSanitize(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_OBJECT_KEYS.has(k) || /secret|password|token|signature/i.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactObjectForSanitize(v, depth + 1);
    }
  }
  return out;
}

/**
 * Redact known secret/signature patterns from an opaque string (WEBHOOKS-6).
 * Used when persisting non-JSON `payloadRef` / envelope strings so raw tokens
 * do not land unredacted. Non-secret opaque refs pass through unchanged.
 */
export function redactOpaquePayloadRefString(value: string): string {
  return applySecretPatterns(value);
}

/**
 * Produce a safe string for `lastError` / logs from an unknown throw.
 *
 * - Extracts Error.message when available
 * - Redacts known secret keys on plain objects before stringify
 * - Strips common secret/signature patterns
 * - Truncates to maxLength
 */
export function sanitizeWebhookError(
  error: unknown,
  options: SanitizeWebhookErrorOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_SANITIZE_MAX_LENGTH;
  let message: string;
  if (error instanceof Error) {
    message = error.message || error.name || "Error";
  } else if (typeof error === "string") {
    message = error;
  } else if (error === null || error === undefined) {
    message = "Unknown error";
  } else {
    try {
      message = JSON.stringify(redactObjectForSanitize(error));
    } catch {
      message = String(error);
    }
  }

  let out = applySecretPatterns(message);

  // Collapse runs of whitespace
  out = out.replace(/\s+/g, " ").trim();

  if (out.length > maxLength) {
    out = out.slice(0, maxLength - 1) + "…";
  }

  if (!out) {
    out = "Error";
  }

  return out;
}
