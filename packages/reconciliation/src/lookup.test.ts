import { describe, it, expect } from "bun:test";
import type { Money } from "@paykernel/core";
import {
  resolveProviderSnapshot,
  createGetPaymentLookupPort,
  type ProviderLookupPort,
} from "./lookup";
import { decideReconciliationPolicy } from "./policy";
import {
  buildProviderPaymentSnapshot,
  type ProviderPaymentSnapshot,
  type ReconciliationTarget,
} from "./types";

const money = (amount: string, currency: string): Money => ({ amount, currency });

function snap(
  id: string,
  status: ProviderPaymentSnapshot["status"] = "paid",
): ProviderPaymentSnapshot {
  return buildProviderPaymentSnapshot({
    gatewayPaymentId: id,
    status,
    amount: money("10.00", "USD"),
    providerStatus: status,
  });
}

describe("safe lookup order", () => {
  it("prefers gatewayPaymentId over later keys", async () => {
    const order: string[] = [];
    const lookup: ProviderLookupPort = {
      async findByPaymentId(_g, id) {
        order.push(`payment:${id}`);
        return { kind: "found", snapshots: [snap(id)] };
      },
      async findByIdempotencyKey(_g, key) {
        order.push(`idem:${key}`);
        return { kind: "found", snapshots: [snap("other")] };
      },
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_1",
      idempotencyKey: "idem_1",
    };
    const result = await resolveProviderSnapshot(target, lookup);
    expect(result.outcome).toBe("consistent");
    if (result.outcome === "consistent") {
      expect(result.provider.gatewayPaymentId).toBe("pi_1");
    }
    expect(order).toEqual(["payment:pi_1"]);
  });

  it("falls back to idempotency key when payment id not found", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "not_found" };
      },
      async findByIdempotencyKey() {
        // Secondary hit returns same identity as target → consistent
        return { kind: "found", snapshots: [snap("pi_missing")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_missing",
        idempotencyKey: "idem_1",
      },
      lookup,
    );
    expect(result.outcome).toBe("consistent");
    if (result.outcome === "consistent") {
      expect(result.provider.gatewayPaymentId).toBe("pi_missing");
    }
  });

  it("RECON-3: secondary-key wrong payment after primary not_found is manual_review (no foreign snapshot)", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "not_found" };
      },
      async findByIdempotencyKey() {
        // Finds a *different* paid payment than target.gatewayPaymentId
        return { kind: "found", snapshots: [snap("pi_B", "paid")] };
      },
    };
    const target: ReconciliationTarget = {
      gateway: "stripe",
      gatewayPaymentId: "pi_A",
      idempotencyKey: "idem_shared",
      expected: { status: "pending" },
    };
    const result = await resolveProviderSnapshot(target, lookup);
    // RECON-3: do not expose foreign provider as drift/consistent snapshot
    expect(result.outcome).toBe("manual_review_required");
    if (result.outcome === "manual_review_required") {
      expect(result.reason).toMatch(/different payment|gatewayPaymentId/i);
    }
    expect("provider" in result).toBe(false);
    // Policy must not safe-upgrade against the wrong charge
    const decision = decideReconciliationPolicy(result, target);
    expect(decision.action).not.toBe("update_local_to_paid");
    expect(decision.safe).toBe(false);
  });

  it("RECON-3: secondary same-id recovery after primary not_found still works", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "not_found" };
      },
      async findByIdempotencyKey() {
        return { kind: "found", snapshots: [snap("pi_A", "paid")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_A",
        idempotencyKey: "idem_1",
        expected: { status: "pending" },
      },
      lookup,
    );
    expect(result.outcome).toBe("drift_detected");
    if (result.outcome === "drift_detected") {
      expect(result.provider.gatewayPaymentId).toBe("pi_A");
    }
  });

  it("falls back through localReference then providerRequestId", async () => {
    const called: string[] = [];
    const lookup: ProviderLookupPort = {
      async findByLocalReference() {
        called.push("local");
        return { kind: "not_found" };
      },
      async findByProviderRequestId(_g, id) {
        called.push("req");
        return { kind: "found", snapshots: [snap(`req-${id}`)] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        localReference: "ord_1",
        providerRequestId: "req_9",
      },
      lookup,
    );
    expect(called).toEqual(["local", "req"]);
    expect(result.outcome).toBe("consistent");
  });

  it("multi-match → ambiguous_match never pick first", async () => {
    const lookup: ProviderLookupPort = {
      async findByIdempotencyKey() {
        return {
          kind: "found",
          snapshots: [snap("a"), snap("b")],
        };
      },
    };
    const result = await resolveProviderSnapshot(
      { gateway: "stripe", idempotencyKey: "k" },
      lookup,
    );
    expect(result.outcome).toBe("ambiguous_match");
    if (result.outcome === "ambiguous_match") {
      expect(result.matches).toHaveLength(2);
    }
  });

  it("all not_found → provider_not_found retryable true", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "not_found" };
      },
      async findByIdempotencyKey() {
        return { kind: "not_found" };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_x",
        idempotencyKey: "idem_x",
      },
      lookup,
    );
    expect(result.outcome).toBe("provider_not_found");
    if (result.outcome === "provider_not_found") {
      expect(result.retryable).toBe(true);
    }
  });

  it("unavailable → temporarily_unavailable (not failed)", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "unavailable", retryAfterMs: 5000 };
      },
    };
    const result = await resolveProviderSnapshot(
      { gateway: "stripe", gatewayPaymentId: "pi_1" },
      lookup,
    );
    expect(result.outcome).toBe("temporarily_unavailable");
    if (result.outcome === "temporarily_unavailable") {
      expect(result.retryAfterMs).toBe(5000);
    }
  });

  it("no lookup keys → manual_review_required", async () => {
    const result = await resolveProviderSnapshot(
      { gateway: "stripe" },
      {},
    );
    expect(result.outcome).toBe("manual_review_required");
  });

  it("keys present but no methods → manual_review_required", async () => {
    const result = await resolveProviderSnapshot(
      { gateway: "stripe", gatewayPaymentId: "pi_1" },
      {},
    );
    expect(result.outcome).toBe("manual_review_required");
    if (result.outcome === "manual_review_required") {
      expect(result.reason).toContain("No lookup methods");
    }
  });

  it("compares expected when single found", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "found", snapshots: [snap("pi_1", "paid")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        expected: { status: "pending" },
      },
      lookup,
    );
    expect(result.outcome).toBe("drift_detected");
    if (result.outcome === "drift_detected") {
      expect(result.differences[0]!.field).toBe("status");
    }
  });

  it("thrown lookup maps to temporarily_unavailable", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        throw new Error("network down");
      },
    };
    const result = await resolveProviderSnapshot(
      { gateway: "stripe", gatewayPaymentId: "pi_1" },
      lookup,
    );
    expect(result.outcome).toBe("temporarily_unavailable");
  });

  it("skips undefined methods for intermediate keys (capability-aware)", async () => {
    const called: string[] = [];
    const lookup: ProviderLookupPort = {
      // no findByPaymentId even though key present
      async findByLocalReference(_g, ref) {
        called.push(ref);
        // Secondary recovers the same payment id as target
        return { kind: "found", snapshots: [snap("pi_1")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        localReference: "ord_1",
      },
      lookup,
    );
    expect(called).toEqual(["ord_1"]);
    expect(result.outcome).toBe("consistent");
  });

  it("non-retryable lookup error continues to next key method", async () => {
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "error", retryable: false, message: "bad id format" };
      },
      async findByIdempotencyKey() {
        // Bound identity: secondary returns target's intended payment id
        return { kind: "found", snapshots: [snap("pi_bad")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_bad",
        idempotencyKey: "idem_ok",
      },
      lookup,
    );
    expect(result.outcome).toBe("consistent");
    if (result.outcome === "consistent") {
      expect(result.provider.gatewayPaymentId).toBe("pi_bad");
    }
  });

  it("retryable lookup error stops without trying later keys", async () => {
    let idemCalls = 0;
    const lookup: ProviderLookupPort = {
      async findByPaymentId() {
        return { kind: "error", retryable: true };
      },
      async findByIdempotencyKey() {
        idemCalls++;
        return { kind: "found", snapshots: [snap("should-not-run")] };
      },
    };
    const result = await resolveProviderSnapshot(
      {
        gateway: "stripe",
        gatewayPaymentId: "pi_1",
        idempotencyKey: "idem_1",
      },
      lookup,
    );
    expect(result.outcome).toBe("temporarily_unavailable");
    expect(idemCalls).toBe(0);
  });
});

describe("createGetPaymentLookupPort", () => {
  it.each([
    [
      "snapshot",
      async () => snap("pi_1"),
      "consistent",
    ],
    [
      "undefined",
      async () => undefined,
      "provider_not_found",
    ],
    [
      "throw",
      async () => {
        throw new Error("network");
      },
      "temporarily_unavailable",
    ],
  ] as const)("maps getPayment %s to %s", async (_label, getPayment, outcome) => {
    const port = createGetPaymentLookupPort({ getPayment });
    const result = await resolveProviderSnapshot(
      { gateway: "stripe", gatewayPaymentId: "pi_1" },
      port,
    );
    expect(result.outcome).toBe(outcome);
  });
});
