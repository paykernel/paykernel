// file: packages/core/src/utils/money.ts

/**
 * Shared safe money primitives for major-unit decimal strings and bigint minor units.
 *
 * Financial conversion NEVER uses `amount * 100` (or any float multiply) for the
 * conversion result. Parsing is string/bigint based; JS `number` is accepted only
 * as a deprecated 0.x interop path and is stringified before conversion.
 *
 * Public {@link Money} is JSON-friendly `{ amount: string, currency: string }`.
 * {@link MinorAmount} (`bigint`) is for internal conversion and provider integer
 * boundaries only — not part of the public Money shape.
 */

import { InvalidRequestError } from "../errors";
import {
  getCurrencyExponent,
  normalizeCurrencyCode,
  type CurrencyExponentOverrides,
} from "./currency";

/**
 * Structured reason for money validation failures.
 * Gateways should branch on {@link MoneyAmountError.kind}, not English messages.
 */
export type MoneyFailureKind =
  | "excess_precision"
  | "invalid_format"
  | "zero"
  | "negative"
  | "unsafe_range"
  | "currency_mismatch"
  | "invalid_exponent"
  | "other";

/**
 * Amount conversion / parse failure with a stable {@link MoneyFailureKind}.
 * Extends {@link InvalidRequestError} so existing `instanceof` checks still work.
 */
export class MoneyAmountError extends InvalidRequestError {
  readonly kind: MoneyFailureKind;

  constructor(message: string, kind: MoneyFailureKind) {
    super(message);
    this.name = "MoneyAmountError";
    this.kind = kind;
  }
}

/** Validated decimal representation, e.g. `"10.50"`, `"100"`, `"-1.250"`. */
export type DecimalString = string;

/** Integer minor-unit amount (e.g. cents, fils). Internal conversion type. */
export type MinorAmount = bigint;

/**
 * JSON-serializable major-unit money value.
 * `amount` is a clean decimal string (no scientific notation).
 *
 * When built with a non-ISO exponent (`exponent` / `exponentOverrides` that
 * differ from bare {@link getCurrencyExponent}), {@link exponent} is stored so
 * {@link toMinorUnits} can re-resolve without silently using the ISO default
 * (MONEY-1 — OMR/MGA-class profile overrides).
 */
export type Money<TCurrency extends string = string> = {
  readonly amount: DecimalString;
  readonly currency: TCurrency;
  /**
   * Resolved minor-unit exponent used to canonicalize `amount`.
   * Present only when the scale differs from bare ISO lookup for `currency`.
   */
  readonly exponent?: number;
};

/**
 * Rounding applied when an amount has more fractional digits than the currency exponent.
 * Default is `'reject'` — excess precision throws rather than silently rounding.
 */
export type MoneyRoundingMode =
  | "reject"
  | "half_up"
  | "half_even"
  | "floor"
  | "ceil"
  | "trunc";

export type MoneyParseOptions = {
  /** Default `'reject'`. */
  rounding?: MoneyRoundingMode;
  /** Provider/merchant exponent overrides (merged via {@link getCurrencyExponent}). */
  exponentOverrides?: CurrencyExponentOverrides;
  /** When set, use this exponent instead of ISO/override lookup. */
  exponent?: number;
  /** Default `false` for payment charges; set `true` for marketplace reverse splits. */
  allowNegative?: boolean;
  /** Default `false` for charges; set `true` where providers allow zero amounts. */
  allowZero?: boolean;
};

/** Maximum supported minor-unit exponent (guards absurd override values). */
const MAX_EXPONENT = 18;

type ParsedDecimal = {
  sign: 1n | -1n;
  /** Digits only, no sign; leading zeros stripped except bare `"0"`. */
  integerPart: string;
  /** Fractional digits only (may be empty). */
  fractionPart: string;
};

function throwInvalidAmount(
  message: string,
  kind: MoneyFailureKind = "other",
): never {
  throw new MoneyAmountError(message, kind);
}

