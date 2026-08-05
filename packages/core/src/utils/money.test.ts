import { describe, expect, it } from "bun:test";

import { InvalidRequestError } from "../errors";
import {
  formatMoney,
  fromMinorUnits,
  isMoney,
  minorAmountToNumber,
  money,
  MoneyAmountError,
  moneyToMajorNumber,
  normalizeAmountInput,
  toMinorUnits,
  validateMoney,
  type Money,
} from "./money";

describe("money()", () => {
  it("builds frozen canonical Money with uppercased currency", () => {
    const m = money("10.50", "sar");
    expect(m.amount).toBe("10.50");
    expect(m.currency).toBe("SAR");
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("pads short fractions to the currency exponent", () => {
    expect(money("10.5", "SAR").amount).toBe("10.50");
    expect(money("10", "SAR").amount).toBe("10.00");
    expect(money("1.2", "KWD").amount).toBe("1.200");
  });

  it("JSON.stringify round-trips as plain amount/currency strings", () => {
    const m = money("10.50", "SAR");
    const json = JSON.stringify(m);
    expect(json).toBe('{"amount":"10.50","currency":"SAR"}');
    const parsed = JSON.parse(json) as Money;
    expect(isMoney(parsed)).toBe(true);
    expect(toMinorUnits(parsed)).toBe(1050n);
  });

  it("accepts deprecated clean number majors", () => {
    expect(money(10.5, "SAR").amount).toBe("10.50");
    expect(money(99.99, "USD").amount).toBe("99.99");
    expect(money(10, "JPY").amount).toBe("10");
  });

  it("rejects non-finite numbers and float noise under default reject", () => {
    expect(() => money(Number.NaN, "SAR")).toThrow(MoneyAmountError);
    expect(() => money(Number.POSITIVE_INFINITY, "SAR")).toThrow(
      MoneyAmountError,
    );
    // 0.1 + 0.2 → excess precision for SAR
    expect(() => money(0.1 + 0.2, "SAR")).toThrow(MoneyAmountError);
  });
});

describe("toMinorUnits / fromMinorUnits", () => {
  it("converts SAR / JPY / KWD via bigint", () => {
    expect(toMinorUnits("10.50", "SAR")).toBe(1050n);
    expect(toMinorUnits("10", "JPY")).toBe(10n);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234n);
    expect(toMinorUnits(money("10.50", "SAR"))).toBe(1050n);
  });

  it("formats canonical majors from minor units", () => {
    expect(fromMinorUnits(1050n, "SAR")).toEqual({
      amount: "10.50",
      currency: "SAR",
    });
    expect(fromMinorUnits(10n, "JPY").amount).toBe("10");
    expect(fromMinorUnits(1234n, "KWD").amount).toBe("1.234");
    expect(fromMinorUnits(1050, "SAR").amount).toBe("10.50");
  });

  it("round-trips money → minor → money", () => {
    const original = money("99.99", "USD");
    expect(fromMinorUnits(toMinorUnits(original), "USD")).toEqual(original);
  });
});

describe("strict precision and rounding", () => {
  it("rejects excess precision by default for 0/2/3 decimal classes", () => {
    expect(() => money("10.5", "JPY")).toThrow(MoneyAmountError);
    expect(() => money("10.999", "SAR")).toThrow(MoneyAmountError);
    expect(() => money("1.2345", "KWD")).toThrow(MoneyAmountError);
    try {
      money("10.999", "SAR");
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyAmountError);
      expect((error as MoneyAmountError).kind).toBe("excess_precision");
    }
  });

  it("applies half_up half_even floor ceil trunc when requested", () => {
    expect(money("10.999", "SAR", { rounding: "half_up" }).amount).toBe(
      "11.00",
    );
    expect(money("1.225", "SAR", { rounding: "half_even" }).amount).toBe(
      "1.22",
    );
    expect(money("1.235", "SAR", { rounding: "half_even" }).amount).toBe(
      "1.24",
    );
    expect(money("10.999", "SAR", { rounding: "trunc" }).amount).toBe("10.99");
    expect(money("10.991", "SAR", { rounding: "floor" }).amount).toBe("10.99");
    expect(money("10.991", "SAR", { rounding: "ceil" }).amount).toBe("11.00");
    expect(
      money("-10.991", "SAR", {
        rounding: "floor",
        allowNegative: true,
      }).amount,
    ).toBe("-11.00");
    expect(
      money("-10.991", "SAR", {
        rounding: "ceil",
        allowNegative: true,
      }).amount,
    ).toBe("-10.99");
  });
});

