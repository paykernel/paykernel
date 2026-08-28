/**
 * Phase 6 acceptance locks — scenarios not already covered by
 * `operation-result.test.ts` unit helpers.
 *
 * Unique coverage:
 * - Exhaustive PaymentOperationResult switch (all 5 arms)
 * - Cross-gateway representative create shapes (table)
 * - RefundOperationResult mapping
 * - Money/AmountInput regression on CommonPaymentInput
 */
import { describe, it, expect } from "bun:test";
import type {
  CommonPaymentInput,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentOperationResult,
  RefundOperationResult,
} from "../index";
import {
  mapGatewayResultToOperationResult,
  mapGatewayRefundToOperationResult,
  applyOutcomeToGatewayResult,
  inferOperationOutcome,
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  
  buildProviderReferences,
  money,
  toMinorUnits,
  fromMinorUnits,
  normalizeAmountInput,
  type AmountInput,
} from "../index";

function basePayment(
  overrides: Partial<GatewayPaymentResult> = {},
): GatewayPaymentResult {
  return {
    success: true,
    gatewayId: "pay_1",
    status: "paid",
    redirectUrl: undefined,
    rawResponse: {},
    ...overrides,
  };
}

describe("AC1: PaymentOperationResult exhaustiveness", () => {
  it("switch covers all outcomes and forces reconciliationRequired on indeterminate", () => {
    function label(result: PaymentOperationResult): string {
      switch (result.outcome) {
        case "succeeded":
          return `paid-ish:${result.payment.status}`;
        case "requires_action":
          return `action:${result.action.type}`;
        case "declined":
          return `declined:${result.failure.code}`;
        case "failed":
          return `failed:${result.error.code}`;
        case "indeterminate": {
          expect(result.reconciliationRequired).toBe(true);
          return "indeterminate";
        }
        default: {
          const _exhaustive: never = result;
          return String(_exhaustive);
        }
      }
    }

    const arms: PaymentOperationResult[] = [
      {
        outcome: "succeeded",
        payment: {
          status: "paid",
          references: buildProviderReferences({
            gateway: "stripe",
            gatewayId: "pi_1",
            status: "paid",
          }),
        },
      },
      {
        outcome: "requires_action",
        payment: {
          status: "pending",
          references: buildProviderReferences({
            gateway: "moyasar",
            gatewayId: "pay_1",
            status: "pending",
          }),
        },
        action: { type: "redirect", url: "https://3ds" },
      },
      {
        outcome: "declined",
        failure: { code: "card_declined", message: "Declined" },
      },
      {
        outcome: "failed",
        error: {
          name: "PaymentError",
          message: "fail",
          code: "PAYMENT_FAILED",
        },
      },
      {
        outcome: "indeterminate",
        reconciliationRequired: true,
      },
    ];

    expect(arms.map(label)).toEqual([
      "paid-ish:paid",
      "action:redirect",
      "declined:card_declined",
      "failed:PAYMENT_FAILED",
      "indeterminate",
    ]);
  });
});

