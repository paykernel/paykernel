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

  it("P22-FREEZE-LIST: disputes and paymentMethods in-place nested mutation does not poison original or restored result", () => {
    const original = {
      success: true,
      status: "completed",
      disputes: [{ id: "dp_1", amount: 100, currency: "USD" }],
      paymentMethods: [{ id: "pm_1", type: "card" }],
    };

    const freeze = shallowCloneResult(original);
    expect(freeze.disputes).not.toBe(original.disputes);
    expect(freeze.disputes[0]).not.toBe(original.disputes[0]);
    expect(freeze.paymentMethods).not.toBe(original.paymentMethods);
    expect(freeze.paymentMethods[0]).not.toBe(original.paymentMethods[0]);

    freeze.disputes[0].amount = 999;
    freeze.paymentMethods[0].id = "pm_forged";
    expect(original.disputes[0].amount).toBe(100);
    expect(original.paymentMethods[0].id).toBe("pm_1");

    const restoredInPlace = restoreMoneyIdentityFields(original, freeze);
    expect(restoredInPlace.disputes[0].amount).toBe(100);
    expect(restoredInPlace.disputes[0].id).toBe("dp_1");
    expect(restoredInPlace.paymentMethods[0].id).toBe("pm_1");
    expect(restoredInPlace.disputes).not.toBe(freeze.disputes);
    expect(restoredInPlace.disputes[0]).not.toBe(freeze.disputes[0]);
    expect(restoredInPlace.paymentMethods).not.toBe(freeze.paymentMethods);
    expect(restoredInPlace.paymentMethods[0]).not.toBe(
      freeze.paymentMethods[0],
    );
    expect(restoredInPlace.disputes).not.toBe(original.disputes);
    expect(restoredInPlace.disputes[0]).not.toBe(original.disputes[0]);
    expect(restoredInPlace.paymentMethods).not.toBe(original.paymentMethods);
    expect(restoredInPlace.paymentMethods[0]).not.toBe(
      original.paymentMethods[0],
    );

    freeze.disputes[0].amount = 888;
    freeze.paymentMethods[0].id = "pm_after";
    expect(restoredInPlace.disputes[0].amount).toBe(100);
    expect(restoredInPlace.paymentMethods[0].id).toBe("pm_1");
    expect(original.disputes[0].amount).toBe(100);
    expect(original.paymentMethods[0].id).toBe("pm_1");
  });

  it("P22-FREEZE-LIST: hook-replaced disputes and paymentMethods arrays are restored from original via deep clone", () => {
    const original = {
      success: true,
      status: "completed",
      disputes: [{ id: "dp_1", amount: 100, currency: "USD" }],
      paymentMethods: [{ id: "pm_1", type: "card" }],
    };

    const hookReplaced = {
      ...shallowCloneResult(original),
      disputes: [{ id: "dp_evil", amount: 1, currency: "USD" }],
      paymentMethods: [{ id: "pm_evil", type: "card" }],
    };

    const restored = restoreMoneyIdentityFields(original, hookReplaced);
    expect(restored.disputes).toEqual([
      { id: "dp_1", amount: 100, currency: "USD" },
    ]);
    expect(restored.paymentMethods).toEqual([{ id: "pm_1", type: "card" }]);
    expect(restored.disputes).not.toBe(original.disputes);
    expect(restored.disputes).not.toBe(hookReplaced.disputes);
    expect(restored.disputes[0]).not.toBe(original.disputes[0]);
    expect(restored.disputes[0]).not.toBe(hookReplaced.disputes[0]);
    expect(restored.paymentMethods).not.toBe(original.paymentMethods);
    expect(restored.paymentMethods).not.toBe(hookReplaced.paymentMethods);
    expect(restored.paymentMethods[0]).not.toBe(original.paymentMethods[0]);
    expect(restored.paymentMethods[0]).not.toBe(hookReplaced.paymentMethods[0]);

    hookReplaced.disputes[0].amount = 777;
    hookReplaced.paymentMethods[0].id = "pm_after";
    restored.disputes[0].amount = 555;
    restored.paymentMethods[0].id = "pm_mutated";
    expect(original.disputes[0].amount).toBe(100);
    expect(original.paymentMethods[0].id).toBe("pm_1");
  });
});
