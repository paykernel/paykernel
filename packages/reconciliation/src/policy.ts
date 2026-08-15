/**
 * Decision-only reconciliation policy helpers (Phase 19.5).
 *
 * Policy functions return decisions only — NEVER mutate local payments,
 * NEVER call createPayment / capture / refund / void APIs.
 */

import {
  MoneyAmountError,
  isPaidLikePaymentStatus,
  normalizeCurrencyCode,
  toMinorUnits,
  type Money,
} from "@paykernel/core";
import { moneyEquals } from "./compare";
import type {
  LocalPaymentSnapshot,
  ProviderPaymentSnapshot,
  ReconciliationDifference,
  ReconciliationResult,
  ReconciliationTarget,
} from "./types";

/**
 * Application-facing policy decision. `safe: true` means the app MAY apply
 * the named local update after its own validation; this package never applies it.
 */
export type ReconciliationDecision =
  | {
      action: "update_local_to_paid";
      safe: true;
      provider: ProviderPaymentSnapshot;
    }
  | {
      action: "update_local_to_failed";
      safe: true;
      provider: ProviderPaymentSnapshot;
    }
  | {
      action: "mark_consistent";
      safe: true;
      provider: ProviderPaymentSnapshot;
    }
  | { action: "manual_review"; safe: false; reason: string }
  | { action: "retry_later"; safe: false; retryAfterMs?: number }
  | { action: "do_not_create_replacement"; safe: false; reason: string }
  | {
      action: "apply_drift_review";
      safe: false;
      differences: ReconciliationDifference[];
      provider: ProviderPaymentSnapshot;
    };

/** Statuses treated as pending / indeterminate for upgrade decisions. */
const INDETERMINATE_LOCAL_STATUSES = new Set<string>([
  "pending",
  "processing",
]);

/**
 * Auth-hold / partial-capture local statuses are **not** indeterminate and are
 * **never** a safe auto-upgrade to paid (capture amount / final_capture may
 * still be incomplete). Policy routes these to apply_drift_review.
 */
const AUTH_HOLD_LOCAL_STATUSES = new Set<string>([
  "authorized",
  "partially_captured",
]);

/**
 * Provider statuses that mean money may already exist, still needs capture /
 * fulfillment work, or funds left the merchant via refund/chargeback — never
 * treat sparse local + these as safe mark_consistent (false recovery completion).
 *
 * RECON-2: includes refund lifecycle (`refund_pending` / `refund_failed` /
 * `refund_completed` / `refunded`) and `setup_completed` so recovery cannot
 * complete as mark_consistent while money state is still incomplete or
 * setup-only (no capture settled).
 *
 * RECON-3: `pending` / `processing` remain in this set (forbid mark_consistent)
 * but policy routes them to `retry_later` (still settling) rather than
 * `manual_review` (ops park / dead-letter risk).
 */
const OPEN_INCOMPLETE_PROVIDER_STATUSES = new Set<string>([
  "authorized",
  "approved",
  "partially_captured",
  "processing",
  "pending",
  "partially_refunded",
  "refunded",
  "refund_pending",
  "refund_failed",
  "refund_completed",
  "setup_completed",
  "reversed",
]);

/**
 * RECON-3: provider still settling — consistent sparse/indeterminate local
 * should reschedule (`retry_later`), not dead-letter via `manual_review`.
 */
const IN_FLIGHT_SETTLING_PROVIDER_STATUSES = new Set<string>([
  "pending",
  "processing",
]);

/**
 * Local statuses where a second createPayment would risk duplicate money
 * movement (open auth/settlement, already settled/refunded, or chargeback).
 *
 * RECON-1: includes `refund_pending` / `refund_failed` / `refund_completed` so
 * shouldForbidReplacementCharge stays true while a refund is in flight, failed
 * (original charge may still hold funds), or completed under the alternate
 * lifecycle name (same risk class as `refunded`).
 */
const OPEN_MONEY_LOCAL_STATUSES = new Set<string>([
  "pending",
  "processing",
  "authorized",
  "approved",
  "partially_captured",
  "partially_refunded",
  "paid",
  "refunded",
  "refund_pending",
  "refund_failed",
  "refund_completed",
  "reversed",
  "setup_completed",
]);

