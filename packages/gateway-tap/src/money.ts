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
 * ISO-padded major decimal string for Tap hashstring and JSON number tokens.
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

const TAP_JSON_AMOUNT_PLACEHOLDER = "__paykernel_tap_iso_amount__";
const TAP_JSON_NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * JSON body for Tap mutating requests. Top-level `amount` is an ISO-padded
 * JSON **number** token (`10.50` / `1.200`), not a string. Other fields use
 * `JSON.stringify`. Bodies without a numeric `amount` + string `currency` are
 * stringified unchanged.
 */
export function stringifyTapJsonBody(body: Record<string, unknown>): string {
  const amount = body.amount;
  const currency = body.currency;
  if (typeof amount !== "number" || typeof currency !== "string") {
    return JSON.stringify(body);
  }
  const padded = formatTapIsoAmount(amount, currency);
  if (!TAP_JSON_NUMBER_TOKEN.test(padded)) {
    throw new InvalidRequestError(
      `Tap amount for ${currency.toUpperCase()} is not a JSON number token`,
    );
  }
  const serialized = JSON.stringify({
    ...body,
    amount: TAP_JSON_AMOUNT_PLACEHOLDER,
  });
  const amountNeedle = `"amount":"${TAP_JSON_AMOUNT_PLACEHOLDER}"`;
  if (!serialized.includes(amountNeedle)) {
    throw new InvalidRequestError("Tap JSON amount could not be ISO-padded");
  }
  return serialized.replace(amountNeedle, `"amount":${padded}`);
}
