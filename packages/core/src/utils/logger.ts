// file: packages/payments/src/utils/logger.ts

/**
 * Pluggable, redacting logger for the SDK.
 *
 * Gateways must never write to `console` directly: card data, tokens, auth
 * headers, and customer PII can leak into logs. Instead they log through an
 * injectable {@link Logger}. The default is a no-op so the SDK is silent unless
 * the integrator opts in, and {@link redact} scrubs known-sensitive fields from
 * any structured context before it is handed to the sink.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/** A logger that discards everything. Default when no logger is configured. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Keys that must never appear in logs in cleartext. Matched case-insensitively
 * as a substring, so e.g. `customerEmail`, `card_number`, and
 * `Authorization` are all caught.
 */
const SENSITIVE_KEY_PATTERNS = [
  "secret",
  "password",
  "passwd",
  "pwd",
  "token",
  "authorization",
  "auth",
  "apikey",
  "api_key",
  "key",
  "card",
  "cvc",
  "cvv",
  "pan",
  "number",
  "email",
  "phone",
  "name",
  "address",
  "hmac",
  "signature",
  "client_secret",
  "clientsecret",
  "given_id",
  // Session / auth material not covered by password/token alone
  "cookie",
  // Substring match: "credential" also covers "credentials" / userCredential.
  "credential",
  "otp",
  // Banking / government identifiers
  "iban",
  "bank",
  "ssn",
  "pin",
  // Card expiry + tax/DOB-style PII (avoid bare "exp"/"tax" — too broad)
  "expiry",
  "expiration",
  "exp_month",
  "exp_year",
  "expmonth",
  "expyear",
  "dob",
  "date_of_birth",
  "dateofbirth",
  "tax_id",
  "taxid",
  "national_id",
  "nationalid",
  // Wallet / network token material (MONEY-2)
  "mobile",
  "cryptogram",
  "security_code",
  "securitycode",
  // Extra CVC aliases (MONEY-4)
  "cvc2",
  "cvv2",
  "cid",
];

/**
 * Exact key names that must redact even when too short/ambiguous for substring
 * patterns (MONEY-4 — Moyasar source uses bare `month` / `year` for card expiry).
 * Matched case-insensitively as whole key only (not substring).
 */
const SENSITIVE_EXACT_KEYS = new Set(["month", "year"]);

/**
 * Opaque string values that look like PANs (13–19 digits, optional spaces/dashes).
 * Matched only on string leaves so free-form blobs do not leak card numbers under
 * non-sensitive keys.
 */
const PAN_LIKE_STRING = /^[\d\s-]{13,23}$/;

/**
 * Secret-shaped leaves under non-sensitive keys (MONEY-3): API keys, webhook
 * secrets, bearer tokens. Matched on string leaves only so free-form notes
 * cannot leak live credentials when logged under keys like `note` / `detail`.
 */
const SECRET_SHAPED_STRING =
  /^(?:sk_(?:live|test)_|rk_(?:live|test)_|pk_(?:live|test)_|whsec_|Bearer\s+\S)/i;

function isOpaqueSensitiveString(value: string): boolean {
  const trimmed = value.trim();
  if (SECRET_SHAPED_STRING.test(trimmed)) {
    return true;
  }
  if (trimmed.length < 13 || trimmed.length > 23) {
    return false;
  }
  if (!PAN_LIKE_STRING.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replace(/[\s-]/g, "");
  return digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);
}

/**
 * Operational identifiers that are never sensitive but would otherwise be
 * caught by the broad substring patterns above (e.g. `gatewayName` matches
 * "name"). Allow-listing them keeps diagnostic logs useful without weakening
 * redaction of genuinely sensitive fields like `firstName`/`cardNumber`.
 */
const SAFE_KEY_ALLOWLIST = new Set([
  "gateway",
  "gatewayname",
  "operation",
  "operationname",
  "event",
  "eventname",
  "eventtype",
  "status",
  // Operational payment identifiers (would otherwise match "key"/"authorization"/etc.)
  "idempotencykey",
  "authorizationid",
  "gatewaypaymentid",
  "gatewayid",
  "captureid",
  "orderid",
  "paymentid",
  "refundid",
  "voidid",
  "customerid",
  "merchantid",
  "sessionid",
  "requestid",
  "correlationid",
  "traceid",
  "spanid",
  // Phase 20 OperationContext / telemetry diagnostics
  // (attemptNumber→"number", namespace→"name", *Key→"key"; others defensive)
  "operationid",
  "operationtype",
  "providerrequestid",
  "providerobjectid",
  "internalreference",
  "attemptnumber",
  "durationms",
  "duration",
  "tenant",
  "namespace",
  "inboxeventkey",
  "eventkey",
  "normalizedoutcome",
  "outcome",
  "reconciliationrequired",
  "retry",
  "retryable",
  // Exception class name only (never message) — "name" substring would otherwise redact
  "errorname",
  "exceptionname",
  "exceptiontype",
  // Currency / amount field names are not PII (values may still nest sensitive objects)
  "currency",
  "amount",
  "currencycode",
  // Operational payment-domain flags (substring "auth" would otherwise redact)
  "authorized",
]);

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SAFE_KEY_ALLOWLIST.has(lower)) {
    return false;
  }
  if (SENSITIVE_EXACT_KEYS.has(lower)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively redact sensitive fields from a structured log context. Returns a
 * deep-cloned copy; the input is never mutated.
 *
 * Redacts:
 * - Keys matching {@link SENSITIVE_KEY_PATTERNS} (case-insensitive substring)
 * - Opaque string leaves that look like PANs (13–19 digits)
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && isOpaqueSensitiveString(value)) {
      return REDACTED;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // Skip prototype-polluting keys (MONEY-3 class) — never copy onto output.
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    result[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1);
  }
  return result;
}

/**
 * Wrap a logger so every structured context is redacted before reaching the
 * sink. Gateways are given a redacting logger so individual call sites don't
 * have to remember to scrub fields.
 */
export function createRedactingLogger(logger: Logger): Logger {
  const wrap = (level: LogLevel) =>
    (message: string, context?: Record<string, unknown>): void => {
      if (context === undefined) {
        logger[level](message);
      } else {
        logger[level](message, redact(context) as Record<string, unknown>);
      }
    };

  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}
