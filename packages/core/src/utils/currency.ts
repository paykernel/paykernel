// file: packages/core/src/utils/currency.ts

import { InvalidRequestError } from "../errors";

/**
 * Shared ISO 4217 currency minor-unit (exponent) helper.
 *
 * All SDK public APIs accept and return amounts in MAJOR currency units
 * (e.g. 100.50 SAR / money("100.50", "SAR")). Gateways convert to/from
 * minor units at the SDK boundary using shared money helpers + this
 * exponent lookup so 0-decimal (JPY, KRW, ...) and 3-decimal (KWD, BHD,
 * OMR, ...) currencies are handled correctly.
 *
 * Gateways whose provider documents currency rules that deviate from
 * ISO 4217 (e.g. Stripe's ISK/UGX two-decimal special cases, PayPal's
 * HUF/JPY/TWD no-decimal list) keep their own gateway-specific tables
 * and pass an explicit `exponent` or `exponentOverrides` into money helpers.
 * Provider differences are never collapsed into this ISO-only table.
 */

/**
 * ISO 4217 alphabetic currency code. Normalized to uppercase at parse time.
 */
export type CurrencyCode = string;

/**
 * Per-call or merchant-level minor-unit exponent overrides.
 * Keys should be ISO 4217 codes (case-insensitive lookup).
 * Values must be integers in 0–18 (same bound as `money()` / `Money.exponent`).
 */
export type CurrencyExponentOverrides = Readonly<Record<string, number>>;

/** Maximum supported minor-unit exponent (guards absurd override values). */
const MAX_EXPONENT = 18;

/**
 * ISO 4217 currencies with a minor-unit exponent of 0.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK", // ISO 4217 exponent 0 (Stripe may treat ISK specially — keep gateway tables separate)
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI", // Uruguay Peso en Unidades Indexadas (funds code) — ISO 4217 exponent 0
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  // MGA is ISO 4217 exponent 2 (not zero-decimal); do not list here
]);

/**
 * ISO 4217 currencies with a minor-unit exponent of 3.
 */
const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/**
 * ISO 4217 currencies with a minor-unit exponent of 4.
 */
const FOUR_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "CLF", // Unidad de Fomento (Chile funds code)
  "UYW", // Unidad previsional (Uruguay)
]);

/**
 * Known ISO 4217 alphabetic codes with minor-unit exponent 2 (default scale).
 * Used so typos like `JYP` (vs `JPY`) fail closed instead of silently scaling ×100.
 * Provider-specific / funds codes not listed here must pass `overrides` or
 * {@link GetCurrencyExponentOptions.allowUnknown}.
 */
const TWO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BMD", "BND", "BOB", "BOV", "BRL", "BSD",
  "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF", "CHW", "CNY",
  "COP", "COU", "CRC", "CUC", "CUP", "CVE", "CZK", "DKK", "DOP", "DZD",
  "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP",
  "GMD", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS",
  "INR", "IRR", "JMD", "KES", "KGS", "KHR", "KPW", "KYD", "KZT", "LAK", "LBP",
  "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP",
  "MRU", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN", "NAD", "NGN",
  "NIO", "NOK", "NPR", "NZD", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN",
  "QAR", "RON", "RSD", "RUB", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL",
  "THB", "TJS", "TMT", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "USD",
  "USN", "UYU", "UZS", "VED", "VES", "WST", "XAD", "XCD", "XCG", "YER", "ZAR", "ZMW",
  "ZWG", "ZWL",
  // Precious metals / units of account commonly accepted as 2-decimal in PSPs
  "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XDR", "XPD", "XPT", "XTS",
]);

/**
 * True when `currency` is a known ISO 4217 code in the SDK tables (0/2/3/4).
 * Does not consult overrides.
 */
export function isKnownCurrencyCode(currency: string): boolean {
  const code = normalizeCurrencyCode(currency);
  return (
    ZERO_DECIMAL_CURRENCIES.has(code) ||
    TWO_DECIMAL_CURRENCIES.has(code) ||
    THREE_DECIMAL_CURRENCIES.has(code) ||
    FOUR_DECIMAL_CURRENCIES.has(code)
  );
}

/**
 * Options for {@link getCurrencyExponent}.
 */
export type GetCurrencyExponentOptions = {
  /** Per-call / merchant exponent overrides (same as the legacy 2nd arg map). */
  overrides?: CurrencyExponentOverrides;
  /**
   * When true, unrecognized codes default to exponent 2 (legacy behavior).
   * Default **false** (MONEY-4 fail-closed) so typos like `JYP` throw.
   */
  allowUnknown?: boolean;
};

