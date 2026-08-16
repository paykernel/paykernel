/**
 * After-hook money-identity freeze (NEW-CORE-7).
 */
import { describe, it, expect } from "bun:test";
import {
  restoreMoneyIdentityFields,
  shallowCloneResult,
} from "./money-identity";

describe("money-identity freeze", () => {
  it("NEW-CORE-7: refundedAt is frozen and Dates are cloned", () => {
    const refundedAt = new Date("2026-01-01T00:00:00.000Z");
    const original = {
      success: true,
      status: "completed",
      totalRefunded: 10,
      refundedAt,
      gatewayRefundId: "re_1",
    };

    const freeze = shallowCloneResult(original);
    expect(freeze.refundedAt).toEqual(refundedAt);
    expect(freeze.refundedAt).not.toBe(refundedAt);

    freeze.refundedAt.setTime(0);
    expect(original.refundedAt.getTime()).toBe(
      new Date("2026-01-01T00:00:00.000Z").getTime(),
    );

    const hookForged = {
      ...freeze,
      refundedAt: new Date("2099-12-31T00:00:00.000Z"),
      totalRefunded: 999,
    };
    const restored = restoreMoneyIdentityFields(original, hookForged);
    expect(restored.totalRefunded).toBe(10);
    expect(restored.refundedAt).toEqual(refundedAt);
    expect(restored.refundedAt).not.toBe(original.refundedAt);
    expect(restored.refundedAt).not.toBe(hookForged.refundedAt);

    // Hook cannot introduce refundedAt the gateway never set.
    const stripped = restoreMoneyIdentityFields(
      { success: true, status: "completed" },
      { success: true, status: "completed", refundedAt: new Date() },
    );
    expect(
      (stripped as { refundedAt?: Date }).refundedAt,
    ).toBeUndefined();
  });
});
