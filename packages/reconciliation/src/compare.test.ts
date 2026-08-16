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

describe("moneyEquals", () => {
  // N5 regression: decimal spelling must not produce false drift.
  it.each([
    ["10", "10.00", "USD"],
    ["10.0", "10.00", "USD"],
    ["10.00", "10.00", "USD"],
    ["0", "0.00", "USD"],
    ["1.25", "1.250", "KWD"],
  ] as const)(
    "treats %s and %s as equal for %s (same minor units)",
    (left, right, currency) => {
      expect(moneyEquals(money(left, currency), money(right, currency))).toBe(
        true,
      );
    },
  );

  it.each([
    ["10", "10.01", "USD", "USD"],
    ["10.00", "10.00", "USD", "EUR"],
    // USD exponent 2 → excess precision is fail-closed unequal
    ["10.001", "10.00", "USD", "USD"],
  ] as const)(
    "rejects %s %s vs %s %s",
    (leftAmt, rightAmt, leftCur, rightCur) => {
      expect(
        moneyEquals(money(leftAmt, leftCur), money(rightAmt, rightCur)),
      ).toBe(false);
    },
  );

  // RECON-6: ISO currency codes are case-insensitive
  it("treats currency case as insignificant", () => {
    expect(moneyEquals(money("1", "usd"), money("1", "USD"))).toBe(true);
    expect(moneyEquals(money("10.00", "Usd"), money("10", "USD"))).toBe(true);
  });
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

  it("does not flag amount when only decimal spelling differs (N5)", () => {
    const diffs = compareSnapshots(
      { amount: money("10", "USD") },
      provider,
    );
    expect(diffs).toEqual([]);
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

  it("currency case does not produce amount drift (RECON-6)", () => {
    expect(moneyEquals(money("1", "usd"), money("1", "USD"))).toBe(true);
    const diffs = compareSnapshots(
      { amount: money("10.00", "usd") },
      provider,
    );
    expect(diffs.some((d) => d.field === "amount")).toBe(false);
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

  it("surfaces provider capture vs local amount when local omitted capturedAmount", () => {
    const diffs = compareSnapshots(
      { amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_1",
        status: "paid",
        amount: money("10.00", "USD"),
        capturedAmount: money("4.00", "USD"),
        providerStatus: "succeeded",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(true);
  });

  it("RECON-1: auth-hold authorized + amount vs capturedAmount 0 is not drift", () => {
    const diffs = compareSnapshots(
      { status: "authorized", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_auth",
        status: "authorized",
        amount: money("10.00", "USD"),
        capturedAmount: money("0", "USD"),
        providerStatus: "requires_capture",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(false);
    expect(diffs).toEqual([]);
  });

  it("RECON-1: approved + amount vs capturedAmount 0 is not drift", () => {
    const diffs = compareSnapshots(
      { status: "approved", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "ORDER-1",
        status: "approved",
        amount: money("10.00", "USD"),
        capturedAmount: money("0.00", "USD"),
        providerStatus: "APPROVED",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(false);
    expect(diffs).toEqual([]);
  });

  it("NEW-RECON-1: processing + amount vs capturedAmount 0 is not drift", () => {
    for (const status of ["pending", "processing"] as const) {
      const diffs = compareSnapshots(
        { status, amount: money("10.00", "USD") },
        buildProviderPaymentSnapshot({
          gatewayPaymentId: "pi_inflight",
          status,
          amount: money("10.00", "USD"),
          capturedAmount: money("0", "USD"),
          providerStatus: status,
        }),
      );
      expect(diffs.some((d) => d.field === "capturedAmount")).toBe(false);
      expect(diffs).toEqual([]);
    }
  });

  it("NEW-RECON-1: pending local + processing provider captured 0 is not capturedAmount drift", () => {
    const diffs = compareSnapshots(
      { status: "pending", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_inflight",
        status: "processing",
        amount: money("10.00", "USD"),
        capturedAmount: money("0.00", "USD"),
        providerStatus: "processing",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(false);
    expect(diffs.some((d) => d.field === "status")).toBe(true);
  });

  it("NEW-RECON-1: processing + non-zero capturedAmount vs amount is still drift", () => {
    const diffs = compareSnapshots(
      { status: "processing", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_partial_inflight",
        status: "processing",
        amount: money("10.00", "USD"),
        capturedAmount: money("4.00", "USD"),
        providerStatus: "processing",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(true);
  });

  it("RECON-2: incremental capture while authorized is capturedAmount drift", () => {
    const diffs = compareSnapshots(
      { status: "authorized", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_inc",
        status: "authorized",
        amount: money("10.00", "USD"),
        capturedAmount: money("4.00", "USD"),
        providerStatus: "requires_capture",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(true);
  });

  it("RECON-2: full incremental capture while authorized is still drift", () => {
    // captured === amount but status remains authorized — not a paid settle.
    const diffs = compareSnapshots(
      { status: "authorized", amount: money("10.00", "USD") },
      buildProviderPaymentSnapshot({
        gatewayPaymentId: "pi_full_inc",
        status: "authorized",
        amount: money("10.00", "USD"),
        capturedAmount: money("10.00", "USD"),
        providerStatus: "requires_capture",
      }),
    );
    expect(diffs.some((d) => d.field === "capturedAmount")).toBe(true);
  });

  it("matches captured/refunded when zero spelling differs", () => {
    const diffs = compareSnapshots(
      {
        refundedAmount: money("0", "USD"),
      },
      provider,
    );
    expect(diffs).toEqual([]);
  });
});