describe("sign zero policies and overrides", () => {
  it("rejects negative and zero by default; allows with flags", () => {
    expect(() => money("-1.00", "SAR")).toThrow(MoneyAmountError);
    expect(money("-1.25", "SAR", { allowNegative: true }).amount).toBe(
      "-1.25",
    );
    expect(toMinorUnits("-1.25", "SAR", { allowNegative: true })).toBe(-125n);
    expect(() => money("0", "SAR")).toThrow(MoneyAmountError);
    expect(money("0", "SAR", { allowZero: true }).amount).toBe("0.00");
    expect(money(-0, "SAR", { allowZero: true }).amount).toBe("0.00");
  });

  it("applies exponentOverrides and explicit exponent", () => {
    expect(
      toMinorUnits("20.12", "OMR", { exponentOverrides: { OMR: 2 } }),
    ).toBe(2012n);
    expect(() =>
      money("20.125", "OMR", { exponentOverrides: { OMR: 2 } }),
    ).toThrow(MoneyAmountError);
    expect(toMinorUnits("10", "USD", { exponent: 0 })).toBe(10n);
    expect(toMinorUnits("1.234", "USD", { exponent: 3 })).toBe(1234n);
  });

  it("preserves non-ISO exponent on Money for bare toMinorUnits re-resolve (MONEY-1)", () => {
    const omrMerchant = money("20.12", "OMR", {
      exponentOverrides: { OMR: 2 },
    });
    expect(omrMerchant.amount).toBe("20.12");
    expect(omrMerchant.exponent).toBe(2);
    // Without re-passing overrides, ISO OMR=3 would pad → 20120n (silent 10×).
    expect(toMinorUnits(omrMerchant)).toBe(2012n);
    expect(toMinorUnits(omrMerchant)).toBe(
      toMinorUnits("20.12", "OMR", { exponentOverrides: { OMR: 2 } }),
    );

    const isoOmr = money("20.125", "OMR");
    expect(isoOmr.exponent).toBeUndefined();
    expect(toMinorUnits(isoOmr)).toBe(20125n);

    const usdZero = money("10", "USD", { exponent: 0 });
    expect(usdZero.amount).toBe("10");
    expect(usdZero.exponent).toBe(0);
    expect(toMinorUnits(usdZero)).toBe(10n);

    const fromMinor = fromMinorUnits(2012n, "OMR", {
      exponentOverrides: { OMR: 2 },
    });
    expect(fromMinor.exponent).toBe(2);
    expect(toMinorUnits(fromMinor)).toBe(2012n);
  });

  it("honors Money.exponent when exponentOverrides is empty or unrelated (MONEY-1)", () => {
    // Audit MONEY-1: empty overrides map must not drop stored scale → ISO MGA=2.
    const mga = money("500", "MGA", { exponent: 0 });
    expect(mga.exponent).toBe(0);
    expect(toMinorUnits(mga)).toBe(500n);
    expect(toMinorUnits(mga, { exponentOverrides: {} })).toBe(500n);
    expect(toMinorUnits(mga, { exponentOverrides: { OMR: 2 } })).toBe(500n);
    // Explicit map entry for this currency still wins over stored exponent.
    expect(toMinorUnits(mga, { exponentOverrides: { MGA: 2 } })).toBe(50000n);
    // Explicit options.exponent always wins.
    expect(toMinorUnits(mga, { exponent: 2 })).toBe(50000n);
    expect(toMinorUnits(mga, { exponent: 0, exponentOverrides: { MGA: 2 } })).toBe(
      500n,
    );

    const omrMerchant = money("20.12", "OMR", {
      exponentOverrides: { OMR: 2 },
    });
    expect(toMinorUnits(omrMerchant, { exponentOverrides: {} })).toBe(2012n);
    expect(toMinorUnits(omrMerchant, { allowZero: true })).toBe(2012n);
  });

  it("throws on invalid override values", () => {
    expect(() =>
      toMinorUnits("1", "SAR", { exponentOverrides: { SAR: -1 } }),
    ).toThrow(InvalidRequestError);
  });
});

