import { describe, expect, it } from "bun:test";
import {
  assertBunTopologyAllowed,
  createRedisIdempotencyStoreFromBun,
} from "./drivers/bun";
import { StoreUnsupportedFeatureError } from "@paykernel/testkit";

describe("Bun binding topology reject", () => {
  it("assertBunTopologyAllowed rejects clusterKeys", () => {
    expect(() =>
      assertBunTopologyAllowed({ keys: { clusterKeys: true } }),
    ).toThrow(StoreUnsupportedFeatureError);
  });

  it("assertBunTopologyAllowed rejects cluster config", () => {
    expect(() =>
      assertBunTopologyAllowed({ cluster: { nodes: ["a"] } }),
    ).toThrow(StoreUnsupportedFeatureError);
  });

  it("assertBunTopologyAllowed rejects sentinel", () => {
    expect(() =>
      assertBunTopologyAllowed({ sentinel: true }),
    ).toThrow(StoreUnsupportedFeatureError);
  });

  it("factory rejects clusterKeys:true", () => {
    const client = {
      async send() {
        return null;
      },
    };
    expect(() =>
      createRedisIdempotencyStoreFromBun({
        redis: { client },
        keys: { clusterKeys: true },
      }),
    ).toThrow(StoreUnsupportedFeatureError);
  });

  it("allows plain non-cluster keys", () => {
    expect(() =>
      assertBunTopologyAllowed({ keys: { prefix: "psdk", tenantId: "t" } }),
    ).not.toThrow();
  });
});
