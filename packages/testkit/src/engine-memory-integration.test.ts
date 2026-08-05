/**
 * Integration proof: Phase 9 testkit `createMemoryWebhookInboxStore` is
 * structurally assignable to the Phase 10 webhooks engine store contract and
 * drives `createWebhookInboxEngine` end-to-end.
 *
 * Dependency direction: testkit → webhooks (allowed).
 * Webhooks production sources must never import testkit.
 *
 * Contract ownership: webhooks owns the engine-facing store type; testkit keeps
 * a dual copy for Phase 9 conformance/adapters. This file freezes **bidirectional**
 * structural assignability so drift fails CI before Phase 11 adapters ship.
 */
import { describe, it, expect } from "bun:test";
import {
  createWebhookInboxEngine,
  type WebhookInboxStore as EngineWebhookInboxStore,
  type WebhookInboxRecord as EngineWebhookInboxRecord,
  type ClaimWebhookResult as EngineClaimWebhookResult,
  type RenewWebhookLeaseResult as EngineRenewWebhookLeaseResult,
} from "@paykernel/webhooks";
import { createFakeClock } from "./memory/fake-clock";
import { createMemoryWebhookInboxStore } from "./memory/memory-stores";
import type {
  WebhookInboxStore as TestkitWebhookInboxStore,
  WebhookInboxRecord as TestkitWebhookInboxRecord,
  ClaimWebhookResult as TestkitClaimWebhookResult,
  RenewWebhookLeaseResult as TestkitRenewWebhookLeaseResult,
} from "./storage/contracts";

/**
 * Compile-time bidirectional assignability (fails tsc / type-aware test load if drift).
 * Runtime checks below exercise the same structural surface.
 */
type AssertExtends<_A extends B, B> = true;
type _EngineStoreAcceptsTestkit = AssertExtends<
  TestkitWebhookInboxStore,
  EngineWebhookInboxStore
>;
type _TestkitStoreAcceptsEngine = AssertExtends<
  EngineWebhookInboxStore,
  TestkitWebhookInboxStore
>;
type _EngineRecordAcceptsTestkit = AssertExtends<
  TestkitWebhookInboxRecord,
  EngineWebhookInboxRecord
>;
type _TestkitRecordAcceptsEngine = AssertExtends<
  EngineWebhookInboxRecord,
  TestkitWebhookInboxRecord
>;
type _EngineClaimAcceptsTestkit = AssertExtends<
  TestkitClaimWebhookResult,
  EngineClaimWebhookResult
>;
type _TestkitClaimAcceptsEngine = AssertExtends<
  EngineClaimWebhookResult,
  TestkitClaimWebhookResult
>;
type _EngineRenewAcceptsTestkit = AssertExtends<
  TestkitRenewWebhookLeaseResult,
  EngineRenewWebhookLeaseResult
>;
type _TestkitRenewAcceptsEngine = AssertExtends<
  EngineRenewWebhookLeaseResult,
  TestkitRenewWebhookLeaseResult
>;

// Keep type asserts "used" for isolatedModules / noUnusedLocals.
const _bidirectionalContractOk: [
  _EngineStoreAcceptsTestkit,
  _TestkitStoreAcceptsEngine,
  _EngineRecordAcceptsTestkit,
  _TestkitRecordAcceptsEngine,
  _EngineClaimAcceptsTestkit,
  _TestkitClaimAcceptsEngine,
  _EngineRenewAcceptsTestkit,
  _TestkitRenewAcceptsEngine,
] = [true, true, true, true, true, true, true, true];
void _bidirectionalContractOk;