describe("safe number boundaries", () => {
  it("keeps oversized minors as bigint and refuses unsafe Number conversion", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const m = fromMinorUnits(big, "JPY");
    expect(m.amount).toBe(big.toString());
    expect(toMinorUnits(m)).toBe(big);
    expect(() => minorAmountToNumber(big)).toThrow(MoneyAmountError);
    try {
      minorAmountToNumber(big);
    } catch (error) {
      expect((error as MoneyAmountError).kind).toBe("unsafe_range");
    }
  });

  it("minorAmountToNumber and moneyToMajorNumber work within safe range", () => {
    expect(minorAmountToNumber(1050n)).toBe(1050);
    expect(minorAmountToNumber(-50n)).toBe(-50);
    expect(moneyToMajorNumber(money("10.50", "SAR"))).toBe(10.5);
    expect(moneyToMajorNumber(money("10", "JPY"))).toBe(10);
  });

  it("moneyToMajorNumber rejects IEEE-inexact large fractional majors (MONEY-4)", () => {
    // Minor units beyond MAX_SAFE_INTEGER cannot round-trip via JS number.
    const huge = fromMinorUnits(
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      "JPY",
    );
    expect(() => moneyToMajorNumber(huge)).toThrow(MoneyAmountError);
  });

  it("rejects unsafe integer number inputs on the deprecated path", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "JPY")).toThrow(
      MoneyAmountError,
    );
  });
});

describe("invalid formats and helpers", () => {
  const invalid = ["", "10.", ".5", "1e2", "NaN", "abc", "++1", "+1", "1.2.3", "  "];

  it.each(invalid)("rejects invalid decimal string %j", (value) => {
    expect(() => money(value, "SAR")).toThrow(MoneyAmountError);
  });

  it("isMoney validates shape without enforcing scale", () => {
    expect(isMoney(money("1.00", "USD"))).toBe(true);
    expect(isMoney({ amount: "1.00", currency: "USD" })).toBe(true);
    expect(isMoney({ amount: 1, currency: "USD" })).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney({ amount: "1e2", currency: "USD" })).toBe(false);
  });

  it("validateMoney re-parses and canonicalizes", () => {
    const m = validateMoney({ amount: "10.5", currency: "sar" });
    expect(m.amount).toBe("10.50");
    expect(m.currency).toBe("SAR");
  });

  it("formatMoney joins amount and currency with a space", () => {
    expect(formatMoney(money("10.50", "SAR"))).toBe("10.50 SAR");
  });

  it("normalizeAmountInput accepts number and Money and rejects currency mismatch", () => {
    expect(normalizeAmountInput(10.5, "SAR")).toEqual(money("10.50", "SAR"));
    expect(normalizeAmountInput(money("10.50", "SAR"), "SAR")).toEqual(
      money("10.50", "SAR"),
    );
    try {
      normalizeAmountInput(money("10.50", "USD"), "SAR");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyAmountError);
      expect((error as MoneyAmountError).kind).toBe("currency_mismatch");
    }
  });
});

describe("no-float conversion invariant", () => {
  it("string path keeps 0.1 + 0.2 exact as 30n minor units", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    const ten = toMinorUnits(money("0.1", "USD"));
    const twenty = toMinorUnits(money("0.2", "USD"));
    expect(ten + twenty).toBe(30n);
    expect(fromMinorUnits(ten + twenty, "USD").amount).toBe("0.30");
  });
});
