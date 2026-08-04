/**
 * Integration proof: Phase 9 testkit `createMemoryReconciliationStore` is
 * structurally assignable to the Phase 19 reconciliation domain store contract.
 *
 * Dependency direction: testkit → reconciliation (allowed).
 * Reconciliation production sources must never import testkit.
 *
 * Contract ownership: reconciliation owns the domain-facing store type; testkit
 * keeps a dual copy for Phase 9 conformance/adapters. This file freezes
 * **bidirectional** structural assignability so drift fails CI.
 */
import { describe, it, expect } from "bun:test";
import type {
  ReconciliationStore as DomainReconciliationStore,
  ReconciliationRecord as DomainReconciliationRecord,
  ClaimResult as DomainClaimResult,
  RenewReconciliationLeaseResult as DomainRenewResult,
} from "@paykernel/reconciliation";
import { createFakeClock } from "./memory/fake-clock";
import { createMemoryReconciliationStore } from "./memory/memory-stores";
import type {
  ReconciliationStore as TestkitReconciliationStore,
  ReconciliationRecord as TestkitReconciliationRecord,
  ClaimResult as TestkitClaimResult,
  RenewReconciliationLeaseResult as TestkitRenewResult,
} from "./storage/contracts";

/**
 * Compile-time bidirectional assignability (fails tsc / type-aware test load if drift).
 * Runtime checks below exercise the same structural surface.
 */
type AssertExtends<_A extends B, B> = true;
type _DomainStoreAcceptsTestkit = AssertExtends<
  TestkitReconciliationStore,
  DomainReconciliationStore
>;
type _TestkitStoreAcceptsDomain = AssertExtends<
  DomainReconciliationStore,
  TestkitReconciliationStore
>;
type _DomainRecordAcceptsTestkit = AssertExtends<
  TestkitReconciliationRecord,
  DomainReconciliationRecord
>;
type _TestkitRecordAcceptsDomain = AssertExtends<
  DomainReconciliationRecord,
  TestkitReconciliationRecord
>;
type _DomainClaimAcceptsTestkit = AssertExtends<TestkitClaimResult, DomainClaimResult>;
type _TestkitClaimAcceptsDomain = AssertExtends<DomainClaimResult, TestkitClaimResult>;
type _DomainRenewAcceptsTestkit = AssertExtends<TestkitRenewResult, DomainRenewResult>;
type _TestkitRenewAcceptsDomain = AssertExtends<DomainRenewResult, TestkitRenewResult>;

// Keep type asserts "used" for isolatedModules / noUnusedLocals.
const _bidirectionalContractOk: [
  _DomainStoreAcceptsTestkit,
  _TestkitStoreAcceptsDomain,
  _DomainRecordAcceptsTestkit,
  _TestkitRecordAcceptsDomain,
  _DomainClaimAcceptsTestkit,
  _TestkitClaimAcceptsDomain,
  _DomainRenewAcceptsTestkit,
  _TestkitRenewAcceptsDomain,
] = [true, true, true, true, true, true, true, true];
void _bidirectionalContractOk;

describe("reconciliation + testkit memory store dual assignability", () => {
  it("schedule → claim → complete works under domain-typed store", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store: DomainReconciliationStore = createMemoryReconciliationStore({ clock });
    const dueAt = new Date(clock.nowMs()).toISOString();

    const scheduled = await store.schedule({
      key: "recon:integration:1",
      subjectId: "pay_integration",
      reason: "indeterminate_create",
      dueAt,
    });
    expect(scheduled.kind === "scheduled" || scheduled.kind === "already_exists").toBe(true);

    const claimed = await store.claim({
      key: "recon:integration:1",
      owner: "worker-1",
      leaseMs: 30_000,
    });
    expect(claimed.kind).toBe("acquired");
    if (claimed.kind !== "acquired") throw new Error("expected acquired");
    expect(claimed.record.subjectId).toBe("pay_integration");
    expect(typeof claimed.leaseToken).toBe("string");

    await store.complete({
      key: "recon:integration:1",
      leaseToken: claimed.leaseToken,
    });

    const rec = await store.get("recon:integration:1");
    expect(rec?.status).toBe("completed");
  });
});