/**
 * Normalize a currency code: trim whitespace and uppercase.
 */
export function normalizeCurrencyCode(currency: string): string {
  if (typeof currency !== "string") {
    throw new InvalidRequestError("Currency code must be a string");
  }
  const normalized = currency.trim().toUpperCase();
  if (normalized.length === 0) {
    throw new InvalidRequestError("Currency code must not be empty");
  }
  return normalized;
}

/**
 * Look up an override by normalized code (keys matched case-insensitively).
 * Returns `undefined` when the currency is not present in the map.
 * Throws {@link InvalidRequestError} when the currency is present but the
 * value is not an integer in 0–18 (explicit invalid override is never ignored).
 */
function lookupOverride(
  overrides: CurrencyExponentOverrides,
  code: string,
): number | undefined {
  let found: number | undefined;
  let present = false;

  if (Object.prototype.hasOwnProperty.call(overrides, code)) {
    present = true;
    found = overrides[code];
  } else {
    for (const [key, value] of Object.entries(overrides)) {
      if (key.trim().toUpperCase() === code) {
        present = true;
        found = value;
        break;
      }
    }
  }

  if (!present) {
    return undefined;
  }

  if (typeof found !== "number" || !Number.isInteger(found) || found < 0) {
    throw new InvalidRequestError(
      `Invalid currency exponent override for ${code}: must be an integer >= 0`,
    );
  }
  if (found > MAX_EXPONENT) {
    throw new InvalidRequestError(
      `Invalid currency exponent override for ${code}: exceeds maximum supported (${MAX_EXPONENT})`,
    );
  }

  return found;
}

/**
 * Returns the minor-unit exponent for a currency code (case-insensitive).
 *
 * Lookup order:
 * 1. `overrides` when provided and the code is present (invalid values throw,
 *    including exponent > 18)
 * 2. ISO 4217 zero-decimal table → 0
 * 3. ISO 4217 three-decimal table → 3
 * 4. ISO 4217 four-decimal table → 4
 * 5. Known two-decimal ISO codes → 2
 * 6. Unknown codes → throw {@link InvalidRequestError} (MONEY-4 fail-closed),
 *    unless `allowUnknown: true` (then default 2)
 *
 * The second argument accepts either a legacy overrides map or
 * {@link GetCurrencyExponentOptions}.
 *
 * Provider-specific deviations (Stripe ISK/UGX, PayPal HUF/TWD, Paymob merchant
 * maps) must be supplied via `overrides` or an explicit `exponent` on money
 * helpers — they are intentionally not embedded here.
 */
export function getCurrencyExponent(
  currency: string,
  overridesOrOptions?: CurrencyExponentOverrides | GetCurrencyExponentOptions,
): number {
  const normalizedCurrency = normalizeCurrencyCode(currency);

  let overrides: CurrencyExponentOverrides | undefined;
  let allowUnknown = false;

  if (overridesOrOptions !== undefined) {
    if (
      typeof overridesOrOptions === "object" &&
      overridesOrOptions !== null &&
      ("overrides" in overridesOrOptions ||
        "allowUnknown" in overridesOrOptions)
    ) {
      // MONEY-3: options bag may mix `allowUnknown` with currency-code keys
      // (`{ OMR: 2, allowUnknown: true }`). Prefer explicit `overrides`, else
      // treat remaining non-option keys as the overrides map so scale is not
      // silently dropped.
      const opts = overridesOrOptions as GetCurrencyExponentOptions &
        Record<string, unknown>;
      allowUnknown = opts.allowUnknown === true;
      if (opts.overrides !== undefined) {
        overrides = opts.overrides;
      } else {
        const rest: Record<string, number> = {};
        let hasRest = false;
        for (const [key, value] of Object.entries(opts)) {
          if (key === "overrides" || key === "allowUnknown") {
            continue;
          }
          if (typeof value === "number") {
            rest[key] = value;
            hasRest = true;
          }
        }
        if (hasRest) {
          overrides = rest;
        }
      }
    } else {
      overrides = overridesOrOptions as CurrencyExponentOverrides;
    }
  }

  if (overrides !== undefined) {
    const override = lookupOverride(overrides, normalizedCurrency);
    if (override !== undefined) {
      return override;
    }
  }

  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 0;
  }
  if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 3;
  }
  if (FOUR_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 4;
  }
  if (TWO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 2;
  }

  if (allowUnknown) {
    return 2;
  }

  throw new InvalidRequestError(
    `Unknown currency code: ${normalizedCurrency}. ` +
      "Pass exponentOverrides / explicit exponent, or allowUnknown: true if intentional.",
  );
}
