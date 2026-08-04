// file: packages/core/src/types/stable-payment-event-types.ts

/**
 * Stable payment event type catalog (Phase 7).
 *
 * Kept in a cycle-free module so both the PaymentEvent model and the
 * provider→stable mapper share one source of truth (no duplicated name lists).
 *
 * **Compatibility rule:** never silently change the meaning of a name once
 * shipped. Additive optional fields on event arms are OK within
 * `schemaVersion: '1'`. Changing arm meaning requires a new `schemaVersion`.
 */

/**
 * Stable, provider-agnostic payment event type names (v1).
 */
export const STABLE_PAYMENT_EVENT_TYPES = [
  "payment.created",
  "payment.processing",
  "payment.authorized",
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "capture.completed",
  "refund.pending",
  "refund.completed",
  "refund.failed",
  "payment_method.setup_completed",
  "dispute.opened",
  "dispute.updated",
  "dispute.closed",
] as const;

export type StablePaymentEventType =
  (typeof STABLE_PAYMENT_EVENT_TYPES)[number];

const STABLE_PAYMENT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  STABLE_PAYMENT_EVENT_TYPES,
);

/**
 * Type guard: value is a {@link StablePaymentEventType}.
 */
export function isStablePaymentEventType(
  v: string,
): v is StablePaymentEventType {
  return STABLE_PAYMENT_EVENT_TYPE_SET.has(v);
}
