import { describe, expect, it } from "bun:test";
import {
  DEFAULT_KEY_PREFIX,
  DEFAULT_SCHEMA_VERSION,
  formatHashTag,
  isReservedRecordLogicalKey,
  logicalKeyFromRecordKey,
  recordKey,
  reconciliationDueIndexKey,
  RESERVED_RECORD_LOGICAL_KEYS,
  resolveKeyDesign,
  RedisKeyDesignError,
  retentionIndexKey,
  webhookRetryIndexKey,
} from "./keys";

describe("resolveKeyDesign", () => {
  it("defaults prefix and version", () => {
    const d = resolveKeyDesign();
    expect(d.prefix).toBe(DEFAULT_KEY_PREFIX);
    expect(d.version).toBe(DEFAULT_SCHEMA_VERSION);
    expect(d.clusterKeys).toBe(false);
    expect(d.tenantId).toBeUndefined();
  });

  it("accepts tenant and cluster hash tags", () => {
    const d = resolveKeyDesign({ tenantId: "acme", clusterKeys: true });
    expect(d.hashTagBody).toBe("acme");
    expect(d.clusterKeys).toBe(true);
  });

  it("uses _ hash tag body when cluster without tenant", () => {
    const d = resolveKeyDesign({ clusterKeys: true });
    expect(d.hashTagBody).toBe("_");
  });

  it("rejects whitespace prefix", () => {
    expect(() => resolveKeyDesign({ prefix: "p sdk" })).toThrow(RedisKeyDesignError);
  });

  it("rejects braces in tenant", () => {
    expect(() => resolveKeyDesign({ tenantId: "{x}" })).toThrow(RedisKeyDesignError);
  });
});

describe("recordKey / indexes", () => {
  it("formats non-cluster record key", () => {
    const d = resolveKeyDesign({ prefix: "psdk", version: "v1" });
    expect(recordKey(d, "idemp", "k1")).toBe("psdk:v1:idemp:k1");
  });

  it("includes tenant segment without cluster", () => {
    const d = resolveKeyDesign({ tenantId: "t1" });
    expect(recordKey(d, "whinbox", "evt")).toBe("psdk:v1:t:t1:whinbox:evt");
  });

  it("uses hash tags when clusterKeys", () => {
    const d = resolveKeyDesign({ tenantId: "t1", clusterKeys: true });
    const k = recordKey(d, "recon", "job1");
    expect(k).toContain("{t1}");
    expect(k).toBe("psdk:v1:{t1}:recon:job1");
    expect(reconciliationDueIndexKey(d)).toBe("psdk:v1:{t1}:recon:due");
    expect(webhookRetryIndexKey(d)).toBe("psdk:v1:{t1}:whinbox:retry");
  });

  it("co-locates index with records under same tag", () => {
    const d = resolveKeyDesign({ clusterKeys: true });
    const rec = recordKey(d, "whinbox", "e1");
    const idx = webhookRetryIndexKey(d);
    expect(rec.includes("{_}")).toBe(true);
    expect(idx.includes("{_}")).toBe(true);
  });

  it("formatHashTag wraps body", () => {
    expect(formatHashTag("tenantA")).toBe("{tenantA}");
  });

  it("rejects reserved logical keys that collide with index suffixes (I4)", () => {
    const d = resolveKeyDesign();
    expect(reconciliationDueIndexKey(d)).toBe("psdk:v1:recon:due");
    expect(webhookRetryIndexKey(d)).toBe("psdk:v1:whinbox:retry");
    expect(retentionIndexKey(d, "idemp")).toBe("psdk:v1:idemp:retain");

    for (const reserved of RESERVED_RECORD_LOGICAL_KEYS) {
      expect(isReservedRecordLogicalKey(reserved)).toBe(true);
      expect(() => recordKey(d, "recon", reserved)).toThrow(RedisKeyDesignError);
      expect(() => recordKey(d, "whinbox", reserved)).toThrow(RedisKeyDesignError);
      expect(() => recordKey(d, "idemp", reserved)).toThrow(RedisKeyDesignError);
    }

    expect(() => recordKey(d, "recon", "due")).toThrow(/reserved/);
    expect(() => recordKey(d, "whinbox", "retry")).toThrow(/reserved/);
    expect(() => recordKey(d, "idemp", "retain")).toThrow(/reserved/);

    // Case-sensitive exact: mixed/upper case must not collide with indexes.
    expect(recordKey(d, "recon", "Due")).toBe("psdk:v1:recon:Due");
    expect(recordKey(d, "whinbox", "RETRY")).toBe("psdk:v1:whinbox:RETRY");
    expect(recordKey(d, "idemp", "Retain")).toBe("psdk:v1:idemp:Retain");
    expect(recordKey(d, "recon", "job:due")).toBe("psdk:v1:recon:job:due");
    expect(recordKey(d, "whinbox", "retry-1")).toBe("psdk:v1:whinbox:retry-1");
  });
});

describe("logicalKeyFromRecordKey (REDIS-1)", () => {
  it("preserves composite logical keys with colons (webhook gateway:eventId)", () => {
    const d = resolveKeyDesign();
    const logical = "stripe:evt_123";
    const redisKey = recordKey(d, "whinbox", logical);
    expect(redisKey).toBe("psdk:v1:whinbox:stripe:evt_123");
    // Broken pop() would yield only "evt_123" and orphan ZSET members.
    expect(redisKey.split(":").pop()).toBe("evt_123");
    expect(logicalKeyFromRecordKey(d, "whinbox", redisKey)).toBe(logical);
  });

  it("works with tenant and cluster hash-tag layouts", () => {
    const tenant = resolveKeyDesign({ tenantId: "acme" });
    const k1 = recordKey(tenant, "recon", "job:part:a");
    expect(logicalKeyFromRecordKey(tenant, "recon", k1)).toBe("job:part:a");

    const cluster = resolveKeyDesign({ tenantId: "acme", clusterKeys: true });
    const k2 = recordKey(cluster, "whinbox", "gw:id");
    expect(k2).toBe("psdk:v1:{acme}:whinbox:gw:id");
    expect(logicalKeyFromRecordKey(cluster, "whinbox", k2)).toBe("gw:id");
  });

  it("returns undefined for index keys and wrong store segment", () => {
    const d = resolveKeyDesign();
    expect(logicalKeyFromRecordKey(d, "whinbox", webhookRetryIndexKey(d))).toBe(
      undefined,
    );
    expect(
      logicalKeyFromRecordKey(d, "recon", reconciliationDueIndexKey(d)),
    ).toBe(undefined);
    expect(
      logicalKeyFromRecordKey(d, "idemp", retentionIndexKey(d, "idemp")),
    ).toBe(undefined);
    expect(
      logicalKeyFromRecordKey(d, "whinbox", recordKey(d, "recon", "x")),
    ).toBe(undefined);
  });
});