function resolveExponent(
  currency: string,
  options?: MoneyParseOptions,
): number {
  if (options?.exponent !== undefined) {
    const exp = options.exponent;
    if (typeof exp !== "number" || !Number.isInteger(exp) || exp < 0) {
      throwInvalidAmount(
        `Invalid currency exponent: must be an integer >= 0 (got ${String(exp)})`,
        "invalid_exponent",
      );
    }
    if (exp > MAX_EXPONENT) {
      throwInvalidAmount(
        `Currency exponent ${exp} exceeds maximum supported (${MAX_EXPONENT})`,
        "invalid_exponent",
      );
    }
    return exp;
  }
  const exp = getCurrencyExponent(currency, options?.exponentOverrides);
  if (exp > MAX_EXPONENT) {
    throwInvalidAmount(
      `Currency exponent ${exp} exceeds maximum supported (${MAX_EXPONENT})`,
      "invalid_exponent",
    );
  }
  return exp;
}

/**
 * Parse a decimal string into sign / integer / fraction parts.
 * Rejects empty input, scientific notation, leading `+`, bare `"."` / `".5"`,
 * trailing `"."`, and non-digit junk.
 */
function parseDecimalString(value: string): ParsedDecimal {
  if (typeof value !== "string") {
    throwInvalidAmount("Amount must be a decimal string", "invalid_format");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throwInvalidAmount("Amount must not be empty", "invalid_format");
  }

  // Reject scientific notation, explicit '+', and non-decimal tokens early.
  if (/[eE]/.test(trimmed)) {
    throwInvalidAmount(
      `Invalid amount format (scientific notation is not allowed): ${trimmed}`,
      "invalid_format",
    );
  }
  if (trimmed.includes("+")) {
    throwInvalidAmount(
      `Invalid amount format (leading '+' is not allowed): ${trimmed}`,
      "invalid_format",
    );
  }
  if (/^nan$/i.test(trimmed) || /^[-]?infinity$/i.test(trimmed)) {
    throwInvalidAmount(`Invalid amount format: ${trimmed}`, "invalid_format");
  }

  // Optional leading '-', integer digits required, optional '.' + fraction digits.
  // Rejects ".5", "10.", "", "abc", "++1".
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throwInvalidAmount(`Invalid amount format: ${trimmed}`, "invalid_format");
  }

  const sign: 1n | -1n = match[1] === "-" ? -1n : 1n;
  let integerPart = match[2]!;
  const fractionPart = match[3] ?? "";

  // Strip leading zeros on the integer part ("007" → "7", "00" → "0").
  integerPart = integerPart.replace(/^0+(?=\d)/, "");

  // Canonical zero is non-negative (treat "-0" / "-0.00" as positive zero).
  if (integerPart === "0" && /^0*$/.test(fractionPart)) {
    return { sign: 1n, integerPart: "0", fractionPart };
  }

  return { sign, integerPart, fractionPart };
}

/**
 * Expand a finite JS number into a decimal string without using float multiply
 * for money conversion. Integer path uses `String`; non-integers use `String(n)`
 * and reject scientific notation (callers should prefer string amounts).
 *
 * Clean decimals like `10.5` / `99.99` stringify cleanly. Float noise such as
 * `0.1 + 0.2` becomes `"0.30000000000000004"` and fails default `reject` at
 * currency precision — intentional for the deprecated number path.
 */
function numberToDecimalString(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throwInvalidAmount("Amount number must be a finite number", "invalid_format");
  }

  // Normalize -0 to 0 for payment amounts.
  if (Object.is(n, -0) || n === 0) {
    return "0";
  }

  if (Number.isInteger(n)) {
    if (!Number.isSafeInteger(n)) {
      throwInvalidAmount(
        "Amount number is outside the safe integer range; pass a decimal string instead",
        "unsafe_range",
      );
    }
    return String(n);
  }

  // Magnitude check: non-integer numbers beyond the safe integer range cannot
  // represent minor units reliably.
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
    throwInvalidAmount(
      "Amount number magnitude is too large; pass a decimal string instead",
      "unsafe_range",
    );
  }

  const s = String(n);
  if (/[eE]/.test(s)) {
    // Extremely large/small non-integers — require explicit decimal strings.
    throwInvalidAmount(
      "Amount number stringifies with scientific notation; pass a decimal string instead",
      "invalid_format",
    );
  }
  return s;
}

