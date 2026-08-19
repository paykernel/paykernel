import { describe, it, expect } from "bun:test";
import { withRetry } from "./retry";

describe("withRetry maxAttempts sanitization", () => {
  const fastConfig = { baseDelayMs: 0, maxDelayMs: 0 };

  it.each([
    ["NaN (1 attempt)", Number.NaN, 1],
    ["Infinity (1 attempt)", Number.POSITIVE_INFINITY, 1],
    ["fractional 2.9 (2 attempts)", 2.9, 2],
  ] as const)(
    "S20-RETRY-NAN: %s throws the last error, not undefined",
    async (_label, maxAttempts, expectedAttempts) => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error(`fail-${attempts}`);
          },
          {
            isRetryable: () => true,
            config: { ...fastConfig, maxAttempts },
          },
        ),
      ).rejects.toThrow(`fail-${expectedAttempts}`);
      expect(attempts).toBe(expectedAttempts);
    },
  );
});
