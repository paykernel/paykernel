// file: packages/core/src/types/domain-status.ts

/**
 * Domain-specific status unions (Phase 6).
 *
 * Prefer these over the legacy mega-union {@link PaymentStatus} when modeling a
 * single domain (payment charge lifecycle vs refund vs setup vs dispute, etc.).
 * Do not invent fake shared statuses across domains.
 */

/**
 * Payment charge/intent lifecycle only.
 *
 * Includes terminal states that reflect refunds on the payment object
 * (`refunded` / `partially_refunded`). Does **not** include refund-entity
 * statuses (`refund_pending` / `refund_completed` / `refund_failed`) or
 * `setup_completed` — those remain on the legacy {@link PaymentStatus} mega-union
 * for 0.x compatibility.
 */
export type PaymentDomainStatus =
    | "pending"
    | "processing"
    | "authorized"
    | "approved"
    | "paid"
    | "partially_captured"
    | "failed"
    | "cancelled"
    | "reversed"
    | "refunded"
    | "partially_refunded";

/**
 * Authorization (auth-only hold) lifecycle.
 */
export type AuthorizationStatus =
    | "pending"
    | "authorized"
    | "captured"
    | "partially_captured"
    | "voided"
    | "expired"
    | "failed";

/**
 * Capture operation lifecycle.
 */
export type CaptureStatus =
    | "pending"
    | "completed"
    | "partially_completed"
    | "failed";

/**
 * Refund processing status (entity-level).
 * Identical to the existing {@link import('./payment.types').RefundStatus} union.
 */
export type RefundDomainStatus = "pending" | "completed" | "failed";

/**
 * Setup / SetupIntent / save-payment-method token lifecycle.
 */
export type SetupTokenStatus =
    | "pending"
    | "requires_action"
    | "succeeded"
    | "failed"
    | "cancelled";

/**
 * Dispute / chargeback lifecycle (normalized).
 */
export type DisputeStatus =
    | "needs_response"
    | "under_review"
    | "won"
    | "lost"
    | "warning_closed"
    | "charge_refunded";

/**
 * Transfer (marketplace / Connect) lifecycle.
 */
export type TransferStatus =
    | "pending"
    | "in_transit"
    | "paid"
    | "failed"
    | "canceled"
    | "reversed";

/**
 * Payout lifecycle.
 */
export type PayoutStatus =
    | "pending"
    | "in_transit"
    | "paid"
    | "failed"
    | "canceled";

/** Runtime set of {@link PaymentDomainStatus} values for guards. */
export const PAYMENT_DOMAIN_STATUSES = [
    "pending",
    "processing",
    "authorized",
    "approved",
    "paid",
    "partially_captured",
    "failed",
    "cancelled",
    "reversed",
    "refunded",
    "partially_refunded",
] as const satisfies readonly PaymentDomainStatus[];

const PAYMENT_DOMAIN_STATUS_SET: ReadonlySet<string> = new Set(
    PAYMENT_DOMAIN_STATUSES,
);

/**
 * Type guard: value is a {@link PaymentDomainStatus} (not a legacy mega-union-only
 * status such as `refund_pending` or `setup_completed`).
 */
export function isPaymentDomainStatus(
    value: string,
): value is PaymentDomainStatus {
    return PAYMENT_DOMAIN_STATUS_SET.has(value);
}

/** Statuses that mean money is settled / successfully captured for fulfillment. */
export const PAID_LIKE_PAYMENT_STATUSES = [
    "paid",
    "approved",
] as const satisfies readonly PaymentDomainStatus[];

const PAID_LIKE_SET: ReadonlySet<string> = new Set(PAID_LIKE_PAYMENT_STATUSES);

/**
 * True when a payment-domain (or legacy PaymentStatus) string is in the paid-like set.
 * Does **not** treat `authorized` as paid — auth-only holds are reserved, not fulfilled.
 */
export function isPaidLikePaymentStatus(status: string): boolean {
    return PAID_LIKE_SET.has(status);
}
