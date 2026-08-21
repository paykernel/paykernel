import {
  InvalidRequestError,
  MoneyAmountError,
  moneyToMajorNumber,
  normalizeAmountInput,
  money,
  type AmountInput,
  type Money,
} from "@paykernel/core";

const PARSE_OPTS = {
  rounding: "reject" as const,
  allowZero: true,
  allowNegative: false,
};

/**
 * ISO-padded major decimal string for Tap JSON / hashstring.
 * SAR `1` → `1.00`; KWD `1.2` → `1.200`. Never float-multiplies.
 */
export function formatTapIsoAmount(
  amount: AmountInput,
  currency: string,
): string {
  return toTapMoney(amount, currency).amount;
}

/** JSON-number major units for Tap request bodies (IEEE-safe round-trip). */
export function tapMajorNumber(amount: AmountInput, currency: string): number {
  const m = toTapMoney(amount, currency);
  try {
    return moneyToMajorNumber(m, PARSE_OPTS);
  } catch (error) {
    if (error instanceof MoneyAmountError && error.kind === "unsafe_range") {
      throw new InvalidRequestError(
        `Tap amount for ${currency.toUpperCase()} is too large to represent safely as a JSON number`,
      );
    }
    throw error;
  }
}

export function parseTapAmount(amount: unknown, currency: string): Money {
  if (typeof amount === "number" || typeof amount === "string") {
    return money(amount, currency, PARSE_OPTS);
  }
  throw new InvalidRequestError("Tap amount must be a number or decimal string");
}

function toTapMoney(amount: AmountInput, currency: string): Money {
  return normalizeAmountInput(amount, currency, PARSE_OPTS);
}
