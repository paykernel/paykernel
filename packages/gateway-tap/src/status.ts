import type {
  PaymentOperationOutcome,
  PaymentStatus,
  RefundStatus,
  StablePaymentEventType,
} from "@paykernel/core";

const CHARGE_STATUS: Record<string, PaymentStatus> = {
  INITIATED: "pending",
  "IN PROGRESS": "pending",
  IN_PROGRESS: "pending",
  AUTHORIZED: "authorized",
  CAPTURED: "paid",
  REFUNDED: "refunded",
  VOID: "cancelled",
  CANCELLED: "cancelled",
  CANCELED: "cancelled",
  ABANDONED: "cancelled",
  FAILED: "failed",
  DECLINED: "failed",
  RESTRICTED: "failed",
  TIMEDOUT: "failed",
  UNKNOWN: "failed",
};

const REFUND_STATUS: Record<string, RefundStatus> = {
  REFUNDED: "completed",
  PENDING: "pending",
  ACCEPTED: "pending",
  "IN PROGRESS": "pending",
  IN_PROGRESS: "pending",
  CANCELED: "failed",
  CANCELLED: "failed",
  FAILED: "failed",
  DECLINED: "failed",
  RESTRICTED: "failed",
  TIMEDOUT: "failed",
  UNKNOWN: "failed",
};

function normalizeTapStatus(status: unknown): string {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
}

export function mapTapChargeStatus(status: unknown): PaymentStatus {
  const key = normalizeTapStatus(status);
  return CHARGE_STATUS[key] ?? "failed";
}

export function mapTapRefundEntityStatus(status: unknown): RefundStatus {
  const key = normalizeTapStatus(status);
  return REFUND_STATUS[key] ?? "failed";
}

/** Payment-domain status when the object is a Tap refund. */
export function mapTapRefundPaymentStatus(status: unknown): PaymentStatus {
  const entity = mapTapRefundEntityStatus(status);
  if (entity === "completed") return "refunded";
  if (entity === "pending") return "refund_pending";
  return "refund_failed";
}

function mapTapPaymentOutcome(status: PaymentStatus): PaymentOperationOutcome {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "failed";
  if (status === "pending") return "requires_action";
  return "succeeded";
}

function isTapDeclineResponseCode(code: unknown): boolean {
  let n: number;
  if (typeof code === "number") {
    n = code;
  } else if (typeof code === "string") {
    const trimmed = code.trim();
    if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return false;
    n = Number(trimmed);
  } else {
    return false;
  }
  return Number.isInteger(n) && n >= 501 && n <= 516;
}

export function mapTapChargeOutcome(
  tapStatus: unknown,
  paymentStatus: PaymentStatus,
  responseCode?: unknown,
): PaymentOperationOutcome {
  if (isTapDeclineStatus(tapStatus, responseCode)) {
    return "declined";
  }
  return mapTapPaymentOutcome(paymentStatus);
}

export function isTapDeclineStatus(
  tapStatus: unknown,
  responseCode?: unknown,
): boolean {
  return (
    normalizeTapStatus(tapStatus) === "DECLINED" ||
    isTapDeclineResponseCode(responseCode)
  );
}

/** Stable Phase 7 names so attachPaymentEvent can map a custom gateway. */
export function inferTapStableType(
  kind: "charge" | "authorize" | "refund",
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
  if (status === "refunded") return "refund.completed";
  return undefined;
}


