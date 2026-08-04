/**
 * Sanitize errors for reconciliation `lastError` / notes and logs.
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
  /\bsecret_token\s*[:=]\s*\S+/gi,
  /\bauthorization\s*[:=]\s*\S+/gi,
  /\bsignature\s*[:=]\s*\S+/gi,
  /\bx-signature\s*[:=]\s*\S+/gi,
  /\bstripe-signature\s*[:=]\s*\S+/gi,
  /\bpk_live_[A-Za-z0-9]+/gi,
  /\bpk_test_[A-Za-z0-9]+/gi,
  /\brk_live_[A-Za-z0-9]+/gi,
  /\brk_test_[A-Za-z0-9]+/gi,
];

export type SanitizeReconciliationErrorOptions = {
  /** Max message length (default 512). */
  maxLength?: number;
};

/**
 * Produce a safe string for `lastError` / logs from an unknown throw.
 *
 * - Extracts Error.message when available
 * - Strips common secret/signature patterns
 * - Truncates to maxLength
 */
export function sanitizeReconciliationError(
  error: unknown,
  options: SanitizeReconciliationErrorOptions = {},
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
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  let out = message;
  for (const re of SECRET_PATTERNS) {
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
