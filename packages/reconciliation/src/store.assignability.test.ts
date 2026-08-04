/**
 * Structural compatibility: reconciliation-owned ReconciliationStore matches
 * Phase 9 claim/schedule/complete surface (dual types with testkit).
 */
import { describe, it, expect } from "bun:test";
import type {
  ClaimResult,
  ReconciliationRecord,
  ReconciliationStore,
  RenewReconciliationLeaseResult,
} from "./store";
import { StoreLeaseLostError, isStoreLeaseLostError } from "./store";
import { createMemoryReconciliationStore } from "./memory-store";

describe("ReconciliationStore structural contract", () => {
  it("claim result kinds include acquired | not_due | in_progress | already_terminal | not_found", async () => {
    const store = createMemoryReconciliationStore({
      clock: { nowMs: () => 1_000_000 },
    });
    await store.schedule({
      key: "k1",
      subjectId: "s1",
      reason: "test",
      dueAt: new Date(1_000_000).toISOString(),
    });
    const a: ClaimResult = await store.claim({
      key: "k1",
      owner: "w1",
      leaseMs: 30_000,
    });
    expect(a.kind).toBe("acquired");

    const b = await store.claim({
      key: "k1",
      owner: "w2",
      leaseMs: 30_000,
    });
    expect(b.kind).toBe("in_progress");

    const missing = await store.claim({
      key: "missing",
      owner: "w",
      leaseMs: 1000,
    });
    expect(missing.kind).toBe("not_found");
  });

  it("renew rotates token and rejects stale", async () => {
    const store = createMemoryReconciliationStore({
      clock: { nowMs: () => 2_000_000 },
    });
    await store.schedule({
      key: "k2",
      subjectId: "s",
      reason: "r",
      dueAt: new Date(2_000_000).toISOString(),
    });
    const a = await store.claim({ key: "k2", owner: "w", leaseMs: 30_000 });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    const old = a.leaseToken;
    const r: RenewReconciliationLeaseResult = await store.renew({
      key: "k2",
      leaseToken: old,
      leaseMs: 30_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.leaseToken).not.toBe(old);

    const stale = await store.renew({
      key: "k2",
      leaseToken: old,
      leaseMs: 30_000,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected fail");
    expect(stale.reason).toBe("lease_lost");
  });

  it("stale complete throws StoreLeaseLostError", async () => {
    const store = createMemoryReconciliationStore({
      clock: { nowMs: () => 3_000_000 },
    });
    await store.schedule({
      key: "k3",
      subjectId: "s",
      reason: "r",
      dueAt: new Date(3_000_000).toISOString(),
    });
    const a = await store.claim({ key: "k3", owner: "w", leaseMs: 30_000 });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    await store.complete({ key: "k3", leaseToken: a.leaseToken });
    try {
      await store.complete({ key: "k3", leaseToken: a.leaseToken });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isStoreLeaseLostError(e)).toBe(true);
      expect(e).toBeInstanceOf(StoreLeaseLostError);
    }
  });

  it("record shape has required lean fields", async () => {
    const store = createMemoryReconciliationStore({
      clock: { nowMs: () => 4_000_000 },
    });
    await store.schedule({
      key: "k4",
      subjectId: "subj",
      reason: "indeterminate_create",
      dueAt: new Date(4_000_000).toISOString(),
    });
    const a = await store.claim({ key: "k4", owner: "owner", leaseMs: 10_000 });
    if (a.kind !== "acquired") throw new Error("expected acquired");
    const rec: ReconciliationRecord = a.record;
    expect(rec.key).toBe("k4");
    expect(rec.status).toBe("claimed");
    expect(rec.subjectId).toBe("subj");
    expect(rec.reason).toBe("indeterminate_create");
    expect(typeof rec.attempts).toBe("number");
    expect(typeof rec.generation).toBe("number");
    expect(typeof rec.createdAt).toBe("string");
    expect(typeof rec.updatedAt).toBe("string");
    expect(typeof rec.dueAt).toBe("string");
  });

  it("dual contract method names match Phase 9 surface", () => {
    // Freeze method names so adapter dual ownership stays aligned without
    // importing testkit into production sources.
    const required = [
      "schedule",
      "claim",
      "renew",
      "complete",
      "fail",
      "markManualReview",
      "get",
      "listDue",
      "deleteExpired",
    ] as const;
    const store: ReconciliationStore = createMemoryReconciliationStore();
    for (const name of required) {
      expect(typeof store[name]).toBe("function");
    }
  });
});
