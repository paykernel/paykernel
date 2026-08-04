// file: packages/payments-sdk/src/utils/currency.ts

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
 * Values must be integers >= 0.
 */
export type CurrencyExponentOverrides = Readonly<Record<string, number>>;

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
 * value is not an integer >= 0 (explicit invalid override is never ignored).
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

  return found;
}

/**
 * Returns the minor-unit exponent for a currency code (case-insensitive).
 *
 * Lookup order:
 * 1. `overrides` when provided and the code is present (invalid values throw)
 * 2. ISO 4217 zero-decimal table → 0
 * 3. ISO 4217 three-decimal table → 3
 * 4. Default → 2
 *
 * Provider-specific deviations (Stripe ISK/UGX, PayPal HUF/TWD, Paymob merchant
 * maps) must be supplied via `overrides` or an explicit `exponent` on money
 * helpers — they are intentionally not embedded here.
 */
export function getCurrencyExponent(
  currency: string,
  overrides?: CurrencyExponentOverrides,
): number {
  const normalizedCurrency = normalizeCurrencyCode(currency);

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
  return 2;
}
