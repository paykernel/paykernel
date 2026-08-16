import { describe, expect, it } from "bun:test";

import { InvalidRequestError } from "../errors";
import {
  getCurrencyExponent,
  isKnownCurrencyCode,
  normalizeCurrencyCode,
} from "./currency";

describe("normalizeCurrencyCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeCurrencyCode("sar")).toBe("SAR");
    expect(normalizeCurrencyCode("  usd ")).toBe("USD");
    expect(normalizeCurrencyCode("JPY")).toBe("JPY");
  });

  it("rejects empty / non-string", () => {
    expect(() => normalizeCurrencyCode("")).toThrow(InvalidRequestError);
    expect(() => normalizeCurrencyCode("   ")).toThrow(InvalidRequestError);
    expect(() =>
      normalizeCurrencyCode(null as unknown as string),
    ).toThrow(InvalidRequestError);
  });
});

describe("getCurrencyExponent", () => {
  it.each([
    // Zero-decimal currencies
    ["JPY", 0],
    ["KRW", 0],
    ["VND", 0],
    ["XOF", 0],
    ["ISK", 0], // ISO 4217 exponent 0
    ["UYI", 0], // Uruguay Peso en Unidades Indexadas
    // Three-decimal currencies
    ["KWD", 3],
    ["BHD", 3],
    ["OMR", 3],
    ["JOD", 3],
    // Four-decimal currencies
    ["CLF", 4], // Unidad de Fomento
    ["UYW", 4], // Unidad previsional
    // Standard two-decimal currencies
    ["SAR", 2],
    ["USD", 2],
    ["EUR", 2],
    ["MGA", 2], // ISO 4217 exponent 2 (not zero-decimal)
    ["JMD", 2],
    ["XCG", 2], // Caribbean guilder (replaced ANG)
    ["XAD", 2],
    ["jmd", 2],
    ["xcg", 2],
    ["xad", 2],
    // Case-insensitive
    ["jpy", 0],
    ["isk", 0],
    ["mga", 2],
    ["kwd", 3],
    ["sar", 2],
    ["clf", 4],
    ["uyi", 0],
    ["uyw", 4],
  ])("getCurrencyExponent(%s) returns %i", (currency, expected) => {
    expect(getCurrencyExponent(currency)).toBe(expected);
  });

  it("unknown currency codes fail closed (MONEY-4)", () => {
    expect(() => getCurrencyExponent("XXX")).toThrow(InvalidRequestError);
    expect(() => getCurrencyExponent("ZZZ")).toThrow(InvalidRequestError);
    // Typo of JPY must not silently use exponent 2
    expect(() => getCurrencyExponent("JYP")).toThrow(InvalidRequestError);
    expect(getCurrencyExponent("XXX", { allowUnknown: true })).toBe(2);
    expect(getCurrencyExponent("JYP", { allowUnknown: true })).toBe(2);
  });

  it("applies overrides when provided (override wins over ISO)", () => {
    // ISO OMR = 3; merchant override 2 (Paymob Oman-style)
    expect(getCurrencyExponent("OMR", { OMR: 2 })).toBe(2);
    expect(getCurrencyExponent("omr", { OMR: 2 })).toBe(2);
    // Case-insensitive override keys
    expect(getCurrencyExponent("OMR", { omr: 2 })).toBe(2);
    // Unlisted codes still use ISO/default
    expect(getCurrencyExponent("SAR", { OMR: 2 })).toBe(2);
    // Zero-decimal override on a 2-decimal ISO code
    expect(getCurrencyExponent("USD", { USD: 0 })).toBe(0);
  });

  it("throws when an explicit override value is invalid", () => {
    expect(() => getCurrencyExponent("SAR", { SAR: -1 })).toThrow(
      InvalidRequestError,
    );
    expect(() => getCurrencyExponent("SAR", { SAR: 1.5 })).toThrow(
      InvalidRequestError,
    );
    expect(() =>
      getCurrencyExponent("SAR", { SAR: Number.NaN }),
    ).toThrow(InvalidRequestError);
    expect(() => getCurrencyExponent("SAR", { SAR: 19 })).toThrow(
      InvalidRequestError,
    );
  });

  it("ignores overrides map when currency is not present", () => {
    expect(getCurrencyExponent("JPY", { OMR: 2 })).toBe(0);
    expect(getCurrencyExponent("KWD", {})).toBe(3);
  });

  it("honors map overrides mixed with allowUnknown (MONEY-3)", () => {
    // Classic dual-overload footgun: { OMR: 2, allowUnknown: true } must not
    // drop the OMR override and fall back to ISO exponent 3.
    expect(
      getCurrencyExponent("OMR", { OMR: 2, allowUnknown: true }),
    ).toBe(2);
    expect(
      getCurrencyExponent("XXX", { OMR: 2, allowUnknown: true }),
    ).toBe(2);
    // Explicit options form still works
    expect(
      getCurrencyExponent("OMR", { overrides: { OMR: 2 }, allowUnknown: true }),
    ).toBe(2);
  });
});

describe("isKnownCurrencyCode", () => {
  it("returns true for known 0/2/3/4-decimal ISO codes", () => {
    expect(isKnownCurrencyCode("JPY")).toBe(true);
    expect(isKnownCurrencyCode("USD")).toBe(true);
    expect(isKnownCurrencyCode("OMR")).toBe(true);
    expect(isKnownCurrencyCode("CLF")).toBe(true);
    expect(isKnownCurrencyCode("MGA")).toBe(true);
    expect(isKnownCurrencyCode("JMD")).toBe(true);
    expect(isKnownCurrencyCode("XCG")).toBe(true);
    expect(isKnownCurrencyCode("XAD")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isKnownCurrencyCode("usd")).toBe(true);
    expect(isKnownCurrencyCode("  omr ")).toBe(true);
    expect(isKnownCurrencyCode("jpy")).toBe(true);
  });

  it("returns false for unknown codes and does not treat typos as known", () => {
    expect(isKnownCurrencyCode("XXX")).toBe(false);
    expect(isKnownCurrencyCode("JYP")).toBe(false);
    expect(isKnownCurrencyCode("ZZZ")).toBe(false);
  });

  it("rejects empty / whitespace-only codes", () => {
    expect(() => isKnownCurrencyCode("")).toThrow(InvalidRequestError);
    expect(() => isKnownCurrencyCode("   ")).toThrow(InvalidRequestError);
  });
});
