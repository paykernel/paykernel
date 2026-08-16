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
 * Auth-hold / pre-capture statuses (domain + Stripe `requires_capture`).
 * A present `capturedAmount=0` against `local.amount` is the hold, not drift.
 */
const AUTH_HOLD_STATUSES = new Set<string>([
  "authorized",
  "approved",
  "requires_capture",
]);

/**
 * In-flight settlement statuses. A present `capturedAmount=0` against
 * `local.amount` is "nothing captured yet", not money drift (NEW-RECON-1).
 */
const IN_FLIGHT_SETTLING_STATUSES = new Set<string>([
  "pending",
  "processing",
]);

function statusInSet(status: string | undefined, set: Set<string>): boolean {
  if (status === undefined) return false;
  return set.has(status) || set.has(status.trim().toLowerCase());
}

function isAuthHoldStatus(status: string | undefined): boolean {
  return statusInSet(status, AUTH_HOLD_STATUSES);
}

function isInFlightSettlingStatus(status: string | undefined): boolean {
  return statusInSet(status, IN_FLIGHT_SETTLING_STATUSES);
}

/**
 * True when the snapshot pair is an auth-hold (not paid / partial capture).
 * Local status omitted still counts when the provider side is the hold.
 */
function isAuthHoldPair(
  local: LocalPaymentSnapshot,
  provider: ProviderPaymentSnapshot,
): boolean {
  if (local.status !== undefined && !isAuthHoldStatus(local.status)) {
    return false;
  }
  return (
    isAuthHoldStatus(provider.status) ||
    isAuthHoldStatus(provider.providerStatus)
  );
}

/**
 * Provider still settling (`pending` / `processing`). Normalized status
 * wins — a paid-like snapshot is never treated as in-flight even if the
 * raw `providerStatus` string looks pending.
 */
function isInFlightSettlingProvider(provider: ProviderPaymentSnapshot): boolean {
  return isInFlightSettlingStatus(provider.status);
}

/**
 * Proven-zero money. Unparseable / incomplete snapshots are not zero
 * (fail-closed — caller must treat them as drift, not a hold).
 */
function moneyIsZero(m: Money): boolean {
  try {
    const currency = normalizeCurrencyCode(m.currency);
    return toMinorUnits(m.amount, currency, MONEY_EQ_PARSE) === 0n;
  } catch (err) {
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
 *
 * RECON-1: auth-hold (`authorized` / `approved` / `requires_capture`) with
 * `capturedAmount=0` vs `local.amount` is consistent, not money drift.
 * NEW-RECON-1: in-flight `pending` / `processing` + `capturedAmount=0` vs
 * `local.amount` is the same class (nothing captured yet; still settling).
 * RECON-2: non-zero provider capture while local omitted `capturedAmount` on
 * an auth-hold is incremental capture drift (even if capture equals amount).
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
  } else if (
    local.amount !== undefined &&
    provider.capturedAmount !== undefined
  ) {
    const authHold = isAuthHoldPair(local, provider);
    const inFlight = isInFlightSettlingProvider(provider);
    const capturedZero = moneyIsZero(provider.capturedAmount);
    // RECON-1: authorized / approved / requires_capture + captured 0 is a
    // hold against local.amount — not apply_drift_review money drift.
    // NEW-RECON-1: pending / processing + captured 0 is "nothing captured
    // yet" (still settling) — same class as the hold, not money drift.
    if (!((authHold || inFlight) && capturedZero)) {
      if (authHold) {
        // RECON-2: incremental capture while still on an auth-hold. Local
        // omitted capturedAmount (implied 0); do not compare to charge amount.
        diffs.push({
          field: "capturedAmount",
          local: { amount: "0", currency: provider.capturedAmount.currency },
          provider: provider.capturedAmount,
          message: "capturedAmount mismatch",
        });
      } else if (!moneyEquals(local.amount, provider.capturedAmount)) {
        // Paid-like / other: local omitted capturedAmount but quoted a charge
        // amount; a present provider capture that does not match is drift.
        diffs.push({
          field: "capturedAmount",
          local: local.amount,
          provider: provider.capturedAmount,
          message: "capturedAmount mismatch",
        });
      }
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