/** Definitive provider failure statuses (not timeout / unknown). */
const DEFINITIVE_FAILED_STATUSES = new Set<string>([
  "failed",
  "cancelled",
  "canceled",
]);

function isIndeterminateLocal(
  local: LocalPaymentSnapshot | undefined,
): boolean {
  if (!local || local.status === undefined) return true;
  return INDETERMINATE_LOCAL_STATUSES.has(local.status);
}

function isAuthHoldLocal(local: LocalPaymentSnapshot | undefined): boolean {
  if (!local || local.status === undefined) return false;
  return AUTH_HOLD_LOCAL_STATUSES.has(local.status);
}

function isOpenIncompleteProvider(status: string): boolean {
  return OPEN_INCOMPLETE_PROVIDER_STATUSES.has(status);
}

function isInFlightSettlingProvider(status: string): boolean {
  return IN_FLIGHT_SETTLING_PROVIDER_STATUSES.has(status);
}

function isOpenMoneyLocal(local: LocalPaymentSnapshot | undefined): boolean {
  if (!local || local.status === undefined) return true;
  return OPEN_MONEY_LOCAL_STATUSES.has(local.status);
}

/**
 * RECON-1: refuse safe paid upgrade when the provider snapshot is not bound
 * to the target's known gatewayPaymentId (wrong-payment secondary-key hit).
 */
function identityBoundToTarget(
  target: ReconciliationTarget,
  provider: ProviderPaymentSnapshot,
): boolean {
  if (
    target.gatewayPaymentId !== undefined &&
    target.gatewayPaymentId !== "" &&
    target.gatewayPaymentId !== provider.gatewayPaymentId
  ) {
    return false;
  }
  // If expected already carries an identity, it must match too.
  const expectedId = target.expected?.gatewayPaymentId;
  if (
    expectedId !== undefined &&
    expectedId !== "" &&
    expectedId !== provider.gatewayPaymentId
  ) {
    return false;
  }
  return true;
}

/**
 * True when a Money total is present and non-zero (or unparseable).
 *
 * Fail-closed: missing totals → false (not proven moved). Present but
 * unparseable / excess-precision → true (treat as funds-moved risk).
 * Uses bigint minor units via core `toMinorUnits` (never float).
 */
function moneyIsNonZero(m: Money | undefined): boolean {
  if (m === undefined) return false;
  const amount = String(m.amount ?? "").trim();
  const currencyRaw = String(m.currency ?? "").trim();
  if (!amount || !currencyRaw) {
    // Incomplete money snapshot while field is present — fail-closed.
    return true;
  }
  try {
    const currency = normalizeCurrencyCode(currencyRaw);
    const minor = toMinorUnits(amount, currency, {
      allowZero: true,
      allowNegative: true,
    });
    return minor !== 0n;
  } catch (err) {
    if (err instanceof MoneyAmountError) {
      // Unparseable / excess precision — refuse safe status-only updates.
      return true;
    }
    throw err;
  }
}

/**
 * RECON-1: provider reported definitive failed/cancelled but money totals show
 * funds already moved (capture or refund). Status-only `update_local_to_failed`
 * would allow replacement create while provider holds/moved funds.
 */
function providerFailedWithMovedFunds(
  provider: ProviderPaymentSnapshot,
): boolean {
  if (!DEFINITIVE_FAILED_STATUSES.has(provider.status)) return false;
  return (
    moneyIsNonZero(provider.capturedAmount) ||
    moneyIsNonZero(provider.refundedAmount)
  );
}

/**
 * RECON-2: provider is paid-like but already shows non-zero refunds — safe
 * `update_local_to_paid` would under-report refunded state.
 */
function providerPaidWithRefunds(provider: ProviderPaymentSnapshot): boolean {
  if (!isPaidLikePaymentStatus(provider.status)) return false;
  return moneyIsNonZero(provider.refundedAmount);
}

/**
 * P19-CAPTURE: paid-like status with a *present* capturedAmount that is zero
 * while `amount` is non-zero, or not money-equal to `amount`.
 *
 * Missing `capturedAmount` stays allowed (many providers omit it). Present
 * but unparseable amounts fail closed via `moneyEquals` / `moneyIsNonZero`.
 */
