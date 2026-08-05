/**
 * Provider exponent/profile deltas expressed through shared money helpers.
 *
 * Does not call private gateway methods. Locks that Stripe/PayPal/Paymob
 * deviations stay explicit via `exponent` / `exponentOverrides` (not ISO-only).
 */
import { describe, expect, it } from "bun:test";

import { InvalidRequestError } from "../errors";
import { getCurrencyExponent } from "./currency";
import {
  fromMinorUnits,
  minorAmountToNumber,
  money,
  toMinorUnits,
} from "./money";

/**
 * Stripe-documented deviations from ISO 4217 for charge scaling.
 * Mirrors packages/core/src/gateways/stripe/stripe.gateway.ts tables
 * (kept local to the gateway; expressed here as override maps for shared helpers).
 */
const STRIPE_EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  // ISO ISK/UGX = 0; Stripe treats as two-decimal specials (whole-unit only at charge).
  ISK: 2,
  UGX: 2,
  // ISO MGA = 2; Stripe treats as zero-decimal.
  MGA: 0,
};

/**
 * PayPal zero-decimal currency list (HUF/JPY/TWD).
 * Other currencies use scale 2 on PayPal (even if ISO says 3).
 */
const PAYPAL_ZERO_DECIMAL = new Set(["HUF", "JPY", "TWD"]);

function paypalScale(currency: string): number {
  return PAYPAL_ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

describe("ISO baseline shared by Moyasar / default Paymob", () => {
  it("matches ISO exponents for common gateway currencies", () => {
    expect(getCurrencyExponent("SAR")).toBe(2);
    expect(getCurrencyExponent("USD")).toBe(2);
    expect(getCurrencyExponent("JPY")).toBe(0);
    expect(getCurrencyExponent("KWD")).toBe(3);
    expect(getCurrencyExponent("OMR")).toBe(3);
    expect(getCurrencyExponent("ISK")).toBe(0); // ISO 0 — Stripe differs
    expect(getCurrencyExponent("UGX")).toBe(0);
    expect(getCurrencyExponent("MGA")).toBe(2); // ISO 2 — Stripe differs
  });

  it("converts Moyasar-style SAR / JPY / KWD via shared bigint path", () => {
    expect(toMinorUnits("10.50", "SAR")).toBe(1050n);
    expect(toMinorUnits("100", "JPY")).toBe(100n);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234n);
    // Unsafe-size minors stay bigint; provider send must use minorAmountToNumber
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(toMinorUnits(fromMinorUnits(big, "JPY"))).toBe(big);
    expect(() => minorAmountToNumber(big)).toThrow(InvalidRequestError);
  });
});

describe("Stripe provider exponent profile (explicit overrides)", () => {
  it("ISK / UGX use exponent 2 under Stripe overrides (ISO is 0)", () => {
    expect(getCurrencyExponent("ISK")).toBe(0);
    expect(getCurrencyExponent("UGX")).toBe(0);

    expect(
      getCurrencyExponent("ISK", STRIPE_EXPONENT_OVERRIDES),
    ).toBe(2);
    expect(
      getCurrencyExponent("UGX", STRIPE_EXPONENT_OVERRIDES),
    ).toBe(2);

    // Whole units only in practice: "100" → 10000 minor under exp 2
    expect(
      toMinorUnits("100", "ISK", {
        exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
      }),
    ).toBe(10000n);
    expect(
      toMinorUnits("100", "UGX", {
        exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
      }),
    ).toBe(10000n);

    // Fractional under Stripe's exp-2 would be allowed by scale alone;
    // Stripe also enforces whole-unit-only as a separate business rule.
    expect(
      toMinorUnits("100.50", "ISK", {
        exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
      }),
    ).toBe(10050n);
  });

  it("MGA is zero-decimal under Stripe overrides (ISO is 2)", () => {
    expect(getCurrencyExponent("MGA")).toBe(2);
    expect(getCurrencyExponent("MGA", STRIPE_EXPONENT_OVERRIDES)).toBe(0);

    expect(
      toMinorUnits("500", "MGA", {
        exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
      }),
    ).toBe(500n);
    expect(() =>
      toMinorUnits("500.50", "MGA", {
        exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
      }),
    ).toThrow(InvalidRequestError);

    // ISO path still two-decimal
    expect(toMinorUnits("500.50", "MGA")).toBe(50050n);
  });

  it("documents Stripe three-decimal ÷10 rule as post-conversion check", () => {
    // Shared conversion: 1.234 KWD → 1234n (valid scale)
    const minor = toMinorUnits("1.234", "KWD");
    expect(minor).toBe(1234n);
    // Stripe business rule (gateway): minor must be divisible by 10
    expect(minor % 10n === 0n).toBe(false);
    // Valid Stripe-style amount
    const valid = toMinorUnits("1.230", "KWD");
    expect(valid).toBe(1230n);
    expect(valid % 10n === 0n).toBe(true);
  });

  it("minorAmountToNumber is the safe Stripe JSON-number boundary", () => {
    const cents = toMinorUnits("10.50", "USD");
    expect(minorAmountToNumber(cents)).toBe(1050);

    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => minorAmountToNumber(tooBig)).toThrow(InvalidRequestError);
  });
});