/**
 * Convert a parsed decimal + excess-digit remainder into a signed minor bigint,
 * applying the requested rounding mode. Never uses float arithmetic.
 */
function scaleToMinor(
  parsed: ParsedDecimal,
  exponent: number,
  rounding: MoneyRoundingMode,
): MinorAmount {
  const { sign, integerPart, fractionPart } = parsed;

  if (fractionPart.length <= exponent) {
    const padded = fractionPart.padEnd(exponent, "0");
    const digits = (integerPart + padded).replace(/^0+(?=\d)/, "") || "0";
    const abs = BigInt(digits);
    return sign * abs;
  }

  // Excess fractional digits beyond currency exponent.
  if (rounding === "reject") {
    throwInvalidAmount(
      `Amount has more decimal places than the currency supports (maximum ${exponent})`,
      "excess_precision",
    );
  }

  const kept = fractionPart.slice(0, exponent);
  const rest = fractionPart.slice(exponent);
  const firstRestDigit = rest.charCodeAt(0) - 48; // '0' = 48
  const restHasNonZero = rest.slice(1).split("").some((d) => d !== "0");
  const anyRemainder = firstRestDigit !== 0 || restHasNonZero;

  const baseDigits =
    (integerPart + kept.padEnd(exponent, "0")).replace(/^0+(?=\d)/, "") || "0";
  let abs = BigInt(baseDigits);

  const roundUp = ((): boolean => {
    switch (rounding) {
      case "trunc":
        return false;
      case "floor":
        // Toward −∞: increase absolute value when negative and remainder exists.
        return sign === -1n && anyRemainder;
      case "ceil":
        // Toward +∞: increase absolute value when positive and remainder exists.
        return sign === 1n && anyRemainder;
      case "half_up":
        return firstRestDigit >= 5;
      case "half_even": {
        if (firstRestDigit > 5) return true;
        if (firstRestDigit < 5) return false;
        // Exactly .5 if no further non-zero digits; otherwise > half → up.
        if (restHasNonZero) return true;
        // Banker's: round to even on the last kept digit.
        const lastKeptChar =
          kept.length > 0
            ? kept.charAt(kept.length - 1)
            : integerPart.charAt(integerPart.length - 1) || "0";
        const lastKept = lastKeptChar.charCodeAt(0) - 48;
        return lastKept % 2 !== 0;
      }
      default: {
        const _exhaustive: never = rounding;
        throwInvalidAmount(
          `Unknown rounding mode: ${String(_exhaustive)}`,
          "other",
        );
      }
    }
  })();

  if (roundUp) {
    abs += 1n;
  }

  return sign * abs;
}

/**
 * Format a signed minor-unit bigint as a canonical major-unit decimal string
 * with exactly `exponent` fractional digits (or no decimal point when exponent is 0).
 */
function formatMinorAsDecimal(
  minor: MinorAmount,
  exponent: number,
): DecimalString {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  if (exponent === 0) {
    return (negative ? "-" : "") + abs.toString();
  }

  const scale = 10n ** BigInt(exponent);
  const intPart = abs / scale;
  const fracPart = abs % scale;
  const fracStr = fracPart.toString().padStart(exponent, "0");
  return (negative ? "-" : "") + intPart.toString() + "." + fracStr;
}

function assertSignAndZero(
  minor: MinorAmount,
  options: MoneyParseOptions | undefined,
  currency: string,
): void {
  const allowNegative = options?.allowNegative === true;
  const allowZero = options?.allowZero === true;

  if (minor === 0n && !allowZero) {
    throwInvalidAmount(
      `Amount for ${currency} must be non-zero (allowZero is false)`,
      "zero",
    );
  }
  if (minor < 0n && !allowNegative) {
    throwInvalidAmount(
      `Amount for ${currency} must not be negative (allowNegative is false)`,
      "negative",
    );
  }
}

function decimalStringToMinor(
  amountStr: string,
  currency: string,
  options?: MoneyParseOptions,
): { minor: MinorAmount; exponent: number; currency: string } {
  const code = normalizeCurrencyCode(currency);
  const exponent = resolveExponent(code, options);
  const rounding: MoneyRoundingMode = options?.rounding ?? "reject";
  const parsed = parseDecimalString(amountStr);
  const minor = scaleToMinor(parsed, exponent, rounding);
  assertSignAndZero(minor, options, code);
  return { minor, exponent, currency: code };
}

