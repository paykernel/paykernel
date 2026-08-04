/**
 * Driver binding smoke tests — construct ports/stores without a live server.
 * Binding parity for tagged EVAL mapping via mock clients.
 */
import { describe, expect, it } from "bun:test";
import { isRedisCommandPort } from "../port";
import { parseTaggedResult } from "../scripts";
import {
  createPortFromBunRedis,
  createBunRedisCommandPort,
  createRedisStoresFromBun,
  assertBunTopologyAllowed,
  type BunRedisClientLike,
} from "./bun";
import {
  createPortFromIoredis,
  createIoredisCommandPort,
  createRedisStoresFromIoredis,
  IOREDIS_STORE_CLIENT_DEFAULTS,
  type IoredisLike,
} from "./ioredis";
import {
  createPortFromNodeRedis,
  createNodeRedisCommandPort,
  createRedisStoresFromNodeRedis,
  NODE_REDIS_STORE_CLIENT_DEFAULTS,
  type NodeRedisLike,
} from "./node-redis";
import {
  createPortFromUpstash,
  createUpstashCommandPort,
  createRedisStoresFromUpstash,
  type UpstashRedisLike,
} from "./upstash";
import { StoreUnsupportedFeatureError } from "@paykernel/testkit";

describe("bun binding (no connect)", () => {
  const client: BunRedisClientLike = {
    async send(command, args) {
      if (command.toUpperCase() === "PING") return "PONG";
      if (command.toUpperCase() === "EVAL") {
        return ["acquired", "k", "reserved", "fp", "w", "lt", "2099", "1", "1", "t", "t", "", "lt"];
      }
      return [command, ...args];
    },
  };

  it("aliases produce equivalent RedisCommandPort", async () => {
    const a = createPortFromBunRedis(client);
    const b = createBunRedisCommandPort(client);
    expect(isRedisCommandPort(a)).toBe(true);
    expect(isRedisCommandPort(b)).toBe(true);
    expect(await a.send("PING", [])).toBe("PONG");
    expect(await b.send("PING", [])).toBe("PONG");
  });

  it("store bundle constructs without connecting", () => {
    const stores = createRedisStoresFromBun({ redis: { client } });
    expect(stores.idempotency).toBeDefined();
    expect(stores.webhookInbox).toBeDefined();
    expect(stores.reconciliation).toBeDefined();
    expect(stores.manifest.name).toBe("redis");
  });

  it("rejects cluster / sentinel / clusterKeys topology", () => {
    expect(() =>
      assertBunTopologyAllowed({ cluster: true }),
    ).toThrow(StoreUnsupportedFeatureError);
    expect(() =>
      assertBunTopologyAllowed({ sentinels: [{ host: "x" }] }),
    ).toThrow(StoreUnsupportedFeatureError);
    expect(() =>
      createRedisStoresFromBun({
        redis: { client },
        keys: { clusterKeys: true },
      }),
    ).toThrow(StoreUnsupportedFeatureError);
  });
});

describe("ioredis binding (no connect)", () => {
  const client: IoredisLike = {
    async call(command, ...args) {
      if (String(command).toUpperCase() === "PING") return "PONG";
      return [command, ...args];
    },
  };

  it("aliases produce equivalent RedisCommandPort", async () => {
    const a = createPortFromIoredis(client);
    const b = createIoredisCommandPort(client);
    expect(await a.send("PING", [])).toBe("PONG");
    expect(await b.send("GET", ["k"])).toEqual(["GET", "k"]);
  });

  it("documents offline-queue defaults for correctness-critical ops", () => {
    expect(IOREDIS_STORE_CLIENT_DEFAULTS.enableOfflineQueue).toBe(false);
    expect(IOREDIS_STORE_CLIENT_DEFAULTS.maxRetriesPerRequest).toBe(1);
  });

  it("store bundle constructs without connecting", () => {
    const stores = createRedisStoresFromIoredis({ client });
    expect(stores.port).toBeDefined();
    expect(stores.manifest.durability).toBe("configuration-dependent");
  });
});

describe("node-redis binding (no connect)", () => {
  const client: NodeRedisLike = {
    async sendCommand(args) {
      if (args[0]?.toUpperCase() === "PING") return "PONG";
      return args;
    },
  };

  it("aliases produce equivalent RedisCommandPort", async () => {
    const a = createPortFromNodeRedis(client);
    const b = createNodeRedisCommandPort(client);
    expect(await a.send("PING", [])).toBe("PONG");
    expect(await b.send("GET", ["k"])).toEqual(["GET", "k"]);
  });

  it("documents offline-queue defaults", () => {
    expect(NODE_REDIS_STORE_CLIENT_DEFAULTS.disableOfflineQueue).toBe(true);
  });

  it("store bundle constructs without connecting", () => {
    const stores = createRedisStoresFromNodeRedis({
      client,
      keys: { clusterKeys: true, tenantId: "acme" },
    });
    expect(stores.keys.clusterKeys).toBe(true);
    expect(stores.keys.hashTagBody).toBe("acme");
  });
});

describe("upstash binding (no connect)", () => {
  const client: UpstashRedisLike = {
    async eval(script, keys, args) {
      return ["acquired", script.slice(0, 4), keys[0] ?? "", String(args[0] ?? "")];
    },
    async get(key: string) {
      return `v:${key}`;
    },
    async ping() {
      return "PONG";
    },
  };

  it("aliases produce equivalent RedisCommandPort", async () => {
    const a = createPortFromUpstash(client);
    const b = createUpstashCommandPort(client);
    expect(await a.send("PING", [])).toBe("PONG");
    expect(await b.send("GET", ["k1"])).toBe("v:k1");
  });

  it("routes EVAL through client.eval (server-side Lua)", async () => {
    const port = createUpstashCommandPort(client);
    const raw = await port.send("EVAL", ["return 1", "1", "key1", "arg1"]);
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as string[])[0]).toBe("acquired");
  });

  it("store bundle constructs without connecting", () => {
    const stores = createRedisStoresFromUpstash({ client });
    expect(stores.idempotency).toBeDefined();
  });
});

describe("binding parity: tagged EVAL result mapping", () => {
  /**
   * Each binding adapts its client to the same RedisCommandPort contract.
   * When EVAL returns a tagged array, parseTaggedResult yields identical tags.
   */
  const tagged = [
    "acquired",
    "k1",
    "reserved",
    "fp",
    "w1",
    "lt_1",
    "2099-01-01T00:00:00.000Z",
    "1",
    "1",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    "",
    "lt_1",
  ];

  it("bun / ioredis / node-redis / upstash parse same tag", async () => {
    const bunClient: BunRedisClientLike = {
      async send() {
        return tagged;
      },
    };
    const ioredisClient: IoredisLike = {
      async call() {
        return tagged;
      },
    };
    const nodeClient: NodeRedisLike = {
      async sendCommand() {
        return tagged;
      },
    };
    const upstashClient: UpstashRedisLike = {
      async eval() {
        return tagged;
      },
    };

    const ports = [
      createBunRedisCommandPort(bunClient),
      createIoredisCommandPort(ioredisClient),
      createNodeRedisCommandPort(nodeClient),
      createUpstashCommandPort(upstashClient),
    ];

    const tags: string[] = [];
    for (const port of ports) {
      const raw = await port.send("EVAL", ["script", "1", "k", "now"]);
      const parsed = parseTaggedResult(raw);
      tags.push(parsed.tag);
    }
    expect(new Set(tags).size).toBe(1);
    expect(tags[0]).toBe("acquired");
  });
});
