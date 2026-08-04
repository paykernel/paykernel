import { describe, expect, it } from "bun:test";
import {
  DEFAULT_KEY_PREFIX,
  DEFAULT_SCHEMA_VERSION,
  formatHashTag,
  recordKey,
  reconciliationDueIndexKey,
  resolveKeyDesign,
  RedisKeyDesignError,
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
});
