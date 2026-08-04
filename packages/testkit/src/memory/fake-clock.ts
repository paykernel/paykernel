/**
 * Injectable clock for deterministic lease-expiry tests.
 * Prefer this over `Date.now` in memory stores and harnesses.
 */

export type Clock = {
  now(): Date;
  nowMs(): number;
};

export type FakeClock = Clock & {
  /** Set absolute epoch millis or a Date. */
  set(msOrDate: number | Date): void;
  /** Advance by delta millis (may be negative for tests). */
  advance(ms: number): void;
  /** ISO-8601 of current fake time. */
  nowIso(): string;
};

export type CreateFakeClockOptions = {
  /** Initial epoch millis. Default: 1_700_000_000_000 (fixed anchor). */
  initialMs?: number;
  /** Alternative to initialMs. */
  start?: Date;
};

/**
 * Create a mutable fake clock. Not tied to wall time.
 *
 * @param optionsOrStart - Options object, or a `Date` start instant.
 */
export function createFakeClock(
  optionsOrStart: CreateFakeClockOptions | Date = {},
): FakeClock {
  let current: number;
  if (optionsOrStart instanceof Date) {
    current = optionsOrStart.getTime();
  } else {
    current =
      optionsOrStart.initialMs ??
      optionsOrStart.start?.getTime() ??
      1_700_000_000_000;
  }

  return {
    now(): Date {
      return new Date(current);
    },
    nowMs(): number {
      return current;
    },
    nowIso(): string {
      return new Date(current).toISOString();
    },
    set(msOrDate: number | Date): void {
      current = typeof msOrDate === "number" ? msOrDate : msOrDate.getTime();
    },
    advance(ms: number): void {
      current += ms;
    },
  };
}

/** Wall-clock adapter for rare cases that intentionally use real time. */
export function createSystemClock(): Clock {
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
  };
}
