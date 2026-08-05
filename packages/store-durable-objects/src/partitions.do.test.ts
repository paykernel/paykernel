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

  it("tenant strategy: different tenants isolate", async () => {
    const prefix = uniqueTablePrefix("tn");
    const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
    const ns = createMockDoNamespace({
      clock,
      tableNamespace: { tablePrefix: prefix },
    });
    try {
      // Simpler: two stores with fixed tenant strategies.
      const ns2 = createMockDoNamespace({
        clock,
        tableNamespace: { tablePrefix: prefix },
      });
      try {
        const t1 = createDoPaymentStores({
          namespace: ns.namespace,
          sharding: { kind: "tenant", tenantId: "acme" },
          clock,
          tableNamespace: { tablePrefix: prefix },
        });
        const t2 = createDoPaymentStores({
          namespace: ns2.namespace,
          sharding: { kind: "tenant", tenantId: "globex" },
          clock,
          tableNamespace: { tablePrefix: prefix },
        });
        // Same key on different tenant objects — both acquire (isolated state).
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
      } finally {
        ns2.close();
      }
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
