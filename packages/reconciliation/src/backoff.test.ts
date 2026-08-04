import { describe, it, expect } from "bun:test";
import { createExponentialBackoff } from "./backoff";

describe("createExponentialBackoff", () => {
  it("increases with attempt and respects max", () => {
    const b = createExponentialBackoff({
      baseMs: 100,
      maxMs: 1000,
      multiplier: 2,
      jitterRatio: 0,
    });
    expect(b.nextDelayMs(0)).toBe(100);
    expect(b.nextDelayMs(1)).toBe(200);
    expect(b.nextDelayMs(2)).toBe(400);
    expect(b.nextDelayMs(3)).toBe(800);
    expect(b.nextDelayMs(4)).toBe(1000);
    expect(b.nextDelayMs(10)).toBe(1000);
  });

  it("jitter is bounded with fixed rng", () => {
    // random always 0 → factor = 1 + (0*2-1)*0.2 = 0.8
    const low = createExponentialBackoff({
      baseMs: 1000,
      maxMs: 100_000,
      multiplier: 1,
      jitterRatio: 0.2,
      random: () => 0,
    });
    expect(low.nextDelayMs(0)).toBe(800);

    // random ~1 → factor = 1 + (0.999*2-1)*0.2 ≈ 1.2
    const high = createExponentialBackoff({
      baseMs: 1000,
      maxMs: 100_000,
      multiplier: 1,
      jitterRatio: 0.2,
      random: () => 0.999999,
    });
    const d = high.nextDelayMs(0);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(1200);
  });

  it("rejects invalid options", () => {
    expect(() =>
      createExponentialBackoff({ baseMs: -1, maxMs: 10 }),
    ).toThrow();
    expect(() =>
      createExponentialBackoff({ baseMs: 1, maxMs: 10, multiplier: 0.5 }),
    ).toThrow();
  });
});
