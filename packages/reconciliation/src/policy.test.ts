import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import {
  decideReconciliationPolicy,
  shouldForbidReplacementCharge,
} from "./policy";
import {
  buildProviderPaymentSnapshot,
  type ReconciliationResult,
  type ReconciliationTarget,
} from "./types";

const money = (amount: string, currency: string): Money => ({ amount, currency });

const paidProvider = buildProviderPaymentSnapshot({
  gatewayPaymentId: "pi_1",
  status: "paid",
  amount: money("10.00", "USD"),
  providerStatus: "succeeded",
});

const failedProvider = buildProviderPaymentSnapshot({
  gatewayPaymentId: "pi_1",
  status: "failed",
  amount: money("10.00", "USD"),
  providerStatus: "failed",
});

describe("decideReconciliationPolicy", () => {
  it("consistent + matching paid → mark_consistent when local already paid", () => {
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: paidProvider,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "paid" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("mark_consistent");
    expect(d.safe).toBe(true);
  });

  it("A1: indeterminate local + provider paid → update_local_to_paid", () => {
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: paidProvider,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("update_local_to_paid");
    if (d.action === "update_local_to_paid") {
      expect(d.safe).toBe(true);
      expect(d.provider.gatewayPaymentId).toBe("pi_1");
    }
  });

  it("status-only drift pending→paid → update_local_to_paid", () => {
    const result: ReconciliationResult = {
      outcome: "drift_detected",
      provider: paidProvider,
      differences: [
        { field: "status", local: "pending", provider: "paid" },
      ],
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("update_local_to_paid");
  });

  it("indeterminate + definitive failed → update_local_to_failed", () => {
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: failedProvider,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("update_local_to_failed");
  });

  it("RECON-1: non-zero captured + failed provider is not safe update_local_to_failed", () => {
    const failedWithCapture = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "failed",
      amount: money("10.00", "USD"),
      capturedAmount: money("10.00", "USD"),
      providerStatus: "failed",
    });
    for (const outcome of ["consistent", "drift_detected"] as const) {
      const result: ReconciliationResult =
        outcome === "consistent"
          ? { outcome: "consistent", provider: failedWithCapture }
          : {
              outcome: "drift_detected",
              provider: failedWithCapture,
              differences: [
                { field: "status", local: "pending", provider: "failed" },
              ],
            };
      const target: ReconciliationTarget = {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        expected: { status: "pending" },
      };
      const d = decideReconciliationPolicy(result, target);
      expect(d.action).not.toBe("update_local_to_failed");
      expect(d.safe).toBe(false);
      if (outcome === "consistent") {
        expect(d.action).toBe("manual_review");
      } else {
        expect(d.action).toBe("apply_drift_review");
      }
      // Replacement create must also be forbidden while funds moved.
      expect(shouldForbidReplacementCharge(result, target)).toBe(true);
    }
  });

  it("RECON-1: non-zero refundedAmount + failed provider is not safe update_local_to_failed", () => {
    const failedWithRefund = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "failed",
      amount: money("10.00", "USD"),
      refundedAmount: money("3.00", "USD"),
      providerStatus: "failed",
    });
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: failedWithRefund,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("manual_review");
    expect(d.safe).toBe(false);
    expect(shouldForbidReplacementCharge(result, target)).toBe(true);
  });

  it("RECON-1: zero captured/refunded still allows safe update_local_to_failed", () => {
    const failedZeroMoney = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "failed",
      amount: money("10.00", "USD"),
      capturedAmount: money("0", "USD"),
      refundedAmount: money("0.00", "USD"),
      providerStatus: "failed",
    });
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: failedZeroMoney,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("update_local_to_failed");
    if (d.action === "update_local_to_failed") {
      expect(d.safe).toBe(true);
    }
  });

  it("RECON-2: paid + non-zero refundedAmount is not safe update_local_to_paid", () => {
    const paidWithRefund = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "paid",
      amount: money("10.00", "USD"),
      refundedAmount: money("2.00", "USD"),
      providerStatus: "succeeded",
    });
    for (const outcome of ["consistent", "drift_detected"] as const) {
      const result: ReconciliationResult =
        outcome === "consistent"
          ? { outcome: "consistent", provider: paidWithRefund }
          : {
              outcome: "drift_detected",
              provider: paidWithRefund,
              differences: [
                { field: "status", local: "pending", provider: "paid" },
              ],
            };
      const target: ReconciliationTarget = {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        expected: { status: "pending" },
      };
      const d = decideReconciliationPolicy(result, target);
      expect(d.action).not.toBe("update_local_to_paid");
      expect(d.safe).toBe(false);
    }
  });

  it("amount drift → apply_drift_review never auto-mutate money", () => {
    const result: ReconciliationResult = {
      outcome: "drift_detected",
      provider: paidProvider,
      differences: [
        {
          field: "amount",
          local: money("9.00", "USD"),
          provider: money("10.00", "USD"),
        },
      ],
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "paid", amount: money("9.00", "USD") },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("apply_drift_review");
    expect(d.safe).toBe(false);
  });

  it("ambiguous_match → manual_review and forbids replacement", () => {
    const result: ReconciliationResult = {
      outcome: "ambiguous_match",
      matches: [paidProvider, paidProvider],
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("manual_review");
    expect(d.safe).toBe(false);
    expect(shouldForbidReplacementCharge(result, target)).toBe(true);
  });

  it("temporarily_unavailable → retry_later", () => {
    const result: ReconciliationResult = {
      outcome: "temporarily_unavailable",
      retryAfterMs: 1000,
    };
    const d = decideReconciliationPolicy(result, { gateway: "stripe" });
    expect(d.action).toBe("retry_later");
    if (d.action === "retry_later") {
      expect(d.retryAfterMs).toBe(1000);
    }
  });

  it("provider_not_found retryable + indeterminate → do_not_create_replacement", () => {
    const result: ReconciliationResult = {
      outcome: "provider_not_found",
      retryable: true,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("do_not_create_replacement");
  });

  it("provider approved (pre-capture) must NOT yield update_local_to_paid", () => {
    const approvedProvider = buildProviderPaymentSnapshot({
      gatewayPaymentId: "ORDER-APPROVED",
      status: "approved",
      amount: money("10.00", "USD"),
      providerStatus: "APPROVED",
    });

    const consistent: ReconciliationResult = {
      outcome: "consistent",
      provider: approvedProvider,
    };
    const pendingLocal: ReconciliationTarget = {
      gateway: "paypal",
      expected: { status: "pending" },
    };
    const d1 = decideReconciliationPolicy(consistent, pendingLocal);
    expect(d1.action).not.toBe("update_local_to_paid");
    // Sparse/indeterminate + open incomplete provider → manual_review (not mark_consistent)
    expect(d1.action).toBe("manual_review");
    expect(d1.safe).toBe(false);

    const drift: ReconciliationResult = {
      outcome: "drift_detected",
      provider: approvedProvider,
      differences: [
        { field: "status", local: "pending", provider: "approved" },
      ],
    };
    const d2 = decideReconciliationPolicy(drift, pendingLocal);
    expect(d2.action).not.toBe("update_local_to_paid");
    expect(d2.action).toBe("apply_drift_review");
  });

  it("sparse expected + open incomplete provider is not mark_consistent", () => {
    for (const status of [
      "authorized",
      "approved",
      "partially_captured",
      "processing",
      "refunded",
      "partially_refunded",
      "refund_pending",
      "refund_failed",
      "refund_completed",
      "setup_completed",
      "reversed",
    ] as const) {
      const provider = buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_open",
        status,
        amount: money("10.00", "USD"),
        providerStatus: status,
      });
      const result: ReconciliationResult = {
        outcome: "consistent",
        provider,
      };
      // No expected status (sparse)
      const d = decideReconciliationPolicy(result, {
        gateway: "stripe",
        gatewayPaymentId: "pi_open",
      });
      expect(d.action).toBe("manual_review");
      expect(d.safe).toBe(false);
      expect(d.action).not.toBe("mark_consistent");
    }
  });

  it("RECON-2: indeterminate local + provider refund lifecycle is not mark_consistent safe", () => {
    for (const status of [
      "refund_pending",
      "refund_failed",
      "refund_completed",
      "setup_completed",
    ] as const) {
      const provider = buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_refund_inflight",
        status,
        amount: money("10.00", "USD"),
        providerStatus: status,
      });
      const result: ReconciliationResult = {
        outcome: "consistent",
        provider,
      };
      const d = decideReconciliationPolicy(result, {
        gateway: "stripe",
        gatewayPaymentId: "pi_refund_inflight",
        expected: { status: "pending" },
      });
      expect(d.action).toBe("manual_review");
      expect(d.safe).toBe(false);
      expect(d.action).not.toBe("mark_consistent");
    }
  });

  it("RECON-1: wrong-payment identity blocks update_local_to_paid", () => {
    const wrongProvider = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_B",
      status: "paid",
      amount: money("10.00", "USD"),
      providerStatus: "succeeded",
    });
    const result: ReconciliationResult = {
      outcome: "drift_detected",
      provider: wrongProvider,
      differences: [
        { field: "status", local: "pending", provider: "paid" },
        {
          field: "gatewayPaymentId",
          local: "pi_A",
          provider: "pi_B",
          message: "gatewayPaymentId mismatch",
        },
      ],
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_A",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).not.toBe("update_local_to_paid");
    expect(d.action).toBe("apply_drift_review");
    expect(d.safe).toBe(false);
  });

  it("RECON-4: authorized/partially_captured → paid is not safe auto-upgrade", () => {
    for (const localStatus of ["authorized", "partially_captured"] as const) {
      const result: ReconciliationResult = {
        outcome: "drift_detected",
        provider: paidProvider,
        differences: [
          { field: "status", local: localStatus, provider: "paid" },
        ],
      };
      const target: ReconciliationTarget = {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        expected: { status: localStatus },
      };
      const d = decideReconciliationPolicy(result, target);
      expect(d.action).toBe("apply_drift_review");
      expect(d.safe).toBe(false);
      expect(d.action).not.toBe("update_local_to_paid");
    }
  });
});

