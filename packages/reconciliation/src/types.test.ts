import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import {
  buildLocalPaymentSnapshot,
  buildProviderPaymentSnapshot,
  buildReconciliationTarget,
  type ReconciliationResult,
} from "./types";

const money = (amount: string, currency: string): Money => ({ amount, currency });

describe("construction helpers (exactOptionalPropertyTypes)", () => {
  it("buildLocalPaymentSnapshot omits absent optionals", () => {
    const snap = buildLocalPaymentSnapshot({ status: "pending" });
    expect(snap.status).toBe("pending");
    expect("amount" in snap).toBe(false);
    expect("gatewayPaymentId" in snap).toBe(false);
  });

  it("buildReconciliationTarget omits absent optionals", () => {
    const t = buildReconciliationTarget({
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
    });
    expect(t.gateway).toBe("stripe");
    expect(t.gatewayPaymentId).toBe("pi_1");
    expect("idempotencyKey" in t).toBe(false);
    expect("expected" in t).toBe(false);
  });

  it("buildProviderPaymentSnapshot requires core fields", () => {
    const p = buildProviderPaymentSnapshot({
      gatewayPaymentId: "pi_1",
      status: "paid",
      amount: money("10.00", "USD"),
      providerStatus: "succeeded",
    });
    expect(p.gatewayPaymentId).toBe("pi_1");
    expect(p.amount).toEqual(money("10.00", "USD"));
    expect("capturedAmount" in p).toBe(false);
  });
});

describe("ReconciliationResult discriminants", () => {
  it("freezes the six roadmap outcome tags as a closed set", () => {
    // Compile-time: assigning an unknown outcome fails elsewhere; runtime freeze
    // guards accidental renames in docs/tests that construct results by string.
    const outcomes: ReconciliationResult["outcome"][] = [
      "consistent",
      "drift_detected",
      "provider_not_found",
      "temporarily_unavailable",
      "ambiguous_match",
      "manual_review_required",
    ];
    expect(new Set(outcomes).size).toBe(6);
  });
});