function providerPaidWithCaptureMismatch(
  provider: ProviderPaymentSnapshot,
): boolean {
  if (!isPaidLikePaymentStatus(provider.status)) return false;
  if (provider.capturedAmount === undefined) return false;
  if (
    moneyIsNonZero(provider.amount) &&
    !moneyIsNonZero(provider.capturedAmount)
  ) {
    return true;
  }
  return !moneyEquals(provider.capturedAmount, provider.amount);
}

function maySafeUpgradeToPaid(
  target: ReconciliationTarget,
  provider: ProviderPaymentSnapshot,
): boolean {
  // RECON-4: never auto-upgrade auth holds / partial captures to paid.
  if (isAuthHoldLocal(target.expected)) return false;
  if (!identityBoundToTarget(target, provider)) return false;
  // RECON-2: non-zero refundedAmount is not a clean paid upgrade.
  if (providerPaidWithRefunds(provider)) return false;
  // P19-CAPTURE: present capturedAmount must match amount (zero vs non-zero
  // amount, or any other money inequality, is not a clean paid upgrade).
  if (providerPaidWithCaptureMismatch(provider)) return false;
  return true;
}

function maySafeUpdateToFailed(
  target: ReconciliationTarget,
  provider: ProviderPaymentSnapshot,
): boolean {
  if (!identityBoundToTarget(target, provider)) return false;
  // RECON-1: refuse status-only failed when capture/refund totals are non-zero.
  if (providerFailedWithMovedFunds(provider)) return false;
  return true;
}

/**
 * Decide what the application should do after a reconciliation result.
 *
 * Rules:
 * - consistent → mark_consistent (only when not sparse+open-provider incomplete,
 *   and not paid-like provider with non-zero refundedAmount — RECON-2,
 *   and not paid-like with present capturedAmount zero/≠ amount — P19-CAPTURE)
 * - drift_detected → apply_drift_review (never auto-mutate money totals)
 * - local pending/indeterminate + provider paid + identity-bound → update_local_to_paid
 *   (RECON-2: not when provider.refundedAmount is non-zero;
 *   P19-CAPTURE: not when present capturedAmount is zero vs non-zero amount
 *   or not money-equal to amount; omitted capturedAmount stays allowed)
 * - local pending/indeterminate + provider definitive failed + identity-bound →
 *   update_local_to_failed (RECON-1: not when capturedAmount/refundedAmount non-zero)
 * - sparse/indeterminate local + in-flight provider (`pending`/`processing`) →
 *   retry_later (RECON-3 — still settling; do not park/dead-letter)
 * - sparse/indeterminate local + other open incomplete provider (auth/approved/
 *   partial/refund lifecycle) → manual_review (never mark_consistent safe:true)
 * - local `authorized` / `partially_captured` → paid is **never** safe auto-upgrade
 *   (apply_drift_review) — capture totals / final_capture may still be incomplete
 * - gatewayPaymentId mismatch (target vs provider) → never safe paid/failed upgrade
 * - ambiguous_match → manual_review
 * - temporarily_unavailable → retry_later
 * - provider_not_found retryable → do_not_create_replacement (always; RECON-2)
 * - ALWAYS surface do_not_create_replacement for provider_not_found / ambiguous
 *   (action-only switches must not recreate; callers can still use
 *   {@link shouldForbidReplacementCharge}).
 */
