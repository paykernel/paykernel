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
 *
 * Includes Stripe early-fraud-warning (`warning_*`) arms. Native provider
 * strings stay on `providerStatus` when they are not in this union.
 */
export type DisputeStatus =
    | "needs_response"
    | "under_review"
    | "won"
    | "lost"
    | "warning_needs_response"
    | "warning_under_review"
    | "warning_closed"
    | "charge_refunded";

export const DISPUTE_STATUSES = [
    "needs_response",
    "under_review",
    "won",
    "lost",
    "warning_needs_response",
    "warning_under_review",
    "warning_closed",
    "charge_refunded",
] as const satisfies readonly DisputeStatus[];

const DISPUTE_STATUS_SET: ReadonlySet<string> = new Set(DISPUTE_STATUSES);

export function isDisputeStatus(value: string): value is DisputeStatus {
    return DISPUTE_STATUS_SET.has(value);
}

/**
 * Map a provider-native dispute lifecycle string onto {@link DisputeStatus}.
 * Unknown values are returned unchanged (stay on `providerStatus`).
 * Stripe `prevented` (early fraud warning closed without a dispute) maps to
 * `warning_closed` — never paid.
 */
export function mapNativeDisputeStatus(
    native: string,
): DisputeStatus | string {
    if (isDisputeStatus(native)) {
        return native;
    }
    if (native === "prevented") {
        return "warning_closed";
    }
    return native;
}

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

/**
 * Statuses that mean money is settled / successfully captured for fulfillment.
 *
 * **Paid-like = funds captured/settled for ship-goods decisions.**
 * Does **not** include buyer approval (`approved`), auth holds (`authorized`),
 * or open partial captures (`partially_captured`).
 * PayPal order `APPROVED` is pre-capture; use capture/`paid` before fulfilling.
 */
export const PAID_LIKE_PAYMENT_STATUSES = [
    "paid",
] as const satisfies readonly PaymentDomainStatus[];

const PAID_LIKE_SET: ReadonlySet<string> = new Set(PAID_LIKE_PAYMENT_STATUSES);

/**
 * True when a payment-domain (or legacy PaymentStatus) string is in the paid-like set.
 * Does **not** treat `authorized`, `approved`, or `partially_captured` as paid —
 * auth holds, buyer approval, and open partial captures are not settled for
 * fulfillment.
 */
export function isPaidLikePaymentStatus(status: string): boolean {
    return PAID_LIKE_SET.has(status);
}
