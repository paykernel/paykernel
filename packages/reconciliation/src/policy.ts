/**
 * Decision-only reconciliation policy helpers (Phase 19.5).
 *
 * Policy functions return decisions only — NEVER mutate local payments,
 * NEVER call createPayment / capture / refund / void APIs.
 */

import { isPaidLikePaymentStatus } from "@paykernel/core";
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

function maySafeUpgradeToPaid(
  target: ReconciliationTarget,
  provider: ProviderPaymentSnapshot,
): boolean {
  // RECON-4: never auto-upgrade auth holds / partial captures to paid.
  if (isAuthHoldLocal(target.expected)) return false;
  if (!identityBoundToTarget(target, provider)) return false;
  return true;
}

/**
 * Decide what the application should do after a reconciliation result.
 *
 * Rules:
 * - consistent → mark_consistent (only when not sparse+open-provider incomplete)
 * - drift_detected → apply_drift_review (never auto-mutate money totals)
 * - local pending/indeterminate + provider paid + identity-bound → update_local_to_paid
 * - local pending/indeterminate + provider definitive failed + identity-bound → update_local_to_failed
 * - sparse/indeterminate local + open incomplete provider (auth/approved/partial) →
 *   manual_review (never mark_consistent safe:true — surface capture work)
 * - local `authorized` / `partially_captured` → paid is **never** safe auto-upgrade
 *   (apply_drift_review) — capture totals / final_capture may still be incomplete
 * - gatewayPaymentId mismatch (target vs provider) → never safe paid/failed upgrade
 * - ambiguous_match → manual_review
 * - temporarily_unavailable / provider_not_found retryable → retry_later
 * - ALWAYS surface do_not_create_replacement when indeterminate or ambiguous
 *   (returned as primary decision for ambiguous / indeterminate-not-found paths
 *   where replacement would risk duplicate charges; otherwise callers can use
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
      if (
        isIndeterminateLocal(local) &&
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "update_local_to_failed",
          safe: true,
          provider: result.provider,
        };
      }
      // Sparse / indeterminate expected + open incomplete provider must not
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
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status) &&
        identityBoundToTarget(target, result.provider)
      ) {
        return {
          action: "update_local_to_failed",
          safe: true,
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
        // RECON-3: shouldForbidReplacementCharge is always true for
        // provider_not_found. Surface do_not_create_replacement for open-money
        // and indeterminate locals so sample loops that only switch on policy
        // action cannot treat this as a pure reschedule-then-recreate path.
        // Terminal non-open locals still get retry_later (reschedule lookup);
        // callers must still consult shouldForbidReplacementCharge.
        if (
          isIndeterminateLocal(target.expected) ||
          isOpenMoneyLocal(target.expected)
        ) {
          return {
            action: "do_not_create_replacement",
            safe: false,
            reason:
              "Provider payment not found yet and local money state is open or indeterminate — do not create replacement",
          };
        }
        return { action: "retry_later", safe: false };
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
 * - local expected is missing/indeterminate **or** any open money state
 *   (`authorized` / `approved` / partial / `paid` / refunded /
 *   `refund_pending` / `refund_failed` / `refund_completed` / setup, etc.)
 *
 * Only terminal failed/cancelled locals without ambiguous/not-found outcomes
 * leave room for an application-level re-attempt after review.
 */
export function shouldForbidReplacementCharge(
  result: ReconciliationResult,
  target: ReconciliationTarget,
): boolean {
  if (result.outcome === "ambiguous_match") return true;
  if (result.outcome === "provider_not_found") return true;
  if (result.outcome === "temporarily_unavailable") return true;
  if (isOpenMoneyLocal(target.expected)) {
    // Open or already-settled local money: never create a second charge while
    // the original intent may still settle or already holds funds.
    return true;
  }
  // RECON-1: when provider snapshot is present and holds paid/open money,
  // forbid replacement even if local is terminal failed/cancelled (dual create).
  if (
    (result.outcome === "consistent" || result.outcome === "drift_detected") &&
    result.provider !== undefined
  ) {
    const providerStatus = result.provider.status;
    if (
      isPaidLikePaymentStatus(providerStatus) ||
      isOpenIncompleteProvider(providerStatus)
    ) {
      return true;
    }
  }
  return false;
}
