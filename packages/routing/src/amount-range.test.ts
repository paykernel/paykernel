import { describe, it, expect } from "bun:test";
import {
  amountInRange,
  amountOutsideConfiguredRange,
  compareDecimalAmounts,
  resolveInputAmount,
} from "./amount-range";
import type { RouteMatchCriteria, RoutingInput } from "./types";

describe("resolveInputAmount", () => {
  it("resolves money-shaped amount", () => {
    expect(
      resolveInputAmount({ amount: { amount: "10.50", currency: "SAR" } }),
    ).toEqual({ amount: "10.50", currency: "SAR" });
  });

  it("resolves plain string with amountCurrency", () => {
    expect(
      resolveInputAmount({ amount: "9.5", amountCurrency: "USD" }),
    ).toEqual({ amount: "9.5", currency: "USD" });
  });

  it("returns null without amount or currency", () => {
    expect(resolveInputAmount({})).toBeNull();
    expect(resolveInputAmount({ amount: "10" })).toBeNull();
    expect(resolveInputAmount({ amountCurrency: "USD" })).toBeNull();
  });
});

describe("amountInRange money-safe", () => {
  const range: RouteMatchCriteria = {
    amountMin: "10.00",
    amountMax: "100.00",
    amountCurrency: "USD",
  };

  it("matches inclusive min and max", () => {
    expect(
      amountInRange(
        { amount: { amount: "10.00", currency: "USD" } },
        range,
      ),
    ).toBe(true);
    expect(
      amountInRange(
        { amount: { amount: "100.00", currency: "USD" } },
        range,
      ),
    ).toBe(true);
    expect(
      amountInRange({ amount: { amount: "50", currency: "USD" } }, range),
    ).toBe(true);
  });

  it("rejects below min and above max", () => {
    expect(
      amountInRange({ amount: { amount: "9.99", currency: "USD" } }, range),
    ).toBe(false);
    expect(
      amountInRange({ amount: { amount: "100.01", currency: "USD" } }, range),
    ).toBe(false);
  });

  it("compares decimal strings safely without float (10.00 vs 9.5)", () => {
    // Float would corrupt 0.1+0.2 style amounts; bigint path must be exact.
    expect(
      amountInRange(
        { amount: "9.5", amountCurrency: "USD" },
        { amountMin: "10.00", amountCurrency: "USD" },
      ),
    ).toBe(false);
    expect(
      amountInRange(
        { amount: "10.00", amountCurrency: "USD" },
        { amountMin: "9.5", amountCurrency: "USD" },
      ),
    ).toBe(true);
    expect(
      amountInRange(
        { amount: "0.1", amountCurrency: "USD" },
        { amountMin: "0.10", amountMax: "0.20", amountCurrency: "USD" },
      ),
    ).toBe(true);
  });

  it("rejects cross-currency range (no silent match)", () => {
    expect(
      amountInRange(
        { amount: { amount: "50", currency: "SAR" } },
        { amountMin: "10", amountMax: "100", amountCurrency: "USD" },
      ),
    ).toBe(false);
  });

  it("wildcard when no range on rule", () => {
    expect(amountInRange({ amount: "1", amountCurrency: "USD" }, {})).toBe(
      true,
    );
    expect(amountInRange({}, {})).toBe(true);
  });

  it("fails closed when range set but input amount missing", () => {
    expect(amountInRange({}, range)).toBe(false);
  });

  it("fails closed when range set without amountCurrency on rule", () => {
    expect(
      amountInRange(
        { amount: { amount: "50", currency: "USD" } },
        { amountMin: "10", amountMax: "100" },
      ),
    ).toBe(false);
  });

  it("ROUTE-1: amountOutsideConfiguredRange true when range lacks amountCurrency", () => {
    // Misconfigured money bounds must surface as honesty violations so
    // select-time fallback cannot silently accept unconstrained amounts.
    expect(
      amountOutsideConfiguredRange(
        { amount: { amount: "50", currency: "USD" } },
        { amountMin: "10", amountMax: "100" },
      ),
    ).toBe(true);
    expect(
      amountOutsideConfiguredRange(
        { amount: { amount: "50", currency: "USD" } },
        { amountMin: "10", amountMax: "100", amountCurrency: "USD" },
      ),
    ).toBe(false);
  });

  it("compareDecimalAmounts uses bigint ordering", () => {
    expect(compareDecimalAmounts("9.5", "10.00", "USD")).toBeLessThan(0);
    expect(compareDecimalAmounts("10.00", "10", "USD")).toBe(0);
    expect(compareDecimalAmounts("10.01", "10.00", "USD")).toBeGreaterThan(0);
  });

  it("handles 3-decimal currencies (KWD)", () => {
    const kwdRange: RouteMatchCriteria = {
      amountMin: "1.000",
      amountMax: "5.500",
      amountCurrency: "KWD",
    };
    expect(
      amountInRange({ amount: { amount: "1.234", currency: "KWD" } }, kwdRange),
    ).toBe(true);
    expect(
      amountInRange({ amount: { amount: "5.501", currency: "KWD" } }, kwdRange),
    ).toBe(false);
  });

  it("ROUTE-1: allows zero amounts and amountMin/Max of 0 (setup/trial rules)", () => {
    expect(
      amountInRange(
        { amount: { amount: "0", currency: "USD" } },
        { amountMin: "0", amountMax: "0", amountCurrency: "USD" },
      ),
    ).toBe(true);
    expect(
      amountInRange(
        { amount: { amount: "0.00", currency: "USD" } },
        { amountMin: "0", amountMax: "10", amountCurrency: "USD" },
      ),
    ).toBe(true);
    expect(
      amountInRange(
        { amount: { amount: "1.00", currency: "USD" } },
        { amountMin: "0", amountMax: "0", amountCurrency: "USD" },
      ),
    ).toBe(false);
  });
});
