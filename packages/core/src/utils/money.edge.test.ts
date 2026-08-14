/**
 * Phase 5.4 — Safe Money edge-case suite (cases not covered in money.test.ts).
 *
 * Covers multi-currency tables, large/unsafe minors, rounding matrix,
 * marketplace negatives, currency normalization, and a source no-float audit.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidRequestError } from "../errors";
import {
  getCurrencyExponent,
  normalizeCurrencyCode,
} from "./currency";
import {
  fromMinorUnits,
  isMoney,
  minorAmountToNumber,
  money,
  toMinorUnits,
  type Money,
  type MoneyRoundingMode,
} from "./money";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

// ---------------------------------------------------------------------------
// 1) Zero-decimal: JPY, KRW, VND, XOF, ISK (ISO 0)
// ---------------------------------------------------------------------------
describe("5.4 zero-decimal currencies (ISO exponent 0)", () => {
  const zeroDecimal = ["JPY", "KRW", "VND", "XOF", "ISK"] as const;

  it.each([...zeroDecimal])("%s accepts whole units and rejects fractions", (code) => {
    expect(getCurrencyExponent(code)).toBe(0);
    const m = money("100", code);
    expect(m.amount).toBe("100");
    expect(m.currency).toBe(code);
    expect(toMinorUnits(m)).toBe(100n);
    expect(toMinorUnits("100", code)).toBe(100n);

    expect(() => money("100.1", code)).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("100.1", code)).toThrow(InvalidRequestError);
    expect(() => money("0.5", code)).toThrow(InvalidRequestError);
  });

  it("money(\"100\", \"JPY\") canonical form has no decimal point", () => {
    expect(money("100", "JPY")).toEqual({ amount: "100", currency: "JPY" });
  });
});

// ---------------------------------------------------------------------------
// 2) Two-decimal: SAR, USD, EUR
// ---------------------------------------------------------------------------
describe("5.4 two-decimal currencies (ISO exponent 2)", () => {
  const twoDecimal = ["SAR", "USD", "EUR"] as const;

  it.each([...twoDecimal])("%s maps \"10.50\" → 1050n and rejects excess", (code) => {
    expect(getCurrencyExponent(code)).toBe(2);
    expect(toMinorUnits("10.50", code)).toBe(1050n);
    expect(money("10.50", code).amount).toBe("10.50");
    expect(money("10.5", code).amount).toBe("10.50"); // pad

    expect(() => money("10.501", code)).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("10.501", code)).toThrow(InvalidRequestError);
  });
});

// ---------------------------------------------------------------------------
// 3) Three-decimal: KWD, BHD, OMR, JOD
// ---------------------------------------------------------------------------
describe("5.4 three-decimal currencies (ISO exponent 3)", () => {
  const threeDecimal = ["KWD", "BHD", "OMR", "JOD"] as const;

  it.each([...threeDecimal])("%s maps \"1.234\" → 1234n and rejects excess", (code) => {
    expect(getCurrencyExponent(code)).toBe(3);
    expect(toMinorUnits("1.234", code)).toBe(1234n);
    expect(money("1.234", code).amount).toBe("1.234");
    expect(money("1.2", code).amount).toBe("1.200");

    expect(() => money("1.2345", code)).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("1.2345", code)).toThrow(InvalidRequestError);
  });
});

// ---------------------------------------------------------------------------
// 4) Large values near / beyond MAX_SAFE_INTEGER
// ---------------------------------------------------------------------------
describe("5.4 large values (beyond Number.MAX_SAFE_INTEGER)", () => {
  it("toMinorUnits accepts major strings whose minor exceeds MAX_SAFE as bigint", () => {
    // JPY exp 0: major string == minor
    const bigMajor = (MAX_SAFE + 1n).toString();
    const minor = toMinorUnits(bigMajor, "JPY");
    expect(minor).toBe(MAX_SAFE + 1n);
    expect(typeof minor).toBe("bigint");

    // USD exp 2: major that scales past MAX_SAFE
    // (MAX_SAFE + 1) / 100 as major with two decimals is awkward; use a huge integer major.
    const hugeMajor = "90071992547410.00"; // 9007199254741000 minor > MAX_SAFE (9007199254740991)
    const usdMinor = toMinorUnits(hugeMajor, "USD");
    expect(usdMinor).toBe(9007199254741000n);
    expect(usdMinor > MAX_SAFE).toBe(true);
  });

  it("fromMinorUnits ↔ toMinorUnits round-trip for unsafe-size minors", () => {
    const big = MAX_SAFE + 99n;
    const m = fromMinorUnits(big, "JPY");
    expect(m.amount).toBe(big.toString());
    expect(toMinorUnits(m)).toBe(big);

    const kwdBig = MAX_SAFE + 7n;
    const kwd = fromMinorUnits(kwdBig, "KWD");
    expect(toMinorUnits(kwd)).toBe(kwdBig);
  });

  it("minorAmountToNumber throws when minor is outside safe integer range", () => {
    expect(() => minorAmountToNumber(MAX_SAFE + 1n)).toThrow(InvalidRequestError);
    expect(() => minorAmountToNumber(MIN_SAFE - 1n)).toThrow(InvalidRequestError);
    expect(minorAmountToNumber(MAX_SAFE)).toBe(Number.MAX_SAFE_INTEGER);
    expect(minorAmountToNumber(MIN_SAFE)).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("fromMinorUnits rejects unsafe number minors (require bigint)", () => {
    // Number cannot represent MAX_SAFE+1 exactly, but non-safe integers are rejected.
    expect(() =>
      fromMinorUnits(Number.MAX_SAFE_INTEGER + 1, "JPY"),
    ).toThrow(InvalidRequestError);
  });
});

// ---------------------------------------------------------------------------
// 5) Invalid precision rejected by default for each exponent class
// ---------------------------------------------------------------------------
describe("5.4 invalid precision (reject by default)", () => {
  it("rejects one excess digit for 0 / 2 / 3 decimal classes", () => {
    expect(() => toMinorUnits("1.0", "JPY")).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("1.000", "USD")).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("1.0000", "KWD")).toThrow(InvalidRequestError);
  });

  it("rejects long trailing noise that float paths often round away", () => {
    expect(() => toMinorUnits("10.5000000001", "SAR")).toThrow(
      InvalidRequestError,
    );
    expect(() => toMinorUnits("100.0000001", "JPY")).toThrow(
      InvalidRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// 6) Exponent overrides
// ---------------------------------------------------------------------------
describe("5.4 exponent overrides", () => {
  it("getCurrencyExponent('OMR', { OMR: 2 }) returns 2 (ISO is 3)", () => {
    expect(getCurrencyExponent("OMR")).toBe(3);
    expect(getCurrencyExponent("OMR", { OMR: 2 })).toBe(2);
    expect(getCurrencyExponent("omr", { omr: 2 })).toBe(2);
  });

  it("toMinorUnits with exponentOverrides applies merchant scale", () => {
    expect(
      toMinorUnits("20.12", "OMR", { exponentOverrides: { OMR: 2 } }),
    ).toBe(2012n);
    expect(
      money("20.12", "OMR", { exponentOverrides: { OMR: 2 } }).amount,
    ).toBe("20.12");
    // Under override exp 2, three fractional digits are excess
    expect(() =>
      toMinorUnits("20.125", "OMR", { exponentOverrides: { OMR: 2 } }),
    ).toThrow(InvalidRequestError);
  });

  it("explicit options.exponent wins over ISO and overrides map", () => {
    expect(toMinorUnits("10", "USD", { exponent: 0 })).toBe(10n);
    expect(
      toMinorUnits("1.234", "OMR", {
        exponent: 3,
        exponentOverrides: { OMR: 2 },
      }),
    ).toBe(1234n);
  });

  it("getCurrencyExponent rejects override > 18 like money() (P05-MONEY-1)", () => {
    expect(() => getCurrencyExponent("SAR", { SAR: 19 })).toThrow(
      InvalidRequestError,
    );
    expect(() => money("1", "SAR", { exponentOverrides: { SAR: 19 } })).toThrow(
      InvalidRequestError,
    );
    expect(() => money("1", "SAR", { exponent: 19 })).toThrow(
      InvalidRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// 7) Intentional negative marketplace adjustments
// ---------------------------------------------------------------------------
describe("5.4 negative amounts (marketplace / allowNegative)", () => {
  it("toMinorUnits(-5, 'SAR', { allowNegative: true }) → -500n", () => {
    expect(toMinorUnits(-5, "SAR", { allowNegative: true })).toBe(-500n);
    expect(toMinorUnits("-5", "SAR", { allowNegative: true })).toBe(-500n);
    expect(toMinorUnits("-5.00", "SAR", { allowNegative: true })).toBe(-500n);
    expect(
      money("-5.00", "SAR", { allowNegative: true }).amount,
    ).toBe("-5.00");
  });

  it("throws without allowNegative", () => {
    expect(() => toMinorUnits(-5, "SAR")).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("-5.00", "SAR")).toThrow(InvalidRequestError);
    expect(() => money("-1.00", "USD")).toThrow(InvalidRequestError);
  });

  it("documents Moyasar-style reverse split: non-zero negative minor only", () => {
    // Shared primitive: allowNegative + reject zero unless allowZero.
    // Moyasar split path maps allowNonPositive → allowNegative (and rejects 0).
    const reverseSplit = toMinorUnits("-1.25", "SAR", { allowNegative: true });
    expect(reverseSplit).toBe(-125n);
    expect(() =>
      toMinorUnits("0", "SAR", { allowNegative: true }),
    ).toThrow(InvalidRequestError);
    expect(
      toMinorUnits("0", "SAR", { allowNegative: true, allowZero: true }),
    ).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// 8) Rounding policies — at least one case each
// ---------------------------------------------------------------------------
describe("5.4 rounding policies", () => {
  const cases: Array<{
    mode: MoneyRoundingMode;
    input: string;
    currency: string;
    expectedAmount: string;
    expectedMinor: bigint;
  }> = [
    {
      mode: "half_up",
      input: "10.995",
      currency: "SAR",
      expectedAmount: "11.00",
      expectedMinor: 1100n,
    },
    {
      mode: "half_even",
      input: "1.225",
      currency: "SAR",
      expectedAmount: "1.22",
      expectedMinor: 122n,
    },
    {
      mode: "floor",
      input: "10.991",
      currency: "SAR",
      expectedAmount: "10.99",
      expectedMinor: 1099n,
    },
    {
      mode: "ceil",
      input: "10.991",
      currency: "SAR",
      expectedAmount: "11.00",
      expectedMinor: 1100n,
    },
    {
      mode: "trunc",
      input: "10.999",
      currency: "SAR",
      expectedAmount: "10.99",
      expectedMinor: 1099n,
    },
  ];

  it.each(cases)(
    "$mode on $input $currency → $expectedAmount / $expectedMinor",
    ({ mode, input, currency, expectedAmount, expectedMinor }) => {
      const m = money(input, currency, { rounding: mode });
      expect(m.amount).toBe(expectedAmount);
      expect(toMinorUnits(input, currency, { rounding: mode })).toBe(
        expectedMinor,
      );
    },
  );

  it("reject is the default for excess digits", () => {
    expect(() => money("10.991", "SAR")).toThrow(InvalidRequestError);
    expect(() =>
      money("10.991", "SAR", { rounding: "reject" }),
    ).toThrow(InvalidRequestError);
  });

  it("half_up vs half_even differ on banker's tie", () => {
    // 1.225 SAR: first discarded digit 5 exact → half_up away from 0 → 1.23;
    // half_even sees last kept digit 2 (even) → stay 1.22
    expect(money("1.225", "SAR", { rounding: "half_up" }).amount).toBe("1.23");
    expect(money("1.225", "SAR", { rounding: "half_even" }).amount).toBe(
      "1.22",
    );
  });

  it("floor / ceil honor sign for negatives", () => {
    expect(
      money("-10.991", "SAR", { rounding: "floor", allowNegative: true })
        .amount,
    ).toBe("-11.00");
    expect(
      money("-10.991", "SAR", { rounding: "ceil", allowNegative: true }).amount,
    ).toBe("-10.99");
    expect(
      money("-10.991", "SAR", { rounding: "trunc", allowNegative: true })
        .amount,
    ).toBe("-10.99");
  });
});

// ---------------------------------------------------------------------------
// 9) JSON stringify / parse round-trip
// ---------------------------------------------------------------------------
describe("5.4 JSON round-trip", () => {
  it("JSON.stringify(money(...)) parses back to equal amount+currency", () => {
    const original = money("10.50", "SAR");
    const json = JSON.stringify(original);
    expect(json).toBe('{"amount":"10.50","currency":"SAR"}');

    const parsed = JSON.parse(json) as Money;
    expect(parsed.amount).toBe(original.amount);
    expect(parsed.currency).toBe(original.currency);
    expect(isMoney(parsed)).toBe(true);
    expect(toMinorUnits(parsed)).toBe(toMinorUnits(original));
  });

  it("does not embed bigint in the public Money shape", () => {
    const m = money("1.234", "KWD");
    const keys = Object.keys(m).sort();
    expect(keys).toEqual(["amount", "currency"]);
    expect(typeof m.amount).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 10) fromMinorUnits / toMinorUnits roundtrip for 0/2/3 decimal currencies
// ---------------------------------------------------------------------------
describe("5.4 fromMinorUnits / toMinorUnits roundtrip", () => {
  const fixtures: Array<{ currency: string; major: string; minor: bigint }> = [
    { currency: "JPY", major: "100", minor: 100n },
    { currency: "KRW", major: "1500", minor: 1500n },
    { currency: "SAR", major: "10.50", minor: 1050n },
    { currency: "USD", major: "99.99", minor: 9999n },
    { currency: "KWD", major: "1.234", minor: 1234n },
    { currency: "BHD", major: "0.001", minor: 1n },
    { currency: "OMR", major: "20.125", minor: 20125n },
  ];

  it.each(fixtures)(
    "$currency: $major ↔ $minor",
    ({ currency, major, minor }) => {
      expect(toMinorUnits(major, currency)).toBe(minor);
      const back = fromMinorUnits(minor, currency);
      expect(back.amount).toBe(money(major, currency).amount);
      expect(back.currency).toBe(currency);
      expect(toMinorUnits(back)).toBe(minor);
    },
  );
});

// ---------------------------------------------------------------------------
// 11) Case-insensitive currency codes
// ---------------------------------------------------------------------------
describe("5.4 case-insensitive currency codes", () => {
  it("normalizes currency to uppercase on money / toMinorUnits / fromMinorUnits", () => {
    expect(money("10.50", "sar").currency).toBe("SAR");
    expect(money("10", "jpy").currency).toBe("JPY");
    expect(toMinorUnits("1.234", "kwd")).toBe(1234n);
    expect(fromMinorUnits(1050n, "usd").currency).toBe("USD");
    expect(getCurrencyExponent("isk")).toBe(0);
    expect(getCurrencyExponent("OmR")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 12) Whitespace-trimmed currency; invalid / unknown currency defaults
// ---------------------------------------------------------------------------
describe("5.4 currency whitespace and unknown codes", () => {
  it("trims whitespace on currency codes", () => {
    expect(normalizeCurrencyCode("  sar ")).toBe("SAR");
    expect(money("10.50", "  SAR  ").currency).toBe("SAR");
    expect(toMinorUnits("10", " jpy ")).toBe(10n);
    expect(getCurrencyExponent("  KWD ")).toBe(3);
  });

  it("trims whitespace on amount decimal strings", () => {
    expect(toMinorUnits("  10.50  ", "SAR")).toBe(1050n);
    expect(money("  100  ", "JPY").amount).toBe("100");
  });

  it("unknown currency codes fail closed (MONEY-4)", () => {
    expect(() => getCurrencyExponent("XXX")).toThrow(InvalidRequestError);
    expect(() => getCurrencyExponent("ZZZ")).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("1.50", "XXX")).toThrow(InvalidRequestError);
    expect(() => money("1.50", "JYP")).toThrow(InvalidRequestError);
    // Explicit exponent still allowed for intentional non-ISO codes
    expect(toMinorUnits("1.50", "XXX", { exponent: 2 })).toBe(150n);
    expect(getCurrencyExponent("XXX", { allowUnknown: true })).toBe(2);
  });

  it("empty / whitespace-only currency throws", () => {
    expect(() => normalizeCurrencyCode("")).toThrow(InvalidRequestError);
    expect(() => normalizeCurrencyCode("   ")).toThrow(InvalidRequestError);
    expect(() => money("10", "")).toThrow(InvalidRequestError);
    expect(() => money("10", "   ")).toThrow(InvalidRequestError);
    expect(() => toMinorUnits("10", "")).toThrow(InvalidRequestError);
  });
});

// ---------------------------------------------------------------------------
// No-float invariant + classic 0.1 + 0.2 trap
// ---------------------------------------------------------------------------
describe("5.4 no-float finance invariant", () => {
  it("money string path avoids classic 0.1 + 0.2 binary float trap", () => {
    // IEEE-754: 0.1 + 0.2 !== 0.3
    expect(0.1 + 0.2).not.toBe(0.3);

    const a = toMinorUnits(money("0.1", "USD"));
    const b = toMinorUnits(money("0.2", "USD"));
    expect(a).toBe(10n);
    expect(b).toBe(20n);
    expect(a + b).toBe(30n);
    expect(fromMinorUnits(a + b, "USD").amount).toBe("0.30");
  });

  it("conversion results are always bigint (never number)", () => {
    const samples: Array<() => bigint> = [
      () => toMinorUnits("10.50", "SAR"),
      () => toMinorUnits("100", "JPY"),
      () => toMinorUnits("1.234", "KWD"),
      () => toMinorUnits(money("99.99", "EUR")),
      () => toMinorUnits(-5, "SAR", { allowNegative: true }),
    ];
    for (const fn of samples) {
      const v = fn();
      expect(typeof v).toBe("bigint");
    }
  });

  it("money.ts source does not use Math.round or float * 10**n conversion", () => {
    // Static audit of the conversion module (not gateways — those are Stream B).
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "money.ts"), "utf8");

    // Strip block comments and line comments so doc examples don't false-positive.
    const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
    const codeOnly = withoutBlockComments
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    expect(codeOnly).not.toMatch(/Math\.round\s*\(/);
    expect(codeOnly).not.toMatch(/Number\.EPSILON/);
    // Forbidden float conversion patterns (bigint `10n **` is fine).
    expect(codeOnly).not.toMatch(/\*\s*10\s*\*\*\s*(?!n)/);
    expect(codeOnly).not.toMatch(/10\s*\*\*\s*[a-zA-Z_]/);
    expect(codeOnly).not.toMatch(/\*\s*100\b/);
    // Positive signal: bigint scale in formatMinorAsDecimal
    expect(src).toMatch(/10n\s*\*\*/);
    expect(src).toMatch(/BigInt\s*\(/);
  });
});