/**
 * Build a frozen {@link Money}, attaching `exponent` when the resolved scale
 * differs from bare ISO lookup so later `toMinorUnits(money)` re-resolves
 * correctly without re-passing overrides (MONEY-1).
 */
function freezeMoney(
  amount: DecimalString,
  currency: string,
  resolvedExponent: number,
): Money {
  // Bare ISO default (no overrides). Unknown codes throw — treat as non-ISO so
  // Money.exponent is stored when the caller supplied an explicit scale.
  let isoDefault: number | undefined;
  try {
    isoDefault = getCurrencyExponent(currency);
  } catch (err) {
    if (!(err instanceof InvalidRequestError)) {
      throw err;
    }
    isoDefault = undefined;
  }

  if (isoDefault !== undefined && resolvedExponent === isoDefault) {
    return Object.freeze({ amount, currency });
  }
  return Object.freeze({ amount, currency, exponent: resolvedExponent });
}

/**
 * True when `overrides` names `currency` (case-insensitive key match).
 * Used so empty/unrelated maps do not suppress stored {@link Money.exponent}.
 */
function overrideMapHasCurrency(
  overrides: CurrencyExponentOverrides,
  currency: string,
): boolean {
  let code: string;
  try {
    code = normalizeCurrencyCode(currency);
  } catch {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, code)) {
    return true;
  }
  for (const key of Object.keys(overrides)) {
    if (key.trim().toUpperCase() === code) {
      return true;
    }
  }
  return false;
}

/**
 * When converting a {@link Money} value, prefer explicit parse options; else
 * re-use a stored non-ISO {@link Money.exponent} so override-built values do
 * not silently re-scale under ISO defaults.
 *
 * **MONEY-1:** Presence of `exponentOverrides` alone must not drop
 * `Money.exponent`. Only an explicit `options.exponent` or an override entry
 * for this currency suppresses the stored scale. Empty `{}` or maps for other
 * codes keep `m.exponent` so `toMinorUnits(m, { exponentOverrides: {} })`
 * cannot 10×/100× MGA/OMR-class values.
 */
function resolveMoneyParseOptions(
  m: Money,
  options?: MoneyParseOptions,
): MoneyParseOptions | undefined {
  // Explicit per-call exponent always wins over stored scale and maps.
  if (options?.exponent !== undefined) {
    return options;
  }

  const stored =
    typeof m.exponent === "number" &&
    Number.isInteger(m.exponent) &&
    m.exponent >= 0
      ? m.exponent
      : undefined;

  if (stored === undefined) {
    return options;
  }

  // Override map entry for this currency is intentional merchant/provider scale.
  if (
    options?.exponentOverrides !== undefined &&
    overrideMapHasCurrency(options.exponentOverrides, m.currency)
  ) {
    return options;
  }

  // Pin stored scale (including when overrides is {} or for other currencies).
  return options !== undefined
    ? { ...options, exponent: stored }
    : { exponent: stored };
}

/**
 * Create a {@link Money} value from a major-unit amount.
 *
 * Prefer **string** inputs (`money("10.50", "SAR")`). `number` is accepted for
 * 0.x compatibility but is deprecated — convert via a careful string path and
 * apply the same strict decimal rules (default rounding `'reject'`).
 *
 * Canonical `amount` is minor-aligned: exactly `exponent` fractional digits
 * (e.g. `"10.50"` for SAR), or no decimal point for zero-decimal currencies.
 *
 * When `options.exponent` / `exponentOverrides` resolve a non-ISO scale, the
 * result stores {@link Money.exponent} so {@link toMinorUnits} round-trips
 * without re-passing overrides.
 */
