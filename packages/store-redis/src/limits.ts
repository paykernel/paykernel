/**
 * Size caps for Redis-stored fields (secrets / payload hygiene).
 */

/** Max sanitized error / diagnostic string length (align webhooks / sql-store). */
export const MAX_SANITIZED_ERROR_LENGTH = 512;

/** Max JSON-serialized cached result size for idempotency complete. */
export const MAX_RESULT_JSON_BYTES = 16_384;

/** Max logical key / tenant / prefix segment length. */
export const MAX_KEY_SEGMENT_LENGTH = 128;

/** Max full Redis key length. */
export const MAX_REDIS_KEY_LENGTH = 512;

/** Max payload_ref length (opaque reference, not raw body). */
export const MAX_PAYLOAD_REF_LENGTH = 512;

/**
 * Sanitize and cap an error/diagnostic string.
 * Strips common secret patterns; never stores raw provider payloads.
 */
export function enforceMaxSanitizedError(
  value: string | null | undefined,
  options?: { maxLength?: number },
): string | undefined {
  if (value === null || value === undefined) return undefined;
  let s = String(value)
    .replace(/(password|secret|token|authorization|api[_-]?key)=[^\s&]+/gi, "$1=***")
    .replace(/redis:\/\/[^\s]+/gi, "redis://***")
    .replace(/rediss:\/\/[^\s]+/gi, "rediss://***")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return undefined;
  const max = options?.maxLength ?? MAX_SANITIZED_ERROR_LENGTH;
  if (s.length > max) {
    s = s.slice(0, max - 1) + "…";
  }
  return s;
}

/** Cap a string field; returns undefined when empty after trim. */
export function enforceMaxString(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  let s = String(value).trim();
  if (!s) return undefined;
  if (s.length > maxLength) {
    s = s.slice(0, maxLength - 1) + "…";
  }
  return s;
}
