// file: packages/payments/src/utils/retry.ts

/**
 * Shared network retry helper with exponential backoff.
 *
 * Extracted from the original PayPal gateway implementation so every gateway
 * can recover from transient failures (network errors, 5xx, 429) instead of
 * failing an entire operation on a single network blip.
 *
 * IMPORTANT: Only retry idempotent or safe failures. Callers MUST NOT retry a
 * non-idempotent mutation unless an idempotency key (or equivalent dedupe
 * guard) is present — pass an `isRetryable` predicate that returns false in
 * that case.
 */

export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts: number;
  /** Base delay for exponential backoff in milliseconds. Default: 500 */
  baseDelayMs: number;
  /** Maximum delay between attempts in milliseconds. Default: 5000 */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
};

export interface WithRetryOptions {
  /** Predicate deciding whether a thrown error is safe to retry. */
  isRetryable: (error: unknown) => boolean;
  /**
   * Optional override for how long to wait before the next attempt. Receives
   * the error and the zero-based attempt index. Defaults to exponential
   * backoff that respects an explicit `retryAfterSeconds` on the error (e.g.
   * a parsed Retry-After header on 429 responses).
   */
  getRetryDelayMs?: (error: unknown, attempt: number) => number;
  /** Retry tuning overrides. */
  config?: Partial<RetryConfig>;
  /** Invoked right before sleeping for a retry. Useful for logging. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Read an explicit Retry-After style delay (in seconds) from an error object.
 * Works for any error exposing a numeric `retryAfterSeconds` property, such as
 * the SDK's RateLimitError and PayPal's API error.
 */
export function extractRetryAfterSeconds(error: unknown): number | undefined {
  if (error && typeof error === "object" && "retryAfterSeconds" in error) {
    const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Parse a Retry-After header value into seconds. Supports both the numeric
 * (delta-seconds) and HTTP-date forms.
 */
export function parseRetryAfterSeconds(
  headers: Headers | undefined,
): number | undefined {
  const retryAfter = headers?.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }

  const numericRetryAfter = Number(retryAfter);
  if (Number.isFinite(numericRetryAfter) && numericRetryAfter >= 0) {
    return numericRetryAfter;
  }

  const retryDate = new Date(retryAfter);
  const retryAfterSeconds = Math.ceil((retryDate.getTime() - Date.now()) / 1000);
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : undefined;
}

/**
 * High ceiling for provider-supplied Retry-After waits. Separate from
 * `maxDelayMs` (which caps exponential backoff) so a Retry-After: 120 header
 * is respected even when maxDelayMs is only a few seconds. Oversized values
 * are still clamped so a malformed header cannot hang the process indefinitely.
 */
const RETRY_AFTER_MAX_MS = 120_000;

function defaultRetryDelayMs(
  error: unknown,
  attempt: number,
  config: RetryConfig,
): number {
  const retryAfterSeconds = extractRetryAfterSeconds(error);
  if (retryAfterSeconds !== undefined) {
    const retryAfterMs = retryAfterSeconds * 1000;
    // Honor provider Retry-After; do not clamp it down to maxDelayMs.
    const ceiling = Math.max(config.maxDelayMs, RETRY_AFTER_MAX_MS);
    return Math.min(retryAfterMs, ceiling);
  }

  // Mild full-jitter on the exponential backoff path only:
  // delay = random(0 .. min(base * 2^attempt, maxDelay))
  const expCap = Math.min(
    config.baseDelayMs * Math.pow(2, attempt),
    config.maxDelayMs,
  );
  return Math.floor(Math.random() * (expCap + 1));
}

/**
 * Run `operation`, retrying transient failures with exponential backoff.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.config };
  // Guard against maxAttempts <= 0 (would skip the loop and throw undefined).
  config.maxAttempts = Math.max(1, config.maxAttempts);
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!options.isRetryable(error) || attempt === config.maxAttempts - 1) {
        throw error;
      }

      const delay = options.getRetryDelayMs
        ? options.getRetryDelayMs(error, attempt)
        : defaultRetryDelayMs(error, attempt, config);

      options.onRetry?.(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