export function money(
  amount: string | number | DecimalString,
  currency: string,
  options?: MoneyParseOptions,
): Money {
  const amountStr =
    typeof amount === "number" ? numberToDecimalString(amount) : amount;

  if (typeof amountStr !== "string") {
    throwInvalidAmount("Amount must be a string or number", "invalid_format");
  }

  const { minor, exponent, currency: code } = decimalStringToMinor(
    amountStr,
    currency,
    options,
  );

  const canonical = formatMinorAsDecimal(minor, exponent);
  return freezeMoney(canonical, code, exponent);
}

/**
 * Type guard for a Money-shaped value (`amount` + `currency` strings with a
 * well-formed decimal amount). Does not enforce currency-scale precision.
 */
export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as { amount?: unknown; currency?: unknown };
  if (typeof rec.amount !== "string" || typeof rec.currency !== "string") {
    return false;
  }
  try {
    parseDecimalString(rec.amount);
    // Currency non-empty after trim (normalize would throw on empty).
    if (rec.currency.trim().length === 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-validate an unknown value as {@link Money} with optional parse options.
 * Stored {@link Money.exponent} is re-applied when options omit scale.
 */
export function validateMoney(
  value: unknown,
  options?: MoneyParseOptions,
): Money {
  if (!isMoney(value)) {
    throwInvalidAmount("Value is not a valid Money object", "invalid_format");
  }
  return money(value.amount, value.currency, resolveMoneyParseOptions(value, options));
}

/**
 * Convert major units to integer minor units as `bigint`.
 *
 * Overloads:
 * - `toMinorUnits(money, options?)`
 * - `toMinorUnits(amount, currency, options?)`
 *
 * ALWAYS returns `bigint`. NEVER uses float multiply for the conversion path.
 */
export function toMinorUnits(
  amount: Money,
  options?: MoneyParseOptions,
): MinorAmount;
export function toMinorUnits(
  amount: string | number,
  currency: string,
  options?: MoneyParseOptions,
): MinorAmount;
export function toMinorUnits(
  amount: string | number | Money,
  currencyOrOptions?: string | MoneyParseOptions,
  options?: MoneyParseOptions,
): MinorAmount {
  if (isMoney(amount)) {
    const opts =
      typeof currencyOrOptions === "object" && currencyOrOptions !== null
        ? currencyOrOptions
        : options;
    return decimalStringToMinor(
      amount.amount,
      amount.currency,
      resolveMoneyParseOptions(amount, opts),
    ).minor;
  }

  if (typeof currencyOrOptions !== "string") {
    throwInvalidAmount(
      "Currency is required when converting a string or number amount",
      "invalid_format",
    );
  }

  const amountStr =
    typeof amount === "number" ? numberToDecimalString(amount) : amount;
  return decimalStringToMinor(amountStr, currencyOrOptions, options).minor;
}

/**
 * Convert integer minor units to a canonical {@link Money} value (bigint math only).
 */
export function fromMinorUnits(
  minor: MinorAmount | number | bigint,
  currency: string,
  options?: MoneyParseOptions,
): Money {
  let minorBi: bigint;
  if (typeof minor === "bigint") {
    minorBi = minor;
  } else if (typeof minor === "number") {
    if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
      throwInvalidAmount(
        "Minor unit number must be a finite integer",
        "invalid_format",
      );
    }
    if (!Number.isSafeInteger(minor)) {
      throwInvalidAmount(
        "Minor unit number is outside the safe integer range; pass a bigint instead",
        "unsafe_range",
      );
    }
    minorBi = BigInt(minor);
  } else {
    throwInvalidAmount(
      "Minor amount must be a bigint or safe integer number",
      "invalid_format",
    );
  }

  const code = normalizeCurrencyCode(currency);
  const exponent = resolveExponent(code, options);
  assertSignAndZero(minorBi, options, code);

  const amount = formatMinorAsDecimal(minorBi, exponent);
  return freezeMoney(amount, code, exponent);
}

/**
 * Simple display form: `"{amount} {currency}"` (e.g. `"10.50 SAR"`).
 * Not locale-aware (deliberately — no Intl coupling).
 */
export function formatMoney(m: Money): string {
  if (!isMoney(m)) {
    throwInvalidAmount("formatMoney requires a Money value", "invalid_format");
  }
  return `${m.amount} ${m.currency}`;
}

/**
 * Convert a minor-unit bigint to a JS number **only when** it fits in
 * `Number.MAX_SAFE_INTEGER`. Used at provider API boundaries that require a
 * JSON number (e.g. Stripe integer cents). Throws when unsafe.
 */
export function minorAmountToNumber(minor: MinorAmount): number {
  if (typeof minor !== "bigint") {
    throwInvalidAmount(
      "minorAmountToNumber requires a bigint",
      "invalid_format",
    );
  }
  if (
    minor > BigInt(Number.MAX_SAFE_INTEGER) ||
    minor < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throwInvalidAmount(
      "Minor amount exceeds Number.MAX_SAFE_INTEGER and cannot be converted to number safely",
      "unsafe_range",
    );
  }
  return Number(minor);
}

/**
 * 0.x interop: major-unit JS number from Money for legacy result fields.
 *
 * **Float risk:** the returned `number` is only for display/legacy shapes.
 * Prefer keeping {@link Money} / minor `bigint` for financial logic.
 * Throws when the magnitude is outside the safe integer range of the
 * major-unit integer component.
 */
export function moneyToMajorNumber(
  m: Money,
  options?: MoneyParseOptions,
): number {
  if (!isMoney(m)) {
    throwInvalidAmount(
      "moneyToMajorNumber requires a Money value",
      "invalid_format",
    );
  }
  // Re-validate scale / options (e.g. overrides) via conversion.
  // Money.exponent is honored when options omit scale (MONEY-1).
  const parseOpts = resolveMoneyParseOptions(m, options);
  const minor = toMinorUnits(m, parseOpts);

  // MONEY-4: minor units must fit IEEE safe integers so major-unit `number`
  // interop cannot silently lose low-order digits on large fractional majors.
  if (
    minor > BigInt(Number.MAX_SAFE_INTEGER) ||
    minor < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throwInvalidAmount(
      "Money minor-unit magnitude exceeds Number.MAX_SAFE_INTEGER (major number would be IEEE-inexact)",
      "unsafe_range",
    );
  }

  const n = Number(m.amount);
  if (!Number.isFinite(n)) {
    throwInvalidAmount(
      "Cannot convert Money amount to a finite number",
      "unsafe_range",
    );
  }

  // Integer major component safety.
  const abs = Math.abs(n);
  if (abs > Number.MAX_SAFE_INTEGER) {
    throwInvalidAmount(
      "Money major-unit magnitude exceeds Number.MAX_SAFE_INTEGER",
      "unsafe_range",
    );
  }

  // Round-trip: IEEE major re-parsed under the same scale must yield the same
  // minor units. Catches large fractional majors that pass magnitude checks
  // but are not exactly representable as a JS number (MONEY-4).
  // money() / toMinorUnits may throw MoneyAmountError — let it propagate.
  const roundTrip = money(n, m.currency, {
    ...(parseOpts ?? {}),
    allowZero: true,
    allowNegative: true,
  });
  if (toMinorUnits(roundTrip, parseOpts) !== minor) {
    throwInvalidAmount(
      "Money major-unit number is IEEE-inexact for this amount/scale",
      "unsafe_range",
    );
  }

  return n;
}

/**
 * Normalize a 0.x {@link AmountInput}-shaped value (`number | Money`) to Money.
 *
 * - `number` → deprecated path via {@link money}
 * - `Money` → re-validated; currency must match `currency` (case-insensitive)
 *
 * Stream B gateways should call this at mutation boundaries before `toMinorUnits`.
 */
export function normalizeAmountInput(
  input: number | Money,
  currency: string,
  options?: MoneyParseOptions,
): Money {
  const code = normalizeCurrencyCode(currency);

  if (isMoney(input)) {
    const inputCode = normalizeCurrencyCode(input.currency);
    if (inputCode !== code) {
      throwInvalidAmount(
        `Money currency ${inputCode} does not match expected currency ${code}`,
        "currency_mismatch",
      );
    }
    return money(
      input.amount,
      code,
      resolveMoneyParseOptions(input, options),
    );
  }

  if (typeof input === "number") {
    return money(input, code, options);
  }

  throwInvalidAmount(
    "Amount must be a number or Money object",
    "invalid_format",
  );
}
