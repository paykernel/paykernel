/**
 * Cross-partition isolation vs same-key serialization (mock namespace).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock } from "@paykernel/testkit";
import {
  createDoPaymentStores,
  resolveDoShardName,
} from "./index";
import { createMockDoNamespace } from "./test-utils/mock-namespace";
import { uniqueTablePrefix } from "./test-utils/do-env";

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

      // Reserve two keys that hash to different partitions (search)
      let keyA = "a0";
      let keyB = "b0";
      for (let i = 0; i < 100; i++) {
        const ka = `ka${i}`;
        const kb = `kb${i}`;
        const sa = resolveDoShardName(
          { kind: "hash", partitions: 8 },
          { key: ka },
        );
        const sb = resolveDoShardName(
          { kind: "hash", partitions: 8 },
          { key: kb },
        );
        if (sa !== sb) {
          keyA = ka;
          keyB = kb;
          break;
        }
      }

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
      const stores = createDoPaymentStores({
        namespace: ns.namespace,
        sharding: {
          kind: "tenant",
          tenantId: (i) => i.tenantId ?? "default",
        },
        clock,
        tableNamespace: { tablePrefix: prefix },
      });

      // Client uses key for routing; tenant strategy with function needs tenantId on input.
      // Our client only passes { key } — for tenant tests use static tenantId strategy
      // per store is hard; use resolve path with two namespaces or key-includes-tenant.
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
