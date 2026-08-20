// file: packages/core/src/runtime/clock.ts

/**
 * Injectable wall-clock abstraction for portable gateways and clients.
 *
 * Prefer injecting a fake clock in tests rather than stubbing `Date.now`.
 */
export interface Clock {
  now(): Date;
  nowMs(): number;
}

/** Default clock backed by the host `Date` / `Date.now`. */
export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

/**
 * Convert a Unix epoch in seconds to an ISO-8601 string.
 * Non-finite, non-positive, and non-number values are omitted (no invented epoch).
 */
export function unixSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return new Date(value * 1000).toISOString();
}
