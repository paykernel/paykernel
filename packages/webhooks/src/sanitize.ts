/**
 * Sanitize errors for inbox `lastError` and logs.
 * Never include raw payloads, signatures, or secret-like substrings.
 */

/** Default max length for sanitized error messages. */
export const DEFAULT_SANITIZE_MAX_LENGTH = 512;

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
  // JSON-ish secret values after common keys
  /"(?:secret_token|client_secret|api_key|apiKey|password|authorization|signature)"\s*:\s*"[^"]*"/gi,
];

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

  let out = message;
  for (const re of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls.
    re.lastIndex = 0;
    out = out.replace(re, "[REDACTED]");
  }

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
