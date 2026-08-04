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
