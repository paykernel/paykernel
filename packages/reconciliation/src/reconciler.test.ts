import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import { createPaymentReconciler } from "./reconciler";
import type { ProviderLookupPort } from "./lookup";
import {
  buildProviderPaymentSnapshot,
  type ReconciliationTarget,
} from "./types";
import { decideReconciliationPolicy } from "./policy";

const money = (amount: string, currency: string): Money => ({ amount, currency });

describe("createPaymentReconciler", () => {
  it("indeterminate local + provider paid yields update_local_to_paid decision", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: "pi_1",
              status: "paid",
              amount: money("25.00", "SAR"),
              providerStatus: "paid",
            }),
          ],
        };
      },
    };

    const reconciler = createPaymentReconciler({ lookup });
    const target: ReconciliationTarget = {
      gateway: "moyasar",
      gatewayPaymentId: "pi_1",
      expected: { status: "pending", amount: money("25.00", "SAR") },
    };

    const result = await reconciler.reconcile(target);
    // pending vs paid → drift_detected on status (amount matches)
    expect(result.outcome).toBe("drift_detected");

    const decision = decideReconciliationPolicy(result, target);
    expect(decision.action).toBe("update_local_to_paid");
    expect(decision.safe).toBe(true);
  });

  it("maps unavailable to temporarily_unavailable never failed", async () => {
    const reconciler = createPaymentReconciler({
      lookup: {
        async findByPaymentId() {
          return { kind: "unavailable" };
        },
      },
    });
    const result = await reconciler.reconcile({
      gateway: "stripe",
      gatewayPaymentId: "pi_x",
    });
    expect(result.outcome).toBe("temporarily_unavailable");
  });

  it("empty reconcileMany yields nothing", async () => {
    const reconciler = createPaymentReconciler({ lookup: {} });
    const yielded: unknown[] = [];
    for await (const r of reconciler.reconcileMany([])) {
      yielded.push(r);
    }
    expect(yielded).toEqual([]);
  });
});
