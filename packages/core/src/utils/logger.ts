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
  // Banking / government identifiers (MONEY-6)
  "iban",
  "bank",
  "ssn",
  "pin",
];

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
]);

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SAFE_KEY_ALLOWLIST.has(lower)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively redact sensitive fields from a structured log context. Returns a
 * deep-cloned copy; the input is never mutated.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
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
