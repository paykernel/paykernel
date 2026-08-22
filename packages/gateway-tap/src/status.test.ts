import { describe, expect, it } from "bun:test";
import {
  isTapDeclineStatus,
  mapTapChargeOutcome,
  mapTapChargeStatus,
  mapTapRefundEntityStatus,
  mapTapRefundPaymentStatus,
} from "./status";

describe("mapTapChargeStatus", () => {
  it("maps captured / authorized / initiated / declined", () => {
    expect(mapTapChargeStatus("CAPTURED")).toBe("paid");
    expect(mapTapChargeStatus("AUTHORIZED")).toBe("authorized");
    expect(mapTapChargeStatus("INITIATED")).toBe("pending");
    expect(mapTapChargeStatus("DECLINED")).toBe("failed");
    expect(mapTapChargeStatus("UNKNOWN")).toBe("failed");
    expect(mapTapChargeStatus("TIMEDOUT")).toBe("failed");
  });

  it("maps IN_PROGRESS underscore form to pending", () => {
    expect(mapTapChargeStatus("IN_PROGRESS")).toBe("pending");
  });

  it("maps CANCELED (one L) to cancelled like CANCELLED", () => {
    expect(mapTapChargeStatus("CANCELLED")).toBe("cancelled");
    expect(mapTapChargeStatus("CANCELED")).toBe("cancelled");
  });
});

describe("mapTapChargeOutcome", () => {
  it("treats INITIATED and IN PROGRESS as requires_action", () => {
    expect(mapTapChargeOutcome("INITIATED", "pending")).toBe("requires_action");
    expect(mapTapChargeOutcome("IN PROGRESS", "pending")).toBe(
      "requires_action",
    );
    expect(mapTapChargeOutcome("IN_PROGRESS", "pending")).toBe(
      "requires_action",
    );
  });

  it("treats CAPTURED and AUTHORIZED as succeeded and DECLINED as declined", () => {
    expect(mapTapChargeOutcome("CAPTURED", "paid")).toBe("succeeded");
    expect(mapTapChargeOutcome("AUTHORIZED", "authorized")).toBe("succeeded");
    expect(mapTapChargeOutcome("DECLINED", "failed")).toBe("declined");
  });

  it("does not treat UNKNOWN as paid", () => {
    expect(mapTapChargeOutcome("UNKNOWN", "failed")).toBe("failed");
  });

  it.each([505, "505"] as const)(
    "maps FAILED + response code %s to declined even when paymentStatus is failed",
    (code) => {
      expect(mapTapChargeOutcome("FAILED", "failed", code)).toBe("declined");
    },
  );

  it("maps FAILED + response codes 501 and 516 to declined", () => {
    expect(mapTapChargeOutcome("FAILED", "failed", 501)).toBe("declined");
    expect(mapTapChargeOutcome("FAILED", "failed", "516")).toBe("declined");
  });

  it("maps FAILED without a 501–516 response code as failed", () => {
    expect(mapTapChargeOutcome("FAILED", "failed")).toBe("failed");
    expect(mapTapChargeOutcome("FAILED", "failed", 500)).toBe("failed");
    expect(mapTapChargeOutcome("FAILED", "failed", "517")).toBe("failed");
  });
});

describe("isTapDeclineStatus", () => {
  it("is true for DECLINED without a response code", () => {
    expect(isTapDeclineStatus("DECLINED")).toBe(true);
  });

  it("is true for FAILED with decline response code 505", () => {
    expect(isTapDeclineStatus("FAILED", 505)).toBe(true);
    expect(isTapDeclineStatus("FAILED", "505")).toBe(true);
  });

  it("is false for FAILED without a 501–516 response code", () => {
    expect(isTapDeclineStatus("FAILED")).toBe(false);
    expect(isTapDeclineStatus("FAILED", 500)).toBe(false);
    expect(isTapDeclineStatus("FAILED", "517")).toBe(false);
  });

  it("is false for CAPTURED with success response code 000", () => {
    expect(isTapDeclineStatus("CAPTURED", "000")).toBe(false);
  });
});

describe("mapTapRefundEntityStatus", () => {
  it("maps refund object statuses", () => {
    expect(mapTapRefundEntityStatus("REFUNDED")).toBe("completed");
    expect(mapTapRefundEntityStatus("PENDING")).toBe("pending");
    expect(mapTapRefundEntityStatus("IN PROGRESS")).toBe("pending");
    expect(mapTapRefundEntityStatus("CANCELED")).toBe("failed");
    expect(mapTapRefundEntityStatus("CANCELLED")).toBe("failed");
    expect(mapTapRefundPaymentStatus("REFUNDED")).toBe("refunded");
  });

  it("maps ACCEPTED as pending, not completed or failed", () => {
    expect(mapTapRefundEntityStatus("ACCEPTED")).toBe("pending");
    expect(mapTapRefundPaymentStatus("ACCEPTED")).toBe("refund_pending");
  });

  it("maps refund IN_PROGRESS underscore form to pending", () => {
    expect(mapTapRefundEntityStatus("IN_PROGRESS")).toBe("pending");
    expect(mapTapRefundPaymentStatus("IN_PROGRESS")).toBe("refund_pending");
  });
});
