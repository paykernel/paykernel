/**
 * Reconciliation domain types (Phase 19.1–19.3).
 *
 * Portable; depends only on core PaymentStatus + Money.
 * exactOptionalPropertyTypes-safe: omit optional keys when absent.
 */

import type { Money, PaymentStatus } from "@paykernel/core";

// ─── 19.1 Local snapshot + target ────────────────────────────────────────────

/**
 * Expected / local payment state used for compare and policy.
 * All fields optional — partial local knowledge is valid for indeterminate checks.
 */
export type LocalPaymentSnapshot = {
  status?: PaymentStatus;
  amount?: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  gatewayPaymentId?: string;
  localReference?: string;
};

/**
 * What to reconcile: gateway + one or more lookup keys + optional expected local state.
 *
 * Prefer `gatewayPaymentId` when known; fallbacks enable recovery after timeouts.
 */
export type ReconciliationTarget = {
  gateway: string;
  localReference?: string;
  gatewayPaymentId?: string;
  idempotencyKey?: string;
  providerRequestId?: string;
  expected?: LocalPaymentSnapshot;
};

// ─── 19.2 Provider snapshot ──────────────────────────────────────────────────

/**
 * Normalized provider-side payment view returned by lookup ports.
 */
export type ProviderPaymentSnapshot = {
  gatewayPaymentId: string;
  status: PaymentStatus;
  amount: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  updatedAt?: string;
  /** Raw provider status string (not secret). */
  providerStatus: string;
  relatedIds?: Record<string, string>;
};

// ─── 19.3 Differences + results ──────────────────────────────────────────────

/**
 * Machine-readable drift entry (field path + local vs provider values).
 * Prefer `field` paths: `status` | `amount` | `capturedAmount` | `refundedAmount`.
 */
export type ReconciliationDifference = {
  /** Machine-readable path, e.g. `status` | `amount` | `capturedAmount`. */
  field: string;
  local?: unknown;
  provider?: unknown;
  message?: string;
};

/**
 * Outcome of a single reconciliation check (exact discriminants).
 *
 * Never invents paid/failed from uncertain provider state.
 */
export type ReconciliationResult =
  | { outcome: "consistent"; provider: ProviderPaymentSnapshot }
  | {
      outcome: "drift_detected";
      provider: ProviderPaymentSnapshot;
      differences: ReconciliationDifference[];
    }
  | { outcome: "provider_not_found"; retryable: boolean }
  | { outcome: "temporarily_unavailable"; retryAfterMs?: number }
  | { outcome: "ambiguous_match"; matches: ProviderPaymentSnapshot[] }
  | { outcome: "manual_review_required"; reason: string };

// ─── Construction helpers (optional keys omitted when absent) ────────────────

export type BuildLocalPaymentSnapshotInput = {
  status?: PaymentStatus;
  amount?: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  gatewayPaymentId?: string;
  localReference?: string;
};

/** Build a LocalPaymentSnapshot omitting undefined optional keys. */
export function buildLocalPaymentSnapshot(
  input: BuildLocalPaymentSnapshotInput,
): LocalPaymentSnapshot {
  const out: LocalPaymentSnapshot = {};
  if (input.status !== undefined) out.status = input.status;
  if (input.amount !== undefined) out.amount = input.amount;
  if (input.capturedAmount !== undefined) out.capturedAmount = input.capturedAmount;
  if (input.refundedAmount !== undefined) out.refundedAmount = input.refundedAmount;
  if (input.gatewayPaymentId !== undefined) {
    out.gatewayPaymentId = input.gatewayPaymentId;
  }
  if (input.localReference !== undefined) out.localReference = input.localReference;
  return out;
}

export type BuildReconciliationTargetInput = {
  gateway: string;
  localReference?: string;
  gatewayPaymentId?: string;
  idempotencyKey?: string;
  providerRequestId?: string;
  expected?: LocalPaymentSnapshot;
};

/** Build a ReconciliationTarget omitting undefined optional keys. */
export function buildReconciliationTarget(
  input: BuildReconciliationTargetInput,
): ReconciliationTarget {
  const out: ReconciliationTarget = { gateway: input.gateway };
  if (input.localReference !== undefined) out.localReference = input.localReference;
  if (input.gatewayPaymentId !== undefined) {
    out.gatewayPaymentId = input.gatewayPaymentId;
  }
  if (input.idempotencyKey !== undefined) out.idempotencyKey = input.idempotencyKey;
  if (input.providerRequestId !== undefined) {
    out.providerRequestId = input.providerRequestId;
  }
  if (input.expected !== undefined) out.expected = input.expected;
  return out;
}

export type BuildProviderPaymentSnapshotInput = {
  gatewayPaymentId: string;
  status: PaymentStatus;
  amount: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  updatedAt?: string;
  providerStatus: string;
  relatedIds?: Record<string, string>;
};

/** Build a ProviderPaymentSnapshot omitting undefined optional keys. */
export function buildProviderPaymentSnapshot(
  input: BuildProviderPaymentSnapshotInput,
): ProviderPaymentSnapshot {
  const out: ProviderPaymentSnapshot = {
    gatewayPaymentId: input.gatewayPaymentId,
    status: input.status,
    amount: input.amount,
    providerStatus: input.providerStatus,
  };
  if (input.capturedAmount !== undefined) out.capturedAmount = input.capturedAmount;
  if (input.refundedAmount !== undefined) out.refundedAmount = input.refundedAmount;
  if (input.updatedAt !== undefined) out.updatedAt = input.updatedAt;
  if (input.relatedIds !== undefined) out.relatedIds = input.relatedIds;
  return out;
}