describe("PayPal provider scale profile (explicit exponent)", () => {
  it("HUF / JPY / TWD are zero-decimal; others scale 2 (including ISO-3 codes)", () => {
    for (const code of ["HUF", "JPY", "TWD"] as const) {
      expect(paypalScale(code)).toBe(0);
      expect(toMinorUnits("100", code, { exponent: 0 })).toBe(100n);
      expect(() => toMinorUnits("100.5", code, { exponent: 0 })).toThrow(
        InvalidRequestError,
      );
    }

    // PayPal does not use ISO 3 for KWD/OMR — scale stays 2 when using PayPal profile
    expect(paypalScale("KWD")).toBe(2);
    expect(getCurrencyExponent("KWD")).toBe(3);
    expect(toMinorUnits("1.23", "KWD", { exponent: paypalScale("KWD") })).toBe(
      123n,
    );
    expect(() =>
      toMinorUnits("1.234", "KWD", { exponent: paypalScale("KWD") }),
    ).toThrow(InvalidRequestError);
  });

  it("format-style major string from fromMinorUnits is PayPal value-ready", () => {
    // PayPal sends decimal strings; canonical Money.amount is that string.
    const m = fromMinorUnits(1050n, "USD", { exponent: 2 });
    expect(m.amount).toBe("10.50");
    const jpy = fromMinorUnits(100n, "JPY", { exponent: 0 });
    expect(jpy.amount).toBe("100");
  });
});

describe("Paymob merchant exponent overrides", () => {
  it("OMR:2 merchant override matches documented Paymob config behavior", () => {
    const overrides = { OMR: 2 } as const;
    expect(getCurrencyExponent("OMR")).toBe(3);
    expect(getCurrencyExponent("OMR", overrides)).toBe(2);

    expect(toMinorUnits("20.12", "OMR", { exponentOverrides: overrides })).toBe(
      2012n,
    );
    // ISO three-decimal path still available without override
    expect(toMinorUnits("20.125", "OMR")).toBe(20125n);
    expect(() =>
      toMinorUnits("20.125", "OMR", { exponentOverrides: overrides }),
    ).toThrow(InvalidRequestError);
  });

  it("money() stores override exponent so bare toMinorUnits does not 10× (MONEY-1)", () => {
    const overrides = { OMR: 2 } as const;
    const m = money("20.12", "OMR", { exponentOverrides: overrides });
    expect(m.exponent).toBe(2);
    expect(toMinorUnits(m)).toBe(2012n);
    // Re-normalize with ISO path still available for full three-decimal strings
    expect(toMinorUnits("20.125", "OMR")).toBe(20125n);
  });
});

describe("cross-profile consistency for shared major amounts", () => {
  it("same major string yields profile-specific minors without float math", () => {
    const major = "100";

    const isoJpy = toMinorUnits(major, "JPY"); // ISO 0
    const stripeIsk = toMinorUnits(major, "ISK", {
      exponentOverrides: STRIPE_EXPONENT_OVERRIDES,
    }); // Stripe 2
    const isoIsk = toMinorUnits(major, "ISK"); // ISO 0

    expect(isoJpy).toBe(100n);
    expect(isoIsk).toBe(100n);
    expect(stripeIsk).toBe(10000n);

    // Profiles must not be silently unified
    expect(isoIsk).not.toBe(stripeIsk);
  });

  it("money() + toMinorUnits is stable across repeated conversions", () => {
    const m = money("10.50", "SAR");
    expect(toMinorUnits(m)).toBe(1050n);
    expect(toMinorUnits(m)).toBe(toMinorUnits("10.50", "SAR"));
    expect(fromMinorUnits(1050n, "SAR")).toEqual(m);
  });
});
