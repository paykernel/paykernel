/**
 * Cross-partition isolation vs same-key serialization (mock namespace).
 * Multi-partition discovery fan-out (listDue / listRetryable / deleteExpired).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import { StoreUnsupportedFeatureError } from "@paykernel/store-contracts";
import {
  createDoPaymentStores,
  resolveDoHashLayoutMetaShardName,
  resolveDoShardName,
} from "./index";
import type { DoNamespaceLike, DoStubLike } from "./types";
import { createMockDoNamespace } from "./test-utils/mock-namespace";
import { uniqueTablePrefix } from "./test-utils/do-env";

/** Find two keys that hash to different partitions under strategy. */
function findCrossPartitionKeys(
  partitions: number,
  maxAttempts = 200,
): { keyA: string; keyB: string } {
  const strategy = { kind: "hash" as const, partitions };
  for (let i = 0; i < maxAttempts; i++) {
    const ka = `ka${i}`;
    const kb = `kb${i}`;
    const sa = resolveDoShardName(strategy, { key: ka });
    const sb = resolveDoShardName(strategy, { key: kb });
    if (sa !== sb) {
      return { keyA: ka, keyB: kb };
    }
  }
  throw new Error("could not find cross-partition key pair");
}

describe("do partition isolation", () => {
  it("hash partitions: different keys may land on different objects", async () => {
    const prefix = uniqueTablePrefix("pt");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 8 },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(8);

      const rA = await stores.idempotency.reserve({
        key: keyA,
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      const rB = await stores.idempotency.reserve({
        key: keyB,
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(rA.kind).toBe("acquired");
      expect(rB.kind).toBe("acquired");

      // Distinct physical partitions materialised
      expect(ns.partitions.size).toBeGreaterThanOrEqual(2);
    } finally {
      ns.close();
    }
  });

  it("key strategy: same key serializes on one object; second reserve in_progress", async () => {
    const prefix = uniqueTablePrefix("ks");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "key" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const r1 = await stores.idempotency.reserve({
        key: "same",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 30_000,
      });
      const r2 = await stores.idempotency.reserve({
        key: "same",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 30_000,
      });
      expect(r1.kind).toBe("acquired");
      expect(r2.kind).toBe("in_progress");
      expect(ns.partitions.size).toBe(1);
    } finally {
      ns.close();
    }
  });

  it("tenant strategy: one namespace, two tenant strategies isolate the same key", async () => {
    const prefix = uniqueTablePrefix("tn");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    // ONE namespace; tenant isolation is by shard name, not by mock handle.
    const ns = createMockDoNamespace({ clock });
    try {
      const acmeName = resolveDoShardName(
        { kind: "tenant", tenantId: "acme" },
        { key: "shared-key" },
      );
      const globexName = resolveDoShardName(
        { kind: "tenant", tenantId: "globex" },
        { key: "shared-key" },
      );
      expect(acmeName).toBe("tenant:acme");
      expect(globexName).toBe("tenant:globex");
      expect(acmeName).not.toBe(globexName);

      const t1 = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "tenant", tenantId: "acme" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      const t2 = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "tenant", tenantId: "globex" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      const a = await t1.idempotency.reserve({
        key: "shared-key",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      const b = await t2.idempotency.reserve({
        key: "shared-key",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 10_000,
      });
      expect(a.kind).toBe("acquired");
      expect(b.kind).toBe("acquired");
      expect(ns.partitions.has("tenant:acme")).toBe(true);
      expect(ns.partitions.has("tenant:globex")).toBe(true);
    } finally {
      ns.close();
    }
  });
});

describe("do multi-partition discovery fan-out", () => {
  it("hash: listDue returns recon jobs scheduled on distinct real-key partitions", async () => {
    const prefix = uniqueTablePrefix("ld");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);
      const shardA = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyA },
      );
      const shardB = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyB },
      );
      expect(shardA).not.toBe(shardB);

      const sA = await stores.reconciliation.schedule({
        key: keyA,
        subjectId: "pay_a",
        reason: "timeout",
        dueAt: now,
      });
      const sB = await stores.reconciliation.schedule({
        key: keyB,
        subjectId: "pay_b",
        reason: "timeout",
        dueAt: now,
      });
      expect(sA.kind).toBe("scheduled");
      expect(sB.kind).toBe("scheduled");

      const listed = await stores.reconciliation.listDue({ now, limit: 50 });
      const keys = new Set(listed.map((r) => r.key));
      expect(keys.has(keyA), `listDue missing keyA=${keyA} (shard ${shardA})`).toBe(
        true,
      );
      expect(keys.has(keyB), `listDue missing keyB=${keyB} (shard ${shardB})`).toBe(
        true,
      );
      // Fan-out materialises all hash partitions (empty ones included) + layout meta DO.
      expect(ns.partitions.size).toBeGreaterThanOrEqual(partitions);
      expect(ns.partitions.size).toBe(partitions + 1); // N data shards + DO-1 layout meta
    } finally {
      ns.close();
    }
  });

  it("hash: listRetryable returns webhooks parked on distinct real-key partitions", async () => {
    const prefix = uniqueTablePrefix("lr");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);

      const cA = await stores.webhookInbox.claim({
        key: keyA,
        payloadHash: "hA",
        owner: "w",
        leaseMs: 30_000,
      });
      const cB = await stores.webhookInbox.claim({
        key: keyB,
        payloadHash: "hB",
        owner: "w",
        leaseMs: 30_000,
      });
      expect(cA.kind).toBe("acquired");
      expect(cB.kind).toBe("acquired");
      if (cA.kind !== "acquired" || cB.kind !== "acquired") return;

      // Park as pending retryable (available immediately).
      await stores.webhookInbox.fail({
        key: keyA,
        leaseToken: cA.leaseToken,
        error: "retry later",
        retryAfterMs: 0,
      });
      await stores.webhookInbox.fail({
        key: keyB,
        leaseToken: cB.leaseToken,
        error: "retry later",
        retryAfterMs: 0,
      });

      const listed = await stores.webhookInbox.listRetryable({ now, limit: 50 });
      const keys = new Set(listed.map((r) => r.key));
      expect(keys.has(keyA)).toBe(true);
      expect(keys.has(keyB)).toBe(true);
    } finally {
      ns.close();
    }
  });

  it("hash: deleteExpired fans out and removes expired rows on non-sentinel partitions", async () => {
    const prefix = uniqueTablePrefix("de");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);

      // Schedule, claim, complete → terminal rows eligible for cleanup.
      for (const key of [keyA, keyB]) {
        await stores.reconciliation.schedule({
          key,
          subjectId: `sub_${key}`,
          reason: "timeout",
          dueAt: now,
        });
        const claim = await stores.reconciliation.claim({
          key,
          owner: "w",
          leaseMs: 30_000,
        });
        expect(claim.kind).toBe("acquired");
        if (claim.kind !== "acquired") return;
        await stores.reconciliation.complete({
          key,
          leaseToken: claim.leaseToken,
        });
      }

      // Advance clock past retention window (deleteExpired uses updated_at <= before).
      clock.advance(60_000);
      const before = new Date(clock.nowMs()).toISOString();

      const result = await stores.reconciliation.deleteExpired({ before });
      expect(result.deleted).toBeGreaterThanOrEqual(2);

      expect(await stores.reconciliation.get(keyA)).toBeUndefined();
      expect(await stores.reconciliation.get(keyB)).toBeUndefined();
    } finally {
      ns.close();
    }
  });

  it("hash partitions=1: listDue still works (single-partition regression)", async () => {
    const prefix = uniqueTablePrefix("sp");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 1 },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      await stores.reconciliation.schedule({
        key: "only-job",
        subjectId: "pay_1",
        reason: "timeout",
        dueAt: now,
      });

      const listed = await stores.reconciliation.listDue({ now });
      expect(listed.map((r) => r.key)).toEqual(["only-job"]);
      // Single data partition + DO-1 layout meta object.
      expect(ns.partitions.size).toBe(2);
    } finally {
      ns.close();
    }
  });

  it("key strategy: listDue / listRetryable / deleteExpired hard-fail (no silent empty)", async () => {
    const prefix = uniqueTablePrefix("kf");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "key" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      // Key-addressed schedule still works.
      await stores.reconciliation.schedule({
        key: "job-1",
        subjectId: "pay_1",
        reason: "timeout",
        dueAt: now,
      });
      const got = await stores.reconciliation.get("job-1");
      expect(got?.key).toBe("job-1");

      await expect(stores.reconciliation.listDue({ now })).rejects.toBeInstanceOf(
        StoreUnsupportedFeatureError,
      );
      await expect(
        stores.webhookInbox.listRetryable({ now }),
      ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
      await expect(
        stores.reconciliation.deleteExpired({ before: now }),
      ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
      await expect(
        stores.idempotency.deleteExpired({ before: now }),
      ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
      await expect(
        stores.webhookInbox.deleteExpired({ before: now }),
      ).rejects.toBeInstanceOf(StoreUnsupportedFeatureError);
    } finally {
      ns.close();
    }
  });

  it("listDue respects global limit across partitions (stable truncate)", async () => {
    const prefix = uniqueTablePrefix("lim");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);
      await stores.reconciliation.schedule({
        key: keyA,
        subjectId: "pay_a",
        reason: "timeout",
        dueAt: now,
      });
      await stores.reconciliation.schedule({
        key: keyB,
        subjectId: "pay_b",
        reason: "timeout",
        dueAt: now,
      });

      const listed = await stores.reconciliation.listDue({ now, limit: 1 });
      expect(listed).toHaveLength(1);
      expect([keyA, keyB]).toContain(listed[0]!.key);
    } finally {
      ns.close();
    }
  });

  it("PERF-5: peek every shard, full-list only occupied (expired claimed counts)", async () => {
    const prefix = uniqueTablePrefix("pk5");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const peekNames: string[] = [];
      const listNames: string[] = [];
      const inner = ns.namespace;
      function wrapStub(stub: DoStubLike, name: string): DoStubLike {
        return new Proxy(stub, {
          get(target, prop, recv) {
            const value = Reflect.get(target, prop, recv);
            if (typeof value !== "function") return value;
            if (prop === "peekDueReconciliation") {
              return async (...args: unknown[]) => {
                peekNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            if (prop === "listDueReconciliation") {
              return async (...args: unknown[]) => {
                listNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            return value;
          },
        });
      }
      const wrapped: DoNamespaceLike = {
        idFromName: (n) => inner.idFromName(n),
        get: (id) => wrapStub(inner.get(id), id.toString()),
        getByName: (name) => wrapStub(inner.getByName!(name), name),
      };

      const stores = createDoPaymentStores({
        namespace: wrapped,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);
      const shardA = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyA },
      );
      const shardB = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyB },
      );
      await stores.reconciliation.schedule({
        key: keyA,
        subjectId: "pay_a",
        reason: "timeout",
        dueAt: now,
      });
      await stores.reconciliation.schedule({
        key: keyB,
        subjectId: "pay_b",
        reason: "timeout",
        dueAt: now,
      });
      const claimed = await stores.reconciliation.claim({
        key: keyB,
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(claimed.kind).toBe("acquired");
      clock.advance(2_000);
      const later = new Date(clock.nowMs()).toISOString();

      peekNames.length = 0;
      listNames.length = 0;
      const listed = await stores.reconciliation.listDue({
        now: later,
        limit: 50,
      });
      const keys = new Set(listed.map((r) => r.key));
      expect(keys.has(keyA)).toBe(true);
      expect(keys.has(keyB)).toBe(true);
      expect(peekNames).toHaveLength(partitions);
      expect(new Set(listNames)).toEqual(new Set([shardA, shardB]));
    } finally {
      ns.close();
    }
  });

  it("PERF-5: full-list skips later occupied shards that cannot beat earliest-N", async () => {
    const prefix = uniqueTablePrefix("pk5c");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const nowMs = clock.nowMs();
    const early = new Date(nowMs).toISOString();
    const late = new Date(nowMs + 3_600_000).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const listNames: string[] = [];
      const inner = ns.namespace;
      function wrapStub(stub: DoStubLike, name: string): DoStubLike {
        return new Proxy(stub, {
          get(target, prop, recv) {
            const value = Reflect.get(target, prop, recv);
            if (typeof value !== "function") return value;
            if (prop === "listDueReconciliation") {
              return async (...args: unknown[]) => {
                listNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            return value;
          },
        });
      }
      const wrapped: DoNamespaceLike = {
        idFromName: (n) => inner.idFromName(n),
        get: (id) => wrapStub(inner.get(id), id.toString()),
        getByName: (name) => wrapStub(inner.getByName!(name), name),
      };

      const stores = createDoPaymentStores({
        namespace: wrapped,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA, keyB } = findCrossPartitionKeys(partitions);
      const shardA = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyA },
      );
      const shardB = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyB },
      );
      await stores.reconciliation.schedule({
        key: keyA,
        subjectId: "pay_early",
        reason: "timeout",
        dueAt: early,
      });
      await stores.reconciliation.schedule({
        key: keyB,
        subjectId: "pay_late",
        reason: "timeout",
        dueAt: late,
      });

      const listed = await stores.reconciliation.listDue({
        now: late,
        limit: 1,
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.key).toBe(keyA);
      expect(listNames).toContain(shardA);
      expect(listNames).not.toContain(shardB);
    } finally {
      ns.close();
    }
  });

  it("PERF-5: single enumerable isolate lists without peek", async () => {
    const prefix = uniqueTablePrefix("pk5s");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const peekNames: string[] = [];
      const listNames: string[] = [];
      const inner = ns.namespace;
      function wrapStub(stub: DoStubLike, name: string): DoStubLike {
        return new Proxy(stub, {
          get(target, prop, recv) {
            const value = Reflect.get(target, prop, recv);
            if (typeof value !== "function") return value;
            if (prop === "peekDueReconciliation") {
              return async (...args: unknown[]) => {
                peekNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            if (prop === "listDueReconciliation") {
              return async (...args: unknown[]) => {
                listNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            return value;
          },
        });
      }
      const wrapped: DoNamespaceLike = {
        idFromName: (n) => inner.idFromName(n),
        get: (id) => wrapStub(inner.get(id), id.toString()),
        getByName: (name) => wrapStub(inner.getByName!(name), name),
      };

      const stores = createDoPaymentStores({
        namespace: wrapped,
        sharding: { kind: "hash", partitions: 1 },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      await stores.reconciliation.schedule({
        key: "recon:stripe:solo",
        subjectId: "pay_solo",
        reason: "timeout",
        dueAt: now,
      });
      const listed = await stores.reconciliation.listDue({ now, limit: 10 });
      expect(listed).toHaveLength(1);
      expect(peekNames).toHaveLength(0);
      expect(listNames.length).toBeGreaterThan(0);
    } finally {
      ns.close();
    }
  });

  it("PERF-5: non-boolean peek occupied still full-lists (fail-closed)", async () => {
    const prefix = uniqueTablePrefix("pk5o");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const partitions = 8;
      const listNames: string[] = [];
      const inner = ns.namespace;
      function wrapStub(stub: DoStubLike, name: string): DoStubLike {
        return new Proxy(stub, {
          get(target, prop, recv) {
            const value = Reflect.get(target, prop, recv);
            if (typeof value !== "function") return value;
            if (prop === "peekDueReconciliation") {
              return async () => ({ occupied: 1 });
            }
            if (prop === "listDueReconciliation") {
              return async (...args: unknown[]) => {
                listNames.push(name);
                return (value as (...a: unknown[]) => unknown)(...args);
              };
            }
            return value;
          },
        });
      }
      const wrapped: DoNamespaceLike = {
        idFromName: (n) => inner.idFromName(n),
        get: (id) => wrapStub(inner.get(id), id.toString()),
        getByName: (name) => wrapStub(inner.getByName!(name), name),
      };

      const stores = createDoPaymentStores({
        namespace: wrapped,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const { keyA } = findCrossPartitionKeys(partitions);
      const shardA = resolveDoShardName(
        { kind: "hash", partitions },
        { key: keyA },
      );
      await stores.reconciliation.schedule({
        key: keyA,
        subjectId: "pay_occupied",
        reason: "timeout",
        dueAt: now,
      });

      const listed = await stores.reconciliation.listDue({ now, limit: 10 });
      expect(listed.map((row) => row.key)).toContain(keyA);
      expect(listNames).toContain(shardA);
    } finally {
      ns.close();
    }
  });

  it("DO-1: changing hash partitions under same layout hard-throws (no empty re-route)", async () => {
    const prefix = uniqueTablePrefix("do1");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const stores16 = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 16 },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      // First op seals partitions=16 on stable layout meta DO.
      const r = await stores16.idempotency.reserve({
        key: "seal-key",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");

      const metaName = resolveDoHashLayoutMetaShardName({
        kind: "hash",
        partitions: 16,
      });
      expect(ns.partitions.has(metaName)).toBe(true);

      // Same namespace, N=32 — must not silently route to empty hash:32:* objects.
      const stores32 = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 32 },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      await expect(
        stores32.idempotency.reserve({
          key: "other-key",
          fingerprint: "fp2",
          owner: "w1",
          leaseMs: 30_000,
        }),
      ).rejects.toThrow(/DO-1|partitions sealed|partitions changed/i);
    } finally {
      ns.close();
    }
  });

  it("P17-CLEAN: bounded deleteExpired does not starve later hash partitions", async () => {
    const prefix = uniqueTablePrefix("cln");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const now = new Date(clock.nowMs()).toISOString();
    const ns = createMockDoNamespace({ clock });
    try {
      const partitions = 2;
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      const keysForPart = (part: number, count: number): string[] => {
        const keys: string[] = [];
        for (let i = 0; keys.length < count; i++) {
          const key = `cln${part}_${i}`;
          const shard = resolveDoShardName(
            { kind: "hash", partitions },
            { key },
          );
          if (shard.endsWith(`:${part}`)) keys.push(key);
        }
        return keys;
      };

      // Partition 0 has more than `limit` eligible rows; partition 1 also has some.
      const part0 = keysForPart(0, 8);
      const part1 = keysForPart(1, 4);
      expect(part0).toHaveLength(8);
      expect(part1).toHaveLength(4);

      for (const key of [...part0, ...part1]) {
        await stores.reconciliation.schedule({
          key,
          subjectId: `sub_${key}`,
          reason: "timeout",
          dueAt: now,
        });
        const claim = await stores.reconciliation.claim({
          key,
          owner: "w",
          leaseMs: 30_000,
        });
        expect(claim.kind).toBe("acquired");
        if (claim.kind !== "acquired") return;
        await stores.reconciliation.complete({
          key,
          leaseToken: claim.leaseToken,
        });
      }

      clock.advance(60_000);
      const before = new Date(clock.nowMs()).toISOString();
      const limit = 3;

      const result = await stores.reconciliation.deleteExpired({
        before,
        limit,
      });
      expect(result.deleted).toBe(limit);

      const gone = async (keys: string[]) => {
        const rows = await Promise.all(keys.map((k) => stores.reconciliation.get(k)));
        return rows.filter((r) => r === undefined).length;
      };

      const gone0 = await gone(part0);
      const gone1 = await gone(part1);
      // Single limited delete must not exclusively drain index 0 while
      // partition 1 still has eligible rows.
      expect(gone0).toBeGreaterThan(0);
      expect(gone1).toBeGreaterThan(0);
    } finally {
      ns.close();
    }
  });

  it("DO-1: new layoutId allows different partition count (intentional empty layout)", async () => {
    const prefix = uniqueTablePrefix("do1b");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      const a = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 8, layoutId: "layout-a" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      await a.idempotency.reserve({
        key: "k1",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 30_000,
      });

      const b = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: { kind: "hash", partitions: 16, layoutId: "layout-b" },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      const r = await b.idempotency.reserve({
        key: "k2",
        fingerprint: "fp2",
        owner: "w1",
        leaseMs: 30_000,
      });
      expect(r.kind).toBe("acquired");
    } finally {
      ns.close();
    }
  });
});
