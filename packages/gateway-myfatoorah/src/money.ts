import {
  InvalidRequestError,
  MoneyAmountError,
  money,
  moneyToMajorNumber,
  normalizeAmountInput,
  type AmountInput,
  type Money,
} from "@paykernel/core";

const PARSE_OPTS = {
  rounding: "reject" as const,
  allowZero: true,
  allowNegative: false,
};

/**
 * ISO-padded major decimal string for MyFatoorah JSON number tokens.
 * SAR `1` → `1.00`; KWD `1.2` → `1.200`. Never float-multiplies.
 */
export function formatMyFatoorahIsoAmount(amount: AmountInput, currency: string): string {
  return toMyFatoorahMoney(amount, currency).amount;
}

/** JSON-number major units for MyFatoorah request bodies (IEEE-safe round-trip). */
export function myFatoorahMajorNumber(amount: AmountInput, currency: string): number {
  const m = toMyFatoorahMoney(amount, currency);
  try {
    return moneyToMajorNumber(m, PARSE_OPTS);
  } catch (error) {
    if (error instanceof MoneyAmountError && error.kind === "unsafe_range") {
      throw new InvalidRequestError(
        `MyFatoorah amount for ${currency.toUpperCase()} is too large to represent safely as a JSON number`,
      );
    }
    throw error;
  }
}

export function parseMyFatoorahAmount(amount: unknown, currency: string): Money {
  if (typeof amount === "number" || typeof amount === "string") {
    return money(amount, currency, PARSE_OPTS);
  }
  throw new InvalidRequestError("MyFatoorah amount must be a number or decimal string");
}

function toMyFatoorahMoney(amount: AmountInput, currency: string): Money {
  return normalizeAmountInput(amount, currency, PARSE_OPTS);
}

const MYFATOORAH_JSON_AMOUNT_PLACEHOLDER = "__paykernel_myfatoorah_iso_amount__";
const MYFATOORAH_JSON_NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function padMyFatoorahAmountToken(amount: number, currency: string): string {
  const padded = formatMyFatoorahIsoAmount(amount, currency);
  if (!MYFATOORAH_JSON_NUMBER_TOKEN.test(padded)) {
    throw new InvalidRequestError(
      `MyFatoorah amount for ${currency.toUpperCase()} is not a JSON number token`,
    );
  }
  if (padded.startsWith("-")) {
    throw new InvalidRequestError(
      `MyFatoorah amount for ${currency.toUpperCase()} must be greater than 0`,
    );
  }
  return padded;
}

/**
 * JSON body for MyFatoorah requests. Amounts are ISO-padded JSON **number**
 * tokens (`10.50` / `1.200`), never strings:
 *
 * - nested `Order.Amount` padded with `Order.Currency` (V3 create)
 * - top-level `Amount` padded with the explicit `currency` argument (MakeRefund)
 *
 * Other fields use `JSON.stringify`. Bodies without a numeric amount are
 * stringified unchanged.
 */
export function stringifyMyFatoorahJsonBody(
  body: Record<string, unknown>,
  currency?: string,
): string {
  const patches: Array<{ placeholder: string; padded: string }> = [];
  let orderOverride: Record<string, unknown> | undefined;

  const order = body.Order;
  if (order !== null && typeof order === "object" && !Array.isArray(order)) {
    const orderRec = order as Record<string, unknown>;
    const orderAmount = orderRec.Amount;
    const orderCurrency = orderRec.Currency;
    if (typeof orderAmount === "number") {
      if (typeof orderCurrency !== "string" || orderCurrency.trim().length === 0) {
        throw new InvalidRequestError("MyFatoorah Order.Amount requires Order.Currency");
      }
      const padded = padMyFatoorahAmountToken(orderAmount, orderCurrency);
      const placeholder = `${MYFATOORAH_JSON_AMOUNT_PLACEHOLDER}${patches.length}`;
      patches.push({ placeholder, padded });
      orderOverride = { ...orderRec, Amount: placeholder };
    }
  }

  let topAmountPlaceholder: string | undefined;
  if (typeof body.Amount === "number") {
    if (typeof currency !== "string" || currency.trim().length === 0) {
      throw new InvalidRequestError(
        "MyFatoorah top-level Amount requires a currency for ISO padding",
      );
    }
    const padded = padMyFatoorahAmountToken(body.Amount, currency);
    const placeholder = `${MYFATOORAH_JSON_AMOUNT_PLACEHOLDER}${patches.length}`;
    patches.push({ placeholder, padded });
    topAmountPlaceholder = placeholder;
  }

  if (patches.length === 0) return JSON.stringify(body);

  const withPlaceholders: Record<string, unknown> = { ...body };
  if (orderOverride !== undefined) withPlaceholders.Order = orderOverride;
  if (topAmountPlaceholder !== undefined) {
    withPlaceholders.Amount = topAmountPlaceholder;
  }
  let serialized = JSON.stringify(withPlaceholders);
  for (const patch of patches) {
    serialized = serialized.split(`"Amount":"${patch.placeholder}"`).join(`"Amount":${patch.padded}`);
  }
  return serialized;
}