describe("shouldForbidReplacementCharge", () => {
  it("true for ambiguous and indeterminate not-found", () => {
    expect(
      shouldForbidReplacementCharge(
        { outcome: "ambiguous_match", matches: [] },
        { gateway: "s", expected: { status: "pending" } },
      ),
    ).toBe(true);
    expect(
      shouldForbidReplacementCharge(
        { outcome: "provider_not_found", retryable: true },
        { gateway: "s", expected: { status: "pending" } },
      ),
    ).toBe(true);
  });

  it("forbids open money locals (auth/approved/partial/paid) and provider_not_found", () => {
    const consistentPaid: ReconciliationResult = {
      outcome: "consistent",
      provider: paidProvider,
    };
    for (const status of [
      "authorized",
      "approved",
      "partially_captured",
      "partially_refunded",
      "paid",
      "refunded",
      "refund_pending",
      "refund_failed",
      "refund_completed",
      "setup_completed",
      "reversed",
    ] as const) {
      expect(
        shouldForbidReplacementCharge(consistentPaid, {
          gateway: "s",
          expected: { status },
        }),
      ).toBe(true);
    }
    // provider_not_found forbids even when local looks failed (original may exist)
    expect(
      shouldForbidReplacementCharge(
        { outcome: "provider_not_found", retryable: true },
        { gateway: "s", expected: { status: "failed" } },
      ),
    ).toBe(true);
    // RECON-1: terminal failed local + provider paid/open still forbids replacement
    // (provider already holds a charge — dual createPayment risk).
    expect(
      shouldForbidReplacementCharge(consistentPaid, {
        gateway: "s",
        expected: { status: "failed" },
      }),
    ).toBe(true);
    // Terminal failed local + definitive failed provider leaves room for re-attempt.
    expect(
      shouldForbidReplacementCharge(
        { outcome: "consistent", provider: failedProvider },
        { gateway: "s", expected: { status: "failed" } },
      ),
    ).toBe(false);
  });

  it("RECON-1: refund_failed / refund_completed local forbids replacement charge", () => {
    // manual_review_required + refund_failed local must not allow a second charge
    // (original charge may still hold funds after a failed refund).
    for (const status of ["refund_failed", "refund_completed"] as const) {
      const result: ReconciliationResult = {
        outcome: "manual_review_required",
        reason: "incomplete snapshot",
      };
      const target: ReconciliationTarget = {
        gateway: "stripe",
        expected: { status },
      };
      expect(shouldForbidReplacementCharge(result, target)).toBe(true);
    }
  });

  it("RECON-1: consistent local+provider refund_pending forbids replacement charge", () => {
    const refundPendingProvider = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "refund_pending",
      amount: money("10.00", "USD"),
      providerStatus: "pending",
    });
    const result: ReconciliationResult = {
      outcome: "consistent",
      provider: refundPendingProvider,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
      expected: { status: "refund_pending" },
    };
    expect(shouldForbidReplacementCharge(result, target)).toBe(true);
    // Provider open-incomplete alone also forbids even if local looks terminal failed.
    expect(
      shouldForbidReplacementCharge(result, {
        gateway: "stripe",
        expected: { status: "failed" },
      }),
    ).toBe(true);
  });

  it("RECON-2: provider_not_found always surfaces do_not_create_replacement", () => {
    const result: ReconciliationResult = {
      outcome: "provider_not_found",
      retryable: true,
    };
    for (const status of [
      "paid",
      "authorized",
      "refund_pending",
      "pending",
      "failed",
      "cancelled",
    ] as const) {
      const d = decideReconciliationPolicy(result, {
        gateway: "stripe",
        expected: { status },
      });
      // RECON-2: never bare retry_later — action-only switches must not recreate.
      expect(d.action).toBe("do_not_create_replacement");
      expect(d.safe).toBe(false);
      expect(
        shouldForbidReplacementCharge(result, {
          gateway: "s",
          expected: { status },
        }),
      ).toBe(true);
    }
    // Sparse expected (no local status) also forbids replacement.
    const sparse = decideReconciliationPolicy(result, { gateway: "stripe" });
    expect(sparse.action).toBe("do_not_create_replacement");
  });
});
