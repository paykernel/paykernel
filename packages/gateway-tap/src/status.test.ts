import { describe, expect, it } from "bun:test";
import {
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
});

describe("mapTapChargeOutcome", () => {
  it("treats INITIATED as requires_action even without a URL", () => {
    expect(mapTapChargeOutcome("INITIATED", "pending", undefined)).toBe(
      "requires_action",
    );
  });

  it("treats CAPTURED as succeeded and DECLINED as declined", () => {
    expect(mapTapChargeOutcome("CAPTURED", "paid", undefined)).toBe("succeeded");
    expect(mapTapChargeOutcome("DECLINED", "failed", undefined)).toBe("declined");
  });

  it("does not treat UNKNOWN as paid", () => {
    expect(mapTapChargeOutcome("UNKNOWN", "failed", undefined)).toBe("failed");
  });
});

describe("mapTapRefundEntityStatus", () => {
  it("maps refund object statuses", () => {
    expect(mapTapRefundEntityStatus("REFUNDED")).toBe("completed");
    expect(mapTapRefundEntityStatus("PENDING")).toBe("pending");
    expect(mapTapRefundEntityStatus("IN PROGRESS")).toBe("pending");
    expect(mapTapRefundPaymentStatus("REFUNDED")).toBe("refunded");
  });
});
