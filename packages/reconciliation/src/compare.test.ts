import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import { compareSnapshots, moneyEquals } from "./compare";
import { buildProviderPaymentSnapshot } from "./types";

const money = (amount: string, currency: string): Money => ({ amount, currency });

const provider = buildProviderPaymentSnapshot({
  gatewayPaymentId: "pi_1",
  status: "paid",
  amount: money("10.00", "USD"),
  capturedAmount: money("10.00", "USD"),
  refundedAmount: money("0.00", "USD"),
  providerStatus: "succeeded",
});

describe("compareSnapshots (A2 machine-readable fields)", () => {
  it("returns empty when local undefined", () => {
    expect(compareSnapshots(undefined, provider)).toEqual([]);
  });

  it("returns empty when all present fields match", () => {
    expect(
      compareSnapshots(
        {
          status: "paid",
          amount: money("10.00", "USD"),
          capturedAmount: money("10.00", "USD"),
        },
        provider,
      ),
    ).toEqual([]);
  });

  it("emits status field path on mismatch", () => {
    const diffs = compareSnapshots({ status: "pending" }, provider);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("status");
    expect(diffs[0]!.local).toBe("pending");
    expect(diffs[0]!.provider).toBe("paid");
  });

  it("emits amount field path on money mismatch", () => {
    const diffs = compareSnapshots(
      { amount: money("9.00", "USD") },
      provider,
    );
    expect(diffs.some((d) => d.field === "amount")).toBe(true);
  });

  it("currency is case-sensitive", () => {
    expect(moneyEquals(money("1", "usd"), money("1", "USD"))).toBe(false);
    const diffs = compareSnapshots(
      { amount: money("10.00", "usd") },
      provider,
    );
    expect(diffs.some((d) => d.field === "amount")).toBe(true);
  });

  it("emits capturedAmount and refundedAmount paths", () => {
    const diffs = compareSnapshots(
      {
        capturedAmount: money("5.00", "USD"),
        refundedAmount: money("1.00", "USD"),
      },
      provider,
    );
    expect(diffs.map((d) => d.field).sort()).toEqual([
      "capturedAmount",
      "refundedAmount",
    ]);
  });
});
