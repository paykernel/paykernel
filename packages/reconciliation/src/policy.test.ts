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
    // Keep/mark path — not a paid upgrade (approved is not paid-like)
    expect(d1.action).toBe("mark_consistent");

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
});
