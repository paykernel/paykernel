/**
 * Shared fake clock for webhooks package tests (injectable EngineClock shape).
 */

export type TestClock = {
  nowMs(): number;
  advance(ms: number): void;
  set(ms: number): void;
};

export function createTestClock(start = 1_700_000_000_000): TestClock {
  let t = start;
  return {
    nowMs: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
