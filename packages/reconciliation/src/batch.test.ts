import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import { createPaymentReconciler } from "./reconciler";
import type { ProviderLookupPort } from "./lookup";
import { decideReconciliationPolicy } from "./policy";
import { buildProviderPaymentSnapshot } from "./types";

const money = (amount: string, currency: string): Money => ({ amount, currency });

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("reconcileMany concurrency", () => {
  it("does not exceed concurrency limit with slow lookup", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const lookup: ProviderLookupPort = {
      async findByPaymentId(_g, id) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(40);
        inFlight--;
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: id,
              status: "paid",
              amount: money("1.00", "USD"),
              providerStatus: "ok",
            }),
          ],
        };
      },
    };

    const reconciler = createPaymentReconciler({ lookup });
    const targets = Array.from({ length: 12 }, (_, i) => ({
      gateway: "stripe",
      gatewayPaymentId: `pi_${i}`,
    }));

    const results = [];
    for await (const item of reconciler.reconcileMany(targets, {
      concurrency: 3,
    })) {
      results.push(item);
    }

    expect(results).toHaveLength(12);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("default concurrency is bounded (not unlimited Promise.all)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const lookup: ProviderLookupPort = {
      async findByPaymentId(_g, id) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight--;
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: id,
              status: "paid",
              amount: money("1.00", "USD"),
              providerStatus: "ok",
            }),
          ],
        };
      },
    };

    const reconciler = createPaymentReconciler({ lookup });
    const targets = Array.from({ length: 15 }, (_, i) => ({
      gateway: "stripe",
      gatewayPaymentId: `pi_${i}`,
    }));

    let count = 0;
    for await (const _ of reconciler.reconcileMany(targets)) {
      count++;
    }
    expect(count).toBe(15);
    // default concurrency 5
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it("RECON-1: yields index + target under completion-order concurrency", async () => {
    // Slow ids finish later so completion order ≠ input order.
    const delays: Record<string, number> = {
      pi_fast: 5,
      pi_mid: 30,
      pi_slow: 60,
    };
    const lookup: ProviderLookupPort = {
      async findByPaymentId(_g, id) {
        await delay(delays[id] ?? 10);
        if (id === "pi_missing") {
          return { kind: "not_found" };
        }
        if (id === "pi_down") {
          return { kind: "unavailable" };
        }
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: id,
              status: "paid",
              amount: money("1.00", "USD"),
              providerStatus: "ok",
            }),
          ],
        };
      },
    };

    const reconciler = createPaymentReconciler({ lookup });
    const targets = [
      { gateway: "stripe", gatewayPaymentId: "pi_slow", localReference: "ord-0" },
      { gateway: "stripe", gatewayPaymentId: "pi_missing", localReference: "ord-1" },
      { gateway: "stripe", gatewayPaymentId: "pi_fast", localReference: "ord-2" },
      { gateway: "stripe", gatewayPaymentId: "pi_down", localReference: "ord-3" },
    ];

    const items = [];
    for await (const item of reconciler.reconcileMany(targets, {
      concurrency: 4,
    })) {
      items.push(item);
    }

    expect(items).toHaveLength(4);
    // Completion order: fast before slow (not input order).
    expect(items[0]?.target.gatewayPaymentId).toBe("pi_fast");
    expect(items[0]?.index).toBe(2);

    const byIndex = new Map(items.map((i) => [i.index, i]));
    expect(byIndex.get(0)?.target).toBe(targets[0]);
    expect(byIndex.get(0)?.result.outcome).toBe("consistent");
    expect(byIndex.get(1)?.target).toBe(targets[1]);
    expect(byIndex.get(1)?.result.outcome).toBe("provider_not_found");
    expect(byIndex.get(2)?.target).toBe(targets[2]);
    expect(byIndex.get(2)?.result.outcome).toBe("consistent");
    expect(byIndex.get(3)?.target).toBe(targets[3]);
    expect(byIndex.get(3)?.result.outcome).toBe("temporarily_unavailable");

    // Policy can be applied with the correlated target (not a wrong sibling).
    const notFound = byIndex.get(1)!;
    const decision = decideReconciliationPolicy(notFound.result, notFound.target);
    expect(decision.action).toBe("do_not_create_replacement");
  });
});
