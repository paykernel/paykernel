/**
 * Pure snapshot compare → machine-readable ReconciliationDifference[].
 */

import {
  MoneyAmountError,
  normalizeCurrencyCode,
  toMinorUnits,
  type Money,
} from "@paykernel/core";
import type {
  LocalPaymentSnapshot,
  ProviderPaymentSnapshot,
  ReconciliationDifference,
} from "./types";

/**
 * Parse options for numeric money equality: zero refunds and marketplace
 * reverse splits must still compare; excess precision stays reject (fail-closed).
 */
const MONEY_EQ_PARSE = {
  allowZero: true,
  allowNegative: true,
} as const;

/**
 * Normalize currency for equality (ISO alphabetic codes are case-insensitive).
 * Empty/invalid codes fall back to trimmed uppercase so equality stays defined.
 */
function currencyCodesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return normalizeCurrencyCode(a) === normalizeCurrencyCode(b);
  } catch {
    // Fail-closed on empty/invalid: still allow exact trim/upper match.
    return a.trim().toUpperCase() === b.trim().toUpperCase() && a.trim() !== "";
  }
}

/**
 * Money equality for reconciliation drift detection.
 *
 * - **Currency** codes compare case-insensitively (ISO 4217 alphabetic).
 * - **Amounts** compare by currency-scale minor units (`bigint` via core
 *   `toMinorUnits`), so equivalent decimal spellings match
 *   (`"10"` ≡ `"10.00"` for USD; `"1.25"` ≡ `"1.250"` for KWD).
 * - Unparseable / excess-precision amounts are not equal (unless amount
 *   strings are identical).
 *
 * Never uses float multiply or `Number` compare.
 */
export function moneyEquals(a: Money, b: Money): boolean {
  if (!currencyCodesEqual(a.currency, b.currency)) {
    return false;
  }
  if (a.amount === b.amount) {
    return true;
  }
  try {
    // Use normalized currency for exponent lookup so "usd"/"USD" share scale.
    const currency = normalizeCurrencyCode(a.currency);
    return (
      toMinorUnits(a.amount, currency, MONEY_EQ_PARSE) ===
      toMinorUnits(b.amount, currency, MONEY_EQ_PARSE)
    );
  } catch (err) {
    // Fail-closed: invalid/excess-precision amounts are not equal.
    // Re-throw unexpected errors (not amount parse failures).
    if (err instanceof MoneyAmountError) {
      return false;
    }
    throw err;
  }
}

/**
 * Compare local expected snapshot fields present on local against provider.
 * Empty differences → consistent path.
 *
 * Only fields present on `local` are compared (partial local knowledge).
 * Amount fields use {@link moneyEquals} (minor-unit numeric equality +
 * case-insensitive currency codes).
 */
export function compareSnapshots(
  local: LocalPaymentSnapshot | undefined,
  provider: ProviderPaymentSnapshot,
): ReconciliationDifference[] {
  if (!local) return [];

  const diffs: ReconciliationDifference[] = [];

  if (local.status !== undefined && local.status !== provider.status) {
    const d: ReconciliationDifference = {
      field: "status",
      local: local.status,
      provider: provider.status,
      message: `status local=${local.status} provider=${provider.status}`,
    };
    diffs.push(d);
  }

  if (local.amount !== undefined) {
    if (!moneyEquals(local.amount, provider.amount)) {
      const d: ReconciliationDifference = {
        field: "amount",
        local: local.amount,
        provider: provider.amount,
        message: "amount mismatch",
      };
      diffs.push(d);
    }
  }

  if (local.capturedAmount !== undefined) {
    const pCap = provider.capturedAmount;
    if (pCap === undefined || !moneyEquals(local.capturedAmount, pCap)) {
      const d: ReconciliationDifference = {
        field: "capturedAmount",
        local: local.capturedAmount,
        message: "capturedAmount mismatch",
      };
      if (pCap !== undefined) d.provider = pCap;
      diffs.push(d);
    }
  }

  if (local.refundedAmount !== undefined) {
    const pRef = provider.refundedAmount;
    if (pRef === undefined || !moneyEquals(local.refundedAmount, pRef)) {
      const d: ReconciliationDifference = {
        field: "refundedAmount",
        local: local.refundedAmount,
        message: "refundedAmount mismatch",
      };
      if (pRef !== undefined) d.provider = pRef;
      diffs.push(d);
    }
  }

  if (
    local.gatewayPaymentId !== undefined &&
    local.gatewayPaymentId !== provider.gatewayPaymentId
  ) {
    const d: ReconciliationDifference = {
      field: "gatewayPaymentId",
      local: local.gatewayPaymentId,
      provider: provider.gatewayPaymentId,
      message: "gatewayPaymentId mismatch",
    };
    diffs.push(d);
  }

  return diffs;
}

/** Alias preferred in public API. */
export const comparePaymentSnapshots = compareSnapshots;
