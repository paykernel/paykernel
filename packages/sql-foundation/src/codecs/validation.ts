/**
 * Shared record validation for SQL-backed store rows.
 *
 * Callers must sanitize errors before storage; this module still enforces
 * max size and structural checks. Never store secrets in error fields.
 */

import {
  IDEMPOTENCY_STATUSES,
  RECONCILIATION_STATUSES,
  WEBHOOK_INBOX_STATUSES,
  type IdempotencyStatusSql,
  type ReconciliationStatusSql,
  type WebhookInboxStatusSql,
} from "../schema/tables";

/**
 * Max length for sanitized error / diagnostic text columns.
 * Aligns with webhooks `DEFAULT_SANITIZE_MAX_LENGTH` (512).
 */
export const MAX_SANITIZED_ERROR_LENGTH = 512;

/** Basic ISO-8601 / RFC3339-ish timestamp check (portable TEXT storage). */
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class RecordValidationError extends Error {
  readonly code = "record_validation" as const;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "RecordValidationError";
    if (field !== undefined) {
      this.field = field;
    }
  }
}

export type TruncateSanitizedErrorOptions = {
  maxLength?: number;
  /** Suffix when truncated (default single ellipsis character). */
  ellipsis?: string;
};

/**
 * Enforce max size on sanitized error text. Truncates with ellipsis when longer.
 * Does not attempt secret redaction — callers sanitize first.
 */
export function enforceMaxSanitizedError(
  value: string | null | undefined,
  options: TruncateSanitizedErrorOptions = {},
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RecordValidationError("error field must be a string", "error");
  }
  const maxLength = options.maxLength ?? MAX_SANITIZED_ERROR_LENGTH;
  const ellipsis = options.ellipsis ?? "…";
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  if (maxLength <= ellipsis.length) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/** Assert string is non-empty (lease tokens, keys, hashes). */
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RecordValidationError(`${field} must be a non-empty string`, field);
  }
  return value;
}

/**
 * Validate lease token for mutators (complete/fail/renew).
 * Empty/missing tokens are rejected.
 */
export function validateLeaseToken(token: unknown, field = "leaseToken"): string {
  return requireNonEmptyString(token, field);
}

export function isIdempotencyStatus(value: unknown): value is IdempotencyStatusSql {
  return typeof value === "string" && (IDEMPOTENCY_STATUSES as readonly string[]).includes(value);
}

export function isWebhookInboxStatus(value: unknown): value is WebhookInboxStatusSql {
  return typeof value === "string" && (WEBHOOK_INBOX_STATUSES as readonly string[]).includes(value);
}

export function isReconciliationStatus(value: unknown): value is ReconciliationStatusSql {
  return (
    typeof value === "string" && (RECONCILIATION_STATUSES as readonly string[]).includes(value)
  );
}

export function validateIdempotencyStatus(value: unknown): IdempotencyStatusSql {
  if (!isIdempotencyStatus(value)) {
    throw new RecordValidationError(`invalid idempotency status: ${String(value)}`, "status");
  }
  return value;
}

export function validateWebhookInboxStatus(value: unknown): WebhookInboxStatusSql {
  if (!isWebhookInboxStatus(value)) {
    throw new RecordValidationError(`invalid webhook inbox status: ${String(value)}`, "status");
  }
  return value;
}

export function validateReconciliationStatus(value: unknown): ReconciliationStatusSql {
  if (!isReconciliationStatus(value)) {
    throw new RecordValidationError(`invalid reconciliation status: ${String(value)}`, "status");
  }
  return value;
}

/**
 * Basic ISO-8601 check for portable TEXT timestamps.
 * Does not require full calendar validity beyond Date.parse when present.
 * Accepts Z and numeric offsets; prefer {@link canonicalizeIsoTimestamp} at
 * SQL write boundaries so TEXT lexical compares match Date.parse/Redis.
 */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20) return false;
  if (!ISO_TIMESTAMP_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function validateIsoTimestamp(value: unknown, field: string): string {
  if (!isIsoTimestamp(value)) {
    throw new RecordValidationError(`${field} must be an ISO-8601 timestamp string`, field);
  }
  return value;
}

/** Optional ISO timestamp: undefined/null allowed. */
export function validateOptionalIsoTimestamp(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return validateIsoTimestamp(value, field);
}

/**
 * Canonical portable TEXT form: `YYYY-MM-DDTHH:mm:ss.sssZ` (Date#toISOString).
 *
 * SQL adapters store due_at / lease_expires_at / available_at as TEXT and
 * compare them lexically in claim WHERE clauses. Offset forms
 * (`…+05:00`) and non-millisecond Z forms sort incorrectly vs `now`
 * from `toISOString()`. Always write and claim-bind through this helper.
 */
export function canonicalizeIsoTimestamp(value: unknown, field = "timestamp"): string {
  const raw = validateIsoTimestamp(value, field);
  return new Date(Date.parse(raw)).toISOString();
}

/** Optional canonicalize: undefined/null/"" → undefined. */
export function canonicalizeOptionalIsoTimestamp(
  value: unknown,
  field = "timestamp",
): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return canonicalizeIsoTimestamp(value, field);
}

/**
 * True when value is already the canonical Z millisecond form produced by
 * `Date#toISOString` (fast path for skip-repair in claim miss handlers).
 */
export function isCanonicalIsoZ(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Date#toISOString always emits exactly 3 fractional digits + Z.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Payload hash: non-empty string (hex/base64 digest). TEXT storage policy.
 */
export function validatePayloadHash(value: unknown, field = "payloadHash"): string {
  return requireNonEmptyString(value, field);
}

/**
 * generation / attempts: non-negative safe integers (portable; string codecs
 * may accept string digits from drivers but normalized form is number in-range).
 */
export function validateNonNegativeInt(value: unknown, field: string): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    n = Number(value);
  } else if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
      throw new RecordValidationError(`${field} out of safe integer range`, field);
    }
    n = Number(value);
  } else {
    throw new RecordValidationError(`${field} must be a non-negative integer`, field);
  }
  if (!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new RecordValidationError(`${field} must be a non-negative safe integer`, field);
  }
  return n;
}