describe("engine + testkit memory store integration", () => {
  it("createMemoryWebhookInboxStore is assignable to webhooks WebhookInboxStore", () => {
    const store: EngineWebhookInboxStore = createMemoryWebhookInboxStore();
    expect(typeof store.claim).toBe("function");
    expect(typeof store.renew).toBe("function");
    expect(typeof store.complete).toBe("function");
    expect(typeof store.fail).toBe("function");
    expect(typeof store.get).toBe("function");
    expect(typeof store.listRetryable).toBe("function");
    expect(typeof store.deleteExpired).toBe("function");
  });

  it("bidirectional: webhooks engine store type accepts testkit store and reverse assignment is typed", () => {
    // testkit → engine (production wiring)
    const asEngine: EngineWebhookInboxStore = createMemoryWebhookInboxStore();
    // engine → testkit (conformance suites that accept either dual definition)
    const asTestkit: TestkitWebhookInboxStore = asEngine;
    expect(asTestkit).toBe(asEngine);
    expect(typeof asTestkit.claim).toBe("function");
  });

  it("createWebhookInboxEngine processes via testkit memory store (inline)", async () => {
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const store = createMemoryWebhookInboxStore({ clock });
    const engine = createWebhookInboxEngine({
      store,
      mode: "inline",
      // EngineClock is structural: FakeClock.nowMs is sufficient
      clock: { nowMs: () => clock.nowMs() },
      defaultLeaseMs: 5_000,
    });

    let runs = 0;
    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_integration",
      payloadHash: "hash-integration-1",
      event: { type: "payment.succeeded" },
      handler: async (ctx) => {
        runs++;
        expect(ctx.key).toBe("stripe:evt_integration");
        expect(ctx.gateway).toBe("stripe");
        expect(ctx.providerEventId).toBe("evt_integration");
        expect(ctx.event).toEqual({ type: "payment.succeeded" });
      },
    });
    expect(first).toEqual({ outcome: "processed" });
    expect(runs).toBe(1);

    const rec = await store.get("stripe:evt_integration");
    expect(rec?.status).toBe("completed");
    expect(rec?.payloadHash).toBe("hash-integration-1");

    // Redelivery after completion — handler must not re-run
    const second = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_integration",
      payloadHash: "hash-integration-1",
      handler: async () => {
        runs++;
        throw new Error("must not run on duplicate_completed");
      },
    });
    expect(second).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(1);
  });

  it("WEBHOOKS-1: completed redelivery with different hash is duplicate_completed not payload_conflict", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({ store, mode: "inline" });

    // First delivery completes — terminal row.
    await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "h1",
      handler: async () => {},
    });
    expect((await store.get("stripe:evt_conflict"))?.status).toBe("completed");

    // WEBHOOKS-1 / contract WEBHOOKS-4: terminal before payload_hash_conflict.
    // Mismatched hash on a completed paid event must still ACK as done
    // (handler not re-run) — not permanent payload_conflict.
    let runs = 0;
    const redelivery = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_conflict",
      payloadHash: "h2-different",
      handler: async () => {
        runs++;
        throw new Error("must not run on terminal redelivery");
      },
    });
    expect(redelivery).toEqual({ outcome: "duplicate_completed" });
    expect(runs).toBe(0);
  });

  it("idle non-terminal hash mismatch supersedes and redrives (WEBHOOKS-3)", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });

    // Handler throw under durable_retry leaves a non-terminal pending row.
    const first = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_pending_conflict",
      payloadHash: "h1",
      event: { type: "payment.succeeded" },
      handler: async () => {
        throw new Error("leave pending");
      },
    });
    expect(first.outcome).toBe("scheduled_for_retry");
    expect((await store.get("stripe:evt_pending_conflict"))?.status).toBe(
      "pending",
    );

    // Idle pending + corrected hash source: supersede, do not stick forever.
    let secondRuns = 0;
    const supersede = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_pending_conflict",
      payloadHash: "h2-different",
      event: { type: "payment.succeeded" },
      handler: async () => {
        secondRuns++;
      },
    });
    expect(supersede.outcome).toBe("processed");
    expect(secondRuns).toBe(1);
    expect((await store.get("stripe:evt_pending_conflict"))?.payloadHash).toBe(
      "h2-different",
    );
  });

  it("active lease + different hash still surfaces payload_conflict", async () => {
    const store = createMemoryWebhookInboxStore();
    const engine = createWebhookInboxEngine({
      store,
      mode: "durable_retry",
      defaultRetryAfterMs: 0,
    });

    // Park an in-progress claim by acquiring via store (active lease held).
    const held = await store.claim({
      key: "stripe:evt_active_conflict",
      payloadHash: "h1",
      owner: "worker-a",
      leaseMs: 60_000,
    });
    expect(held.kind).toBe("acquired");

    let runs = 0;
    const conflict = await engine.processVerified({
      gateway: "stripe",
      providerEventId: "evt_active_conflict",
      payloadHash: "h2-different",
      event: { type: "payment.succeeded" },
      handler: async () => {
        runs++;
      },
    });
    expect(conflict).toEqual({ outcome: "payload_conflict" });
    expect(runs).toBe(0);
  });
});
