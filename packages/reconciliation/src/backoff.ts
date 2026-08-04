/**
 * Portable exponential backoff + jitter for reconciliation reschedule.
 * Injectable random for tests; no Node-only APIs.
 */

export type ExponentialBackoffOptions = {
  /** Base delay in ms (attempt 0). */
  baseMs: number;
  /** Cap on computed delay (before/after jitter). */
  maxMs: number;
  /** Multiplier per attempt (default 2). */
  multiplier?: number;
  /**
   * Jitter ratio in [0, 1]. Delay is multiplied by (1 ± jitterRatio * noise).
   * Default 0.2. Use 0 for deterministic delays.
   */
  jitterRatio?: number;
  /**
   * Injectable RNG returning [0, 1). Default Math.random.
   * Tests should inject a fixed sequence for determinism.
   */
  random?: () => number;
};

export type ExponentialBackoff = {
  /**
   * Compute delay for the given attempt index (0-based after first failure).
   * delay = min(maxMs, baseMs * multiplier^attempt) * (1 ± jitter)
   */
  nextDelayMs(attempt: number): number;
  readonly baseMs: number;
  readonly maxMs: number;
  readonly multiplier: number;
  readonly jitterRatio: number;
};

/**
 * Create an exponential backoff calculator with optional jitter.
 *
 * Jitter: `factor = 1 + (random() * 2 - 1) * jitterRatio` so factor ∈ [1-j, 1+j].
 * Result is clamped to [0, maxMs] after jitter.
 */
export function createExponentialBackoff(
  options: ExponentialBackoffOptions,
): ExponentialBackoff {
  const baseMs = options.baseMs;
  const maxMs = options.maxMs;
  const multiplier = options.multiplier ?? 2;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const random = options.random ?? Math.random;

  if (!(baseMs >= 0) || !(maxMs >= 0)) {
    throw new Error("baseMs and maxMs must be non-negative");
  }
  if (multiplier < 1) {
    throw new Error("multiplier must be >= 1");
  }
  if (jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("jitterRatio must be in [0, 1]");
  }

  return {
    baseMs,
    maxMs,
    multiplier,
    jitterRatio,
    nextDelayMs(attempt: number): number {
      const a = Math.max(0, Math.floor(attempt));
      const exp = baseMs * multiplier ** a;
      const capped = Math.min(maxMs, exp);
      if (jitterRatio === 0) {
        return Math.min(maxMs, Math.max(0, capped));
      }
      const r = random();
      // Bound r to [0,1) if consumer returns out of range
      const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0.5;
      const factor = 1 + (unit * 2 - 1) * jitterRatio;
      const withJitter = capped * factor;
      return Math.min(maxMs, Math.max(0, Math.round(withJitter)));
    },
  };
}
