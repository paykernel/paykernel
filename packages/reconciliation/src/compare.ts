/**
 * Pure snapshot compare → machine-readable ReconciliationDifference[].
 */

import type { Money } from "@paykernel/core";
import type {
  LocalPaymentSnapshot,
  ProviderPaymentSnapshot,
  ReconciliationDifference,
} from "./types";

/** Money equality: amount string + currency, case-sensitive. */
export function moneyEquals(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

/**
 * Compare local expected snapshot fields present on local against provider.
 * Empty differences → consistent path.
 *
 * Only fields present on `local` are compared (partial local knowledge).
 * Amount fields compare Money amount+currency strings.
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
