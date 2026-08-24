import { describe, expect, it } from "bun:test";
import {
  inferMyFatoorahStableType,
  mapMyFatoorahInvoiceOutcome,
  mapMyFatoorahInvoiceStatus,
  mapMyFatoorahRefundEntityStatus,
  mapMyFatoorahRefundPaymentStatus,
  mapMyFatoorahTransactionEvidence,
} from "./status";
import { myFatoorahPaymentWebhookStatus } from "./webhook-map";

describe("myfatoorah status mapping", () => {
  it("maps invoice statuses (case-insensitive)", () => {
    expect(mapMyFatoorahInvoiceStatus("Paid")).toBe("paid");
    expect(mapMyFatoorahInvoiceStatus("PENDING")).toBe("pending");
    expect(mapMyFatoorahInvoiceStatus("Canceled")).toBe("cancelled");
    expect(mapMyFatoorahInvoiceStatus("CANCELLED")).toBe("cancelled");
    expect(mapMyFatoorahInvoiceStatus("nonsense")).toBe("failed");
  });

  it("maps transaction evidence including the official Succss typo", () => {
    expect(mapMyFatoorahTransactionEvidence("Succss")).toBe("success");
    expect(mapMyFatoorahTransactionEvidence("SUCCESS")).toBe("success");
    expect(mapMyFatoorahTransactionEvidence("FAILED")).toBe("failed");
    expect(mapMyFatoorahTransactionEvidence("CANCELED")).toBe("cancelled");
    expect(mapMyFatoorahTransactionEvidence("AUTHORIZE")).toBe("authorized");
    expect(mapMyFatoorahTransactionEvidence("INPROGRESS")).toBe("pending");
    expect(mapMyFatoorahTransactionEvidence("IN PROGRESS")).toBe("pending");
    expect(mapMyFatoorahTransactionEvidence("weird")).toBe("unknown");
  });

  it("maps refund entity statuses", () => {
    expect(mapMyFatoorahRefundEntityStatus("Refunded")).toBe("completed");
    expect(mapMyFatoorahRefundEntityStatus("Pending")).toBe("pending");
    expect(mapMyFatoorahRefundEntityStatus("Canceled")).toBe("failed");
    expect(mapMyFatoorahRefundEntityStatus("wat")).toBe("failed");
  });

  it("maps refund entity status to payment-domain status", () => {
    expect(mapMyFatoorahRefundPaymentStatus("Refunded")).toBe("refunded");
    expect(mapMyFatoorahRefundPaymentStatus("Pending")).toBe("refund_pending");
    expect(mapMyFatoorahRefundPaymentStatus("Canceled")).toBe("refund_failed");
  });

  it("maps invoice outcomes", () => {
    expect(mapMyFatoorahInvoiceOutcome("paid")).toBe("succeeded");
    expect(mapMyFatoorahInvoiceOutcome("pending")).toBe("requires_action");
    expect(mapMyFatoorahInvoiceOutcome("failed")).toBe("failed");
    expect(mapMyFatoorahInvoiceOutcome("cancelled")).toBe("failed");
  });

  it("derives webhook payment status fail-closed", () => {
    expect(myFatoorahPaymentWebhookStatus("PAID", "SUCCESS")).toBe("paid");
    expect(myFatoorahPaymentWebhookStatus("PAID", "Succss")).toBe("paid");
    // PAID is authoritative — even non-success transaction stays paid (KNET duplicate handling)
    expect(myFatoorahPaymentWebhookStatus("PAID", "FAILED")).toBe("paid");
    expect(myFatoorahPaymentWebhookStatus("PENDING", "FAILED")).toBe("pending");
    expect(myFatoorahPaymentWebhookStatus("PENDING", "SUCCESS")).toBe("pending");
    expect(myFatoorahPaymentWebhookStatus("CANCELED", "FAILED")).toBe("cancelled");
    expect(myFatoorahPaymentWebhookStatus("PAID", "AUTHORIZE")).toBe("paid");
    expect(myFatoorahPaymentWebhookStatus("PENDING", "AUTHORIZE")).toBe("pending");
  });

  it("infers stable types", () => {
    expect(inferMyFatoorahStableType("invoice", "paid")).toBe("payment.succeeded");
    expect(inferMyFatoorahStableType("invoice", "pending")).toBe("payment.processing");
    expect(inferMyFatoorahStableType("invoice", "cancelled")).toBe("payment.cancelled");
    expect(inferMyFatoorahStableType("invoice", "failed")).toBe("payment.failed");
    expect(inferMyFatoorahStableType("refund", "refunded")).toBe("refund.completed");
    expect(inferMyFatoorahStableType("refund", "refund_pending")).toBe("refund.pending");
    expect(inferMyFatoorahStableType("refund", "refund_failed")).toBe("refund.failed");
  });
});
