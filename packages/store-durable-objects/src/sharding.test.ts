import { describe, expect, it } from "bun:test";
import {
  resolveDoShardName,
  resolveDoDiscoveryPartitions,
  enumerateDoPartitionShardNames,
  assertDoShardingStrategy,
  hashStringToUint32,
  RECOMMENDED_HASH_PARTITIONS,
} from "./sharding";

describe("resolveDoShardName", () => {
  it("key strategy: same key → same shard; different keys differ", () => {
    const a = resolveDoShardName({ kind: "key" }, { key: "pay_1" });
    const b = resolveDoShardName({ kind: "key" }, { key: "pay_1" });
    const c = resolveDoShardName({ kind: "key" }, { key: "pay_2" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("key:pay_1");
  });

  it("hash strategy: same key → same partition; may differ across keys", () => {
    const s = { kind: "hash" as const, partitions: 16 };
    const a = resolveDoShardName(s, { key: "alpha" });
    const b = resolveDoShardName(s, { key: "alpha" });
    expect(a).toBe(b);
    expect(a).toMatch(/^hash:16:\d+$/);
    // Across many keys we expect multiple partitions (probabilistic)
    const parts = new Set(
      Array.from({ length: 50 }, (_, i) =>
        resolveDoShardName(s, { key: `k${i}` }),
      ),
    );
    expect(parts.size).toBeGreaterThan(1);
  });

  it("tenant strategy: isolates by tenant", () => {
    const s = { kind: "tenant" as const, tenantId: "t-static" };
    expect(resolveDoShardName(s, { key: "a" })).toBe("tenant:t-static");
    expect(
      resolveDoShardName(
        { kind: "tenant", tenantId: (i) => i.tenantId! },
        { key: "a", tenantId: "acme" },
      ),
    ).toBe("tenant:acme");
  });

  it("prefix is prepended without creating global singleton", () => {
    const a = resolveDoShardName(
      { kind: "key" },
      { key: "x" },
      { prefix: "payments-v1" },
    );
    const b = resolveDoShardName(
      { kind: "key" },
      { key: "y" },
      { prefix: "payments-v1" },
    );
    expect(a).toBe("payments-v1:key:x");
    expect(b).toBe("payments-v1:key:y");
    expect(a).not.toBe(b);
  });

  it("rejects blank key, partitions < 1, empty tenant, global", () => {
    expect(() => resolveDoShardName({ kind: "key" }, { key: "  " })).toThrow();
    expect(() =>
      resolveDoShardName({ kind: "hash", partitions: 0 }, { key: "a" }),
    ).toThrow();
    expect(() =>
      resolveDoShardName(
        { kind: "tenant", tenantId: "" },
        { key: "a" },
      ),
    ).toThrow();
    expect(() =>
      assertDoShardingStrategy({ kind: "global" }),
    ).toThrow(/global/);
    expect(() => assertDoShardingStrategy(null)).toThrow();
  });

  it("hashStringToUint32 is stable", () => {
    expect(hashStringToUint32("hello")).toBe(hashStringToUint32("hello"));
    expect(RECOMMENDED_HASH_PARTITIONS).toBe(16);
  });
});

describe("resolveDoDiscoveryPartitions", () => {
  it("hash: enumerates all N partitions in stable order", () => {
    const r = resolveDoDiscoveryPartitions({ kind: "hash", partitions: 4 });
    expect(r.kind).toBe("partitions");
    if (r.kind !== "partitions") return;
    expect([...r.shardNames]).toEqual([
      "hash:4:0",
      "hash:4:1",
      "hash:4:2",
      "hash:4:3",
    ]);
    expect(enumerateDoPartitionShardNames({ kind: "hash", partitions: 4 })).toEqual(
      r.shardNames,
    );
  });

  it("hash partitions=1: single partition (fast path size)", () => {
    const r = resolveDoDiscoveryPartitions({ kind: "hash", partitions: 1 });
    expect(r.kind).toBe("partitions");
    if (r.kind !== "partitions") return;
    expect([...r.shardNames]).toEqual(["hash:1:0"]);
  });

  it("hash: prefix is applied to every partition name", () => {
    const r = resolveDoDiscoveryPartitions(
      { kind: "hash", partitions: 2 },
      { prefix: "payments-v1" },
    );
    expect(r.kind).toBe("partitions");
    if (r.kind !== "partitions") return;
    expect([...r.shardNames]).toEqual([
      "payments-v1:hash:2:0",
      "payments-v1:hash:2:1",
    ]);
  });

  it("static tenant: single partition", () => {
    const r = resolveDoDiscoveryPartitions({
      kind: "tenant",
      tenantId: "acme",
    });
    expect(r.kind).toBe("partitions");
    if (r.kind !== "partitions") return;
    expect([...r.shardNames]).toEqual(["tenant:acme"]);
  });

  it("key strategy: unsupported (no silent sentinel)", () => {
    const r = resolveDoDiscoveryPartitions({ kind: "key" });
    expect(r.kind).toBe("unsupported");
    if (r.kind !== "unsupported") return;
    expect(r.reason).toMatch(/kind "key"/);
    expect(r.reason).toMatch(/hash/);
    expect(() => enumerateDoPartitionShardNames({ kind: "key" })).toThrow(
      /kind "key"/,
    );
  });

  it("dynamic tenant function: unsupported", () => {
    const r = resolveDoDiscoveryPartitions({
      kind: "tenant",
      tenantId: (i) => i.tenantId ?? "default",
    });
    expect(r.kind).toBe("unsupported");
    if (r.kind !== "unsupported") return;
    expect(r.reason).toMatch(/dynamic tenantId/);
  });
});
