import type {
  PaymentOperationOutcome,
  PaymentStatus,
  RefundStatus,
  StablePaymentEventType,
} from "@paykernel/core";

const INVOICE_STATUS: Record<string, PaymentStatus> = {
  PAID: "paid",
  PENDING: "pending",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  "PARTIALLY-REFUNDED": "partially_refunded",
  "PARTIALLY REFUNDED": "partially_refunded",
  PARTIALLYREFUNDED: "partially_refunded",
};

const REFUND_STATUS: Record<string, RefundStatus> = {
  REFUNDED: "completed",
  PENDING: "pending",
  CANCELED: "failed",
  CANCELLED: "failed",
};

export function normalizeMyFatoorahStatus(status: unknown): string {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
}

/**
 * Invoice / `InvoiceStatus` → payment status. Unknown fails closed to `failed`.
 *
 * Shared between `getPayment` (`POST /v2/GetPaymentStatus`) and webhook parsing
 * (`PAYMENT_STATUS_CHANGED` via `myFatoorahPaymentWebhookStatus`). Per
 * https://docs.myfatoorah.com/docs/get-payment-status, `GetPaymentStatus`
 * **never** returns `REFUNDED`/`PARTIALLY_REFUNDED` — those rows exist only for
 * `REFUND_STATUS_CHANGED` webhooks / `GetRefundStatus`. After a refund the
 * invoice stays `Paid` (refund-blind); callers must use `GetRefundStatus` or
 * `REFUND_STATUS_CHANGED` to observe refunds (see `docs/status-mapping.md` I3).
 */
export function mapMyFatoorahInvoiceStatus(status: unknown): PaymentStatus {
  return INVOICE_STATUS[normalizeMyFatoorahStatus(status)] ?? "failed";
}

/** Refund entity / `RefundStatus` → refund status. Unknown fails closed to `failed`. */
export function mapMyFatoorahRefundEntityStatus(status: unknown): RefundStatus {
  return REFUND_STATUS[normalizeMyFatoorahStatus(status)] ?? "failed";
}

/** Payment-domain status when the object is a MyFatoorah refund. */
export function mapMyFatoorahRefundPaymentStatus(status: unknown): PaymentStatus {
  const entity = mapMyFatoorahRefundEntityStatus(status);
  if (entity === "completed") return "refunded";
  if (entity === "pending") return "refund_pending";
  return "refund_failed";
}

/** Transaction status evidence. `Succss` is the official V2 typo for success. */
export type MyFatoorahTransactionEvidence =
  "success" | "failed" | "cancelled" | "authorized" | "pending" | "unknown";

export function mapMyFatoorahTransactionEvidence(status: unknown): MyFatoorahTransactionEvidence {
  switch (normalizeMyFatoorahStatus(status)) {
    case "SUCCESS":
    case "SUCCSS":
      return "success";
    case "FAILED":
      return "failed";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "AUTHORIZE":
      return "authorized";
    case "INPROGRESS":
    case "IN PROGRESS":
    case "IN_PROGRESS":
      return "pending";
    default:
      return "unknown";
  }
}

export function mapMyFatoorahInvoiceOutcome(status: PaymentStatus): PaymentOperationOutcome {
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "pending") return "requires_action";
  return "succeeded";
}

/**
 * Stable Phase 7 names so `attachPaymentEvent` can map a custom gateway.
 * `refund` and `invoice` kinds share the same `PaymentStatus` domain — `paid`
 * remains terminal per https://docs.myfatoorah.com/docs/v3-updating-payment-status-guidelines;
 * refund `refunded`/`partially_refunded` are surfaced via `REFUND_STATUS_CHANGED`
 * or `GetRefundStatus`, not `GetPaymentStatus` (refund-blind).
 */
export function inferMyFatoorahStableType(
  kind: "invoice" | "refund",
  status: PaymentStatus,
): StablePaymentEventType | undefined {
  if (kind === "refund") {
    if (status === "refunded") return "refund.completed";
    if (status === "refund_pending") return "refund.pending";
    if (status === "refund_failed") return "refund.failed";
    return undefined;
  }
  if (status === "paid") return "payment.succeeded";
  if (status === "authorized") return "payment.authorized";
  if (status === "pending") return "payment.processing";
  if (status === "cancelled") return "payment.cancelled";
  if (status === "failed") return "payment.failed";
  if (status === "refunded" || status === "partially_refunded") return "refund.completed";
  return undefined;
}
