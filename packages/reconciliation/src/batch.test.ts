import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import { createPaymentReconciler } from "./reconciler";
import type { ProviderLookupPort } from "./lookup";
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
    for await (const r of reconciler.reconcileMany(targets, {
      concurrency: 3,
    })) {
      results.push(r);
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
});