export function decideReconciliationPolicy(
  result: ReconciliationResult,
  target: ReconciliationTarget,
): ReconciliationDecision {
  switch (result.outcome) {
    case "consistent": {
      // If local is indeterminate and provider is paid, prefer update_local_to_paid
      // even when expected matched (status may have been omitted from expected).
      const local = target.expected;
      if (
        isIndeterminateLocal(local) &&
        isPaidLikePaymentStatus(result.provider.status) &&
        maySafeUpgradeToPaid(target, result.provider)
      ) {
        return {
          action: "update_local_to_paid",
          safe: true,
          provider: result.provider,
        };
      }
      // RECON-2: paid + non-zero refunds is not a clean paid upgrade — review.
      if (
        isIndeterminateLocal(local) &&
        providerPaidWithRefunds(result.provider) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider is paid-like but refundedAmount is non-zero — refuse safe update_local_to_paid; surface refund state for review",
        };
      }
      // P19-CAPTURE: paid + present capturedAmount zero/≠ amount is not a
      // clean paid upgrade — review (omitted capturedAmount stays allowed).
      if (
        isIndeterminateLocal(local) &&
        providerPaidWithCaptureMismatch(result.provider) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider is paid-like but capturedAmount is zero or not money-equal to amount — refuse safe update_local_to_paid; surface capture mismatch for review",
        };
      }
      if (
        isIndeterminateLocal(local) &&
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status) &&
        maySafeUpdateToFailed(target, result.provider)
      ) {
        return {
          action: "update_local_to_failed",
          safe: true,
          provider: result.provider,
        };
      }
      // RECON-1: failed/cancelled status with non-zero capture/refund totals —
      // never safe mark failed (replacement create would risk dual money).
      if (
        isIndeterminateLocal(local) &&
        providerFailedWithMovedFunds(result.provider) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider status is failed/cancelled but capturedAmount or refundedAmount is non-zero — refuse safe update_local_to_failed; funds may have moved",
        };
      }
      // RECON-3: in-flight pending/processing while local is sparse/indeterminate
      // → retry_later (still settling). Do not manual_review / dead-letter.
      if (
        isIndeterminateLocal(local) &&
        isInFlightSettlingProvider(result.provider.status)
      ) {
        return {
          action: "retry_later",
          safe: false,
        };
      }
      // Sparse / indeterminate expected + other open incomplete provider must not
      // complete recovery as mark_consistent — capture/fulfillment may remain.
      if (
        isIndeterminateLocal(local) &&
        isOpenIncompleteProvider(result.provider.status)
      ) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider is in open/incomplete money state while local expected is sparse or indeterminate — surface capture/fulfillment work; do not mark consistent",
        };
      }
      // RECON-2: status-only local paid matching provider paid must not ignore
      // non-zero provider.refundedAmount — refuse safe mark_consistent (refund drift).
      if (providerPaidWithRefunds(result.provider)) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider is paid-like but refundedAmount is non-zero — refuse safe mark_consistent; surface refund drift for review",
        };
      }
      // P19-CAPTURE: status-only local paid matching provider paid must not
      // ignore a present capturedAmount that is zero or ≠ amount.
      if (providerPaidWithCaptureMismatch(result.provider)) {
        return {
          action: "manual_review",
          safe: false,
          reason:
            "Provider is paid-like but capturedAmount is zero or not money-equal to amount — refuse safe mark_consistent; surface capture mismatch for review",
        };
      }
      return {
        action: "mark_consistent",
        safe: true,
        provider: result.provider,
      };
    }

    case "drift_detected": {
      const local = target.expected;
      // Status-only upgrade paths still safe when drift is only status pending→paid.
      // Identity mismatch (gatewayPaymentId) or auth-hold locals are never safe.
      const onlyStatus =
        result.differences.length === 1 &&
        result.differences[0]?.field === "status";
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        isPaidLikePaymentStatus(result.provider.status) &&
        maySafeUpgradeToPaid(target, result.provider)
      ) {
        return {
          action: "update_local_to_paid",
          safe: true,
          provider: result.provider,
        };
      }
      // RECON-2 on status-only drift: paid + refunds → drift review, not paid.
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        providerPaidWithRefunds(result.provider) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "apply_drift_review",
          safe: false,
          differences: result.differences,
          provider: result.provider,
        };
      }
      // P19-CAPTURE on status-only drift: paid + capture mismatch → review.
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        providerPaidWithCaptureMismatch(result.provider) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "apply_drift_review",
          safe: false,
          differences: result.differences,
          provider: result.provider,
        };
      }
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status) &&
        maySafeUpdateToFailed(target, result.provider)
      ) {
        return {
          action: "update_local_to_failed",
          safe: true,
          provider: result.provider,
        };
      }
      // RECON-1 on status-only drift: failed + non-zero money → not safe failed.
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        providerFailedWithMovedFunds(result.provider)
      ) {
        return {
          action: "apply_drift_review",
          safe: false,
          differences: result.differences,
          provider: result.provider,
        };
      }
      return {
        action: "apply_drift_review",
        safe: false,
        differences: result.differences,
        provider: result.provider,
      };
    }

    case "ambiguous_match":
      // Roadmap 19.5: manual review for ambiguous matches (never pick first).
      // Replacement is also forbidden — see shouldForbidReplacementCharge.
      return {
        action: "manual_review",
        safe: false,
        reason:
          "Ambiguous provider matches — never pick first; do not create replacement charges",
      };

    case "temporarily_unavailable": {
      const d: ReconciliationDecision = {
        action: "retry_later",
        safe: false,
      };
      if (result.retryAfterMs !== undefined) {
        d.retryAfterMs = result.retryAfterMs;
      }
      return d;
    }

    case "provider_not_found":
      if (result.retryable) {
        // RECON-2: shouldForbidReplacementCharge is always true for
        // provider_not_found. Always surface do_not_create_replacement as the
        // primary decision — including terminal failed/cancelled locals — so
        // action-only switches cannot treat this as pure retry_later then
        // createPayment (duplicate-charge footgun). Apps may still reschedule
        // a later lookup; they must not create a replacement charge.
        return {
          action: "do_not_create_replacement",
          safe: false,
          reason:
            "Provider payment not found — do not create replacement (original may still settle or exist); reschedule lookup if needed",
        };
      }
      return {
        action: "manual_review",
        safe: false,
        reason: "Provider payment not found (non-retryable)",
      };

    case "manual_review_required":
      if (isIndeterminateLocal(target.expected)) {
        return {
          action: "do_not_create_replacement",
          safe: false,
          reason: result.reason,
        };
      }
      return {
        action: "manual_review",
        safe: false,
        reason: result.reason,
      };

    default: {
      const _exhaustive: never = result;
      void _exhaustive;
      return {
        action: "manual_review",
        safe: false,
        reason: "Unknown reconciliation outcome",
      };
    }
  }
}

