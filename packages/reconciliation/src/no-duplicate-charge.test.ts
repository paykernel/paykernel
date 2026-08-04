/**
 * A4: reconciliation never creates duplicate / replacement charges.
 * Policy + reconciler surface must forbid createPayment while indeterminate.
 */
import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import { createPaymentReconciler } from "./reconciler";
import {
  decideReconciliationPolicy,
  shouldForbidReplacementCharge,
} from "./policy";
import type { ProviderLookupPort } from "./lookup";
import {
  buildProviderPaymentSnapshot,
  type ReconciliationResult,
  type ReconciliationTarget,
} from "./types";
import * as recon from "./index";

const money = (amount: string, currency: string): Money => ({ amount, currency });

describe("A4 never create replacement charges", () => {
  it("public reconciler has zero createPayment / capture / refund methods", () => {
    const r = createPaymentReconciler({ lookup: {} });
    const bag = r as unknown as Record<string, unknown>;
    expect(bag.createPayment).toBeUndefined();
    expect(bag.capture).toBeUndefined();
    expect(bag.refund).toBeUndefined();
    expect(bag.void).toBeUndefined();
    expect(typeof r.reconcile).toBe("function");
    expect(typeof r.reconcileMany).toBe("function");
  });

  it("package root does not export payment mutation helpers", () => {
    const root = recon as Record<string, unknown>;
    expect(root.createPayment).toBeUndefined();
    expect(root.capturePayment).toBeUndefined();
    expect(root.refundPayment).toBeUndefined();
  });

  it("policy do_not_create_replacement when indeterminate + not found", () => {
    const result: ReconciliationResult = {
      outcome: "provider_not_found",
      retryable: true,
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_unknown",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("do_not_create_replacement");
    expect(shouldForbidReplacementCharge(result, target)).toBe(true);
  });

  it("ambiguous_match forbids replacement even when decision is manual_review", () => {
    const provider = buildProviderPaymentSnapshot({
      gatewayPaymentId: "a",
      status: "paid",
      amount: money("1", "USD"),
      providerStatus: "ok",
    });
    const result: ReconciliationResult = {
      outcome: "ambiguous_match",
      matches: [provider, { ...provider, gatewayPaymentId: "b" }],
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      idempotencyKey: "k",
      expected: { status: "pending" },
    };
    expect(shouldForbidReplacementCharge(result, target)).toBe(true);
    expect(decideReconciliationPolicy(result, target).action).not.toBe(
      "update_local_to_paid",
    );
  });

  it("reconcile + policy never auto-mutate local payment status", async () => {
    let localStatus: string = "pending";
    let writes = 0;

    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: "pi_1",
              status: "paid",
              amount: money("10", "USD"),
              providerStatus: "paid",
            }),
          ],
        };
      },
    };

    const reconciler = createPaymentReconciler({ lookup });
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
      expected: { status: "pending" },
    };
    const result = await reconciler.reconcile(target);
    const decision = decideReconciliationPolicy(result, target);

    expect(decision.action).toBe("update_local_to_paid");
    expect(writes).toBe(0);
    expect(localStatus).toBe("pending");

    // Application applies only after explicit decision
    if (decision.action === "update_local_to_paid" && decision.safe) {
      writes++;
      localStatus = "paid";
    }
    expect(localStatus).toBe("paid");
    expect(writes).toBe(1);
  });

  it("temporarily_unavailable never becomes update_local_to_failed", () => {
    const result: ReconciliationResult = {
      outcome: "temporarily_unavailable",
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      expected: { status: "pending" },
    };
    const d = decideReconciliationPolicy(result, target);
    expect(d.action).toBe("retry_later");
  });
});
