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

/**
 * Decide what the application should do after a reconciliation result.
 *
 * Rules:
 * - consistent → mark_consistent
 * - drift_detected → apply_drift_review (never auto-mutate money totals)
 * - local pending/indeterminate + provider paid + single match → update_local_to_paid
 * - local pending/indeterminate + provider definitive failed → update_local_to_failed
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
        isPaidLikePaymentStatus(result.provider.status)
      ) {
        return {
          action: "update_local_to_paid",
          safe: true,
          provider: result.provider,
        };
      }
      if (
        isIndeterminateLocal(local) &&
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status)
      ) {
        return {
          action: "update_local_to_failed",
          safe: true,
          provider: result.provider,
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
      // Status-only upgrade paths still safe when drift is only status pending→paid
      const onlyStatus =
        result.differences.length === 1 &&
        result.differences[0]?.field === "status";
      if (
        onlyStatus &&
        isIndeterminateLocal(local) &&
        isPaidLikePaymentStatus(result.provider.status)
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
        DEFINITIVE_FAILED_STATUSES.has(result.provider.status)
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
        // Original may still settle — forbid replacement while indeterminate
        if (isIndeterminateLocal(target.expected)) {
          return {
            action: "do_not_create_replacement",
            safe: false,
            reason:
              "Provider payment not found yet and local state is indeterminate — do not create replacement",
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
 * Call when status is indeterminate or result is ambiguous.
 */
export function shouldForbidReplacementCharge(
  result: ReconciliationResult,
  target: ReconciliationTarget,
): boolean {
  if (result.outcome === "ambiguous_match") return true;
  if (isIndeterminateLocal(target.expected)) {
    // Indeterminate local: never create replacement while original may still settle
    // or until the app applies an update_local_to_paid / failed decision.
    return true;
  }
  return false;
}