describe("AC6: cross-gateway outcome consistency on create shapes", () => {
  type Case = {
    gateway: "stripe" | "moyasar" | "paypal" | "paymob";
    name: string;
    result: GatewayPaymentResult;
    expectedOutcome: PaymentOperationResult["outcome"];
    paid: boolean;
  };

  const cases: Case[] = [
    {
      gateway: "stripe",
      name: "paid PaymentIntent",
      result: basePayment({
        success: true,
        status: "paid",
        gatewayId: "pi_stripe_paid",
        clientSecret: "pi_stripe_paid_secret",
      }),
      expectedOutcome: "succeeded",
      paid: true,
    },
    {
      gateway: "stripe",
      name: "requires_action via clientSecret pending",
      result: basePayment({
        success: true,
        status: "pending",
        gatewayId: "pi_stripe_3ds",
        clientSecret: "pi_stripe_3ds_secret",
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "moyasar",
      name: "3DS redirect initiated",
      result: basePayment({
        success: true,
        status: "pending",
        gatewayId: "pay_moyasar_3ds",
        redirectUrl: "https://moyasar.test/3ds",
        nextAction: {
          type: "redirect",
          url: "https://moyasar.test/3ds",
        },
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "moyasar",
      name: "STC Pay OTP",
      result: basePayment({
        success: true,
        status: "pending",
        gatewayId: "pay_moyasar_stc",
        nextAction: {
          type: "stcpay_otp",
          transactionUrl: "https://moyasar.test/otp",
          method: "POST",
          parameter: "otp_value",
        },
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "paypal",
      name: "order created pending approval",
      result: basePayment({
        success: true,
        status: "pending",
        gatewayId: "ORDER-1",
        orderId: "ORDER-1",
        redirectUrl: "https://paypal.test/approve",
        nextAction: {
          type: "redirect",
          url: "https://paypal.test/approve",
        },
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "paypal",
      name: "captured order paid",
      result: basePayment({
        success: true,
        status: "paid",
        gatewayId: "ORDER-2",
        orderId: "ORDER-2",
        captureId: "CAP-2",
      }),
      expectedOutcome: "succeeded",
      paid: true,
    },
    {
      gateway: "paymob",
      name: "Intention create pending",
      result: basePayment({
        success: true,
        status: "pending",
        gatewayId: "int_paymob_1",
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "paymob",
      name: "paid transaction",
      result: basePayment({
        success: true,
        status: "paid",
        gatewayId: "txn_paymob_1",
      }),
      expectedOutcome: "succeeded",
      paid: true,
    },
    {
      gateway: "paymob",
      name: "bare partial capture is open money",
      result: basePayment({
        success: true,
        status: "partially_captured",
        gatewayId: "txn_paymob_partial",
      }),
      expectedOutcome: "requires_action",
      paid: false,
    },
    {
      gateway: "stripe",
      name: "success:false pending is not a failed decline",
      result: basePayment({
        success: false,
        status: "pending",
        gatewayId: "pi_stripe_unk",
      }),
      expectedOutcome: "indeterminate",
      paid: false,
    },
  ];

  for (const c of cases) {
    it(`${c.gateway}: ${c.name} → outcome=${c.expectedOutcome}, paid=${c.paid}`, () => {
      const op = mapGatewayResultToOperationResult(c.result, {
        gateway: c.gateway,
      });
      expect(op.outcome).toBe(c.expectedOutcome);
      expect(isPaidOutcome(c.result)).toBe(c.paid);
      expect(isPaidOutcome(op)).toBe(c.paid);
      if (c.expectedOutcome === "requires_action") {
        expect(c.result.success).toBe(true);
        expect(isPaidOutcome(c.result)).toBe(false);
      }
      if (op.outcome === "succeeded" || op.outcome === "requires_action") {
        expect(op.payment.references.gateway).toBe(c.gateway);
        expect(op.payment.references.providerObjectId).toBe(c.result.gatewayId);
      }
    });
  }
});

describe("P610-INF: infer fail-closed money / no dual-write lie", () => {
  it("bare partially_captured infers requires_action; settled-success statuses stay succeeded", () => {
    const bare = basePayment({
      success: true,
      status: "partially_captured",
      gatewayId: "cap_partial",
    });
    expect(inferOperationOutcome(bare)).toBe("requires_action");
    expect(isRequiresActionOutcome(bare)).toBe(true);
    expect(isPaidOutcome(bare)).toBe(false);

    expect(
      inferOperationOutcome(basePayment({ success: true, status: "paid" })),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        basePayment({ success: true, status: "authorized" }),
      ),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        basePayment({ success: true, status: "refunded" }),
      ),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        basePayment({ success: true, status: "partially_refunded" }),
      ),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        basePayment({ success: true, status: "setup_completed" }),
      ),
    ).toBe("succeeded");
    expect(
      isPaidOutcome(basePayment({ success: true, status: "setup_completed" })),
    ).toBe(false);
    expect(
      isPaidOutcome(basePayment({ success: true, status: "authorized" })),
    ).toBe(false);
  });

  it("S20-FAILED-DECLINED: bare status failed without decline is failed", () => {
    const rows: Array<[Partial<GatewayPaymentResult>, "failed" | "declined"]> = [
      [{ success: false, status: "failed", gatewayId: "pi_bare_fail" }, "failed"],
      [
        {
          success: false,
          status: "failed",
          gatewayId: "pi_declined",
          decline: { code: "card_declined", message: "nope" },
        },
        "declined",
      ],
    ];
    for (const [patch, outcome] of rows) {
      expect(inferOperationOutcome(basePayment(patch))).toBe(outcome);
    }
    const bare = basePayment({
      success: false,
      status: "failed",
      gatewayId: "pi_bare_fail",
    });
    expect(mapGatewayResultToOperationResult(bare).outcome).toBe("failed");
    expect(isPaidOutcome(bare)).toBe(false);
  });

  it("success:false + pending/processing/approved infers indeterminate", () => {
    for (const status of ["pending", "processing", "approved"] as const) {
      const result = basePayment({
        success: false,
        status,
        gatewayId: `unk_${status}`,
      });
      expect(inferOperationOutcome(result)).toBe("indeterminate");
      const op = mapGatewayResultToOperationResult(result);
      expect(op.outcome).toBe("indeterminate");
      if (op.outcome === "indeterminate") {
        expect(op.reconciliationRequired).toBe(true);
      }
      expect(isIndeterminateOutcome(result)).toBe(true);
      expect(isPaidOutcome(result)).toBe(false);
    }
  });

  it("applyOutcome stored outcome matches infer; recon only on indeterminate", () => {
    const appliedPartial = applyOutcomeToGatewayResult(
      {
        gatewayId: "cap_partial",
        status: "partially_captured",
        rawResponse: {},
        gateway: "paymob",
      },
      "requires_action",
    );
    expect(appliedPartial.outcome).toBe("requires_action");
    expect(appliedPartial.reconciliationRequired).toBeUndefined();
    expect(inferOperationOutcome(appliedPartial)).toBe(appliedPartial.outcome);

    const appliedPaid = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_paid",
        status: "paid",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
      { reconciliationRequired: true },
    );
    expect(appliedPaid.outcome).toBe("succeeded");
    expect(appliedPaid.reconciliationRequired).toBeUndefined();
    expect(inferOperationOutcome(appliedPaid)).toBe(appliedPaid.outcome);
    expect(isPaidOutcome(appliedPaid)).toBe(true);

    const appliedInd = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_unk",
        status: "pending",
        rawResponse: {},
        gateway: "stripe",
      },
      "indeterminate",
    );
    expect(appliedInd.outcome).toBe("indeterminate");
    expect(appliedInd.reconciliationRequired).toBe(true);
    expect(inferOperationOutcome(appliedInd)).toBe(appliedInd.outcome);
  });
});

describe("AC7: RefundOperationResult parallel mapping", () => {
  it("maps completed refund to succeeded", () => {
    const refund: GatewayRefundResult = {
      success: true,
      gatewayRefundId: "ref_1",
      status: "completed",
      totalRefunded: 10,
      rawResponse: {},
    };
    const op = mapGatewayRefundToOperationResult(refund);
    expect(op.outcome).toBe("succeeded");
    if (op.outcome !== "succeeded") throw new Error("expected succeeded");
    expect(op.refundId).toBe("ref_1");
    expect(op.status).toBe("completed");
    expect(op.totalRefunded).toBe(10);
    expect(successFromRefundOutcome("succeeded")).toBe(true);
  });

  it("maps pending refund without treating as terminal failure", () => {
    const refund: GatewayRefundResult = {
      success: true,
      gatewayRefundId: "ref_pending",
      status: "pending",
      rawResponse: {},
    };
    const op = mapGatewayRefundToOperationResult(refund);
    expect(op.outcome).toBe("pending");
    expect(successFromRefundOutcome("pending")).toBe(true);
  });

  it("maps indeterminate with reconciliationRequired: true literally", () => {
    const refund: GatewayRefundResult = {
      success: false,
      gatewayRefundId: "ref_unk",
      status: "pending",
      reconciliationRequired: true,
      providerRequestId: "req_ref",
      rawResponse: {},
    };
    const op: RefundOperationResult =
      mapGatewayRefundToOperationResult(refund);
    expect(op.outcome).toBe("indeterminate");
    if (op.outcome !== "indeterminate") {
      throw new Error("expected indeterminate");
    }
    expect(op.reconciliationRequired).toBe(true);
    const literal: true = op.reconciliationRequired;
    expect(literal).toBe(true);
    expect(op.providerRequestId).toBe("req_ref");
    expect(successFromRefundOutcome("indeterminate")).toBe(false);
  });

  it("maps failed refund", () => {
    const refund: GatewayRefundResult = {
      success: false,
      gatewayRefundId: "ref_fail",
      status: "failed",
      rawResponse: {},
    };
    const op = mapGatewayRefundToOperationResult(refund);
    expect(op.outcome).toBe("failed");
    if (op.outcome !== "failed") throw new Error("expected failed");
    expect(op.error.code).toBe("REFUND_FAILED");
  });

  it("uses dual-written outcome when present (map prefers explicit outcome)", () => {
    const dualWritten: GatewayRefundResult = {
      success: true,
      outcome: "succeeded",
      gatewayRefundId: "ref_dual",
      status: "completed",
      totalRefunded: 5,
      rawResponse: {},
    };
    const op = mapGatewayRefundToOperationResult(dualWritten);
    expect(op.outcome).toBe("succeeded");
    expect(successFromRefundOutcome(dualWritten.outcome!)).toBe(
      dualWritten.success,
    );

    // Explicit pending outcome wins even if status would otherwise map differently
    const pendingDual: GatewayRefundResult = {
      success: true,
      outcome: "pending",
      gatewayRefundId: "ref_pd",
      status: "pending",
      rawResponse: {},
    };
    expect(mapGatewayRefundToOperationResult(pendingDual).outcome).toBe(
      "pending",
    );
  });
});

describe("AC8: Money/AmountInput regression (no float money math)", () => {
  it("money() + toMinorUnits uses bigint path", () => {
    const m = money("10.50", "SAR");
    expect(toMinorUnits(m)).toBe(1050n);
    expect(fromMinorUnits(1050n, "SAR").amount).toBe("10.50");
  });

  it("AmountInput accepts number | Money via normalizeAmountInput", () => {
    const asNumber: AmountInput = 10.5;
    const asMoney: AmountInput = money("10.50", "SAR");
    const n = normalizeAmountInput(asNumber, "SAR");
    const m = normalizeAmountInput(asMoney, "SAR");
    expect(toMinorUnits(n)).toBe(1050n);
    expect(toMinorUnits(m)).toBe(1050n);
  });

  it("CommonPaymentInput.amount accepts Money without float * 100", () => {
    const input: CommonPaymentInput = {
      amount: money("99.99", "USD"),
      orderId: "ord_money",
    };
    const normalized = normalizeAmountInput(input.amount, "USD");
    expect(toMinorUnits(normalized)).toBe(9999n);
    expect(Number(toMinorUnits(normalized))).toBe(9999);
  });
});