/** Alias. */
export const decideReconciliationAction = decideReconciliationPolicy;

/**
 * True when creating a replacement charge would risk duplicates.
 *
 * Forbids replacement when:
 * - result is `ambiguous_match` (never pick-first then re-charge)
 * - result is `provider_not_found` (original may still settle or exist)
 * - result is `temporarily_unavailable` (unknown provider state)
 * - result is `manual_review_required` (RECON-1 — original may still settle
 *   or identity/lookup is incomplete; never re-charge while under review)
 * - local expected is missing/indeterminate **or** any open money state
 *   (`authorized` / `approved` / partial / `paid` / refunded /
 *   `refund_pending` / `refund_failed` / `refund_completed` / setup, etc.)
 *
 * Only terminal failed/cancelled locals without ambiguous/not-found/review
 * outcomes leave room for an application-level re-attempt after review.
 */
export function shouldForbidReplacementCharge(
  result: ReconciliationResult,
  target: ReconciliationTarget,
): boolean {
  if (result.outcome === "ambiguous_match") return true;
  if (result.outcome === "provider_not_found") return true;
  if (result.outcome === "temporarily_unavailable") return true;
  // RECON-1: forbid re-charge while lookup/identity requires manual review
  // (terminal local alone must not open a second createPayment).
  if (result.outcome === "manual_review_required") return true;
  if (isOpenMoneyLocal(target.expected)) {
    // Open or already-settled local money: never create a second charge while
    // the original intent may still settle or already holds funds.
    return true;
  }
  // RECON-1: when provider snapshot is present and holds paid/open money,
  // forbid replacement even if local is terminal failed/cancelled (dual create).
  // Also forbid when status is failed/cancelled but captured/refunded totals
  // are non-zero (funds already moved — status-only failed is not safe recreate).
  if (
    (result.outcome === "consistent" || result.outcome === "drift_detected") &&
    result.provider !== undefined
  ) {
    const providerStatus = result.provider.status;
    if (
      isPaidLikePaymentStatus(providerStatus) ||
      isOpenIncompleteProvider(providerStatus) ||
      providerFailedWithMovedFunds(result.provider)
    ) {
      return true;
    }
  }
  return false;
}
