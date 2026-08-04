/**
 * Bun native Redis/Valkey binding — runtime-provided, isolated subpath only.
 *
 * Preferred config: inject a `Bun.RedisClient` instance.
 * URL / REDIS_URL / VALKEY_URL / PAYMENTS_SDK_REDIS_URL are convenience only.
 *
 * Rejects Cluster / Sentinel topology and `clusterKeys: true`.
 * Commands go through `client.send()` (EVAL / non-first-class ops).
 * Prefer fail-fast over offline queue replay for correctness-critical ops.
 * Do not use Pub/Sub for webhook delivery correctness.
 * MULTI/EXEC require raw send() — claims use Lua scripts instead.
 */

import type { RedisCommandPort } from "../port";
import {
  createRedisIdempotencyStore,
  createRedisWebhookInboxStore,
  createRedisReconciliationStore,
  createRedisStores,
} from "../index-stores";
import type { RedisStoreOptions, RedisStoresBundle } from "../types";
import type { StoreClock } from "../clock";
import type { KeyOptions } from "../keys";
import { StoreUnsupportedFeatureError } from "@paykernel/store-contracts";

/** Minimal Bun RedisClient surface (send for non-first-class commands). */
export type BunRedisClientLike = {
  send(command: string, args: string[]): Promise<unknown>;
  close?(): void;
  connect?(): Promise<void>;
};

export type BunRedisConfig =
  | { client: BunRedisClientLike }
  | { url: string }
  | { /** Discover PAYMENTS_SDK_REDIS_URL / REDIS_URL / VALKEY_URL (convenience only). */ fromEnv: true };

export type BunStoreOptions = {
  /**
   * Injected client (preferred), URL, or env discovery.
   * Cluster/Sentinel config objects are rejected.
   */
  redis: BunRedisConfig | BunRedisClientLike;
  clock?: StoreClock;
  keys?: KeyOptions;
  retentionTtlMs?: number;
};

/**
 * Topology options that Bun's native client does not support.
 * Passing these rejects at factory construction.
 */
export type ForbiddenBunTopology = {
  cluster?: unknown;
  sentinel?: unknown;
  sentinels?: unknown;
  enableReadyCheck?: unknown;
  nodes?: unknown;
  clusterKeys?: true;
};

export function assertBunTopologyAllowed(
  opts: { keys?: KeyOptions } & ForbiddenBunTopology,
): void {
  if (opts.keys?.clusterKeys === true) {
    throw new StoreUnsupportedFeatureError(
      "Bun Redis binding does not support clusterKeys / Redis Cluster",
    );
  }
  if (opts.cluster !== undefined && opts.cluster !== false && opts.cluster !== null) {
    throw new StoreUnsupportedFeatureError(
      "Bun Redis binding does not support Redis Cluster configuration",
    );
  }
  if (
    (opts.sentinel !== undefined && opts.sentinel !== false && opts.sentinel !== null) ||
    (opts.sentinels !== undefined && opts.sentinels !== null)
  ) {
    throw new StoreUnsupportedFeatureError(
      "Bun Redis binding does not support Redis Sentinel configuration",
    );
  }
  if (opts.nodes !== undefined && opts.nodes !== null) {
    throw new StoreUnsupportedFeatureError(
      "Bun Redis binding does not support cluster nodes configuration",
    );
  }
}

function resolveUrlFromEnv(): string {
  const url =
    process.env["PAYMENTS_SDK_REDIS_URL"] ??
    process.env["REDIS_URL"] ??
    process.env["VALKEY_URL"];
  if (!url) {
    throw new Error(
      "Bun Redis convenience URL: set PAYMENTS_SDK_REDIS_URL, REDIS_URL, or VALKEY_URL",
    );
  }
  return url;
}

/**
 * Create a Bun.RedisClient from URL (convenience). Prefer injected client.
 */
export function createBunRedisClientFromUrl(url: string): BunRedisClientLike {
  // Dynamic access — avoids root import of Bun types in portable graph.
  const BunGlobal = (
    globalThis as {
      Bun?: {
        redis?: unknown;
        RedisClient?: new (url: string) => BunRedisClientLike;
      };
    }
  ).Bun;
  if (!BunGlobal) {
    throw new Error("Bun runtime required for /bun Redis binding");
  }
  if (typeof BunGlobal.RedisClient === "function") {
    return new BunGlobal.RedisClient(url);
  }
  throw new Error("Bun.RedisClient is not available in this Bun version");
}

/**
 * Convenience: construct a Bun Redis client from PAYMENTS_SDK_REDIS_URL /
 * REDIS_URL / VALKEY_URL. Prefer inject + createBunRedisCommandPort in apps.
 */
export function createBunRedisFromEnv(): BunRedisClientLike {
  return createBunRedisClientFromUrl(resolveUrlFromEnv());
}

function resolveClient(redis: BunStoreOptions["redis"]): BunRedisClientLike {
  if (typeof redis === "object" && redis !== null && "send" in redis) {
    return redis as BunRedisClientLike;
  }
  const cfg = redis as BunRedisConfig;
  if ("client" in cfg) {
    return cfg.client;
  }
  if ("url" in cfg) {
    return createBunRedisClientFromUrl(cfg.url);
  }
  if ("fromEnv" in cfg && cfg.fromEnv) {
    return createBunRedisFromEnv();
  }
  throw new Error("Invalid Bun Redis config");
}

/**
 * Adapt Bun RedisClient to {@link RedisCommandPort} via raw `send()`.
 *
 * Offline command queue: Bun should not silently replay correctness-critical
 * EVAL after reconnect; prefer fail-fast and re-issue application-level ops.
 * MULTI/EXEC (when needed) also go through send(); stores use Lua instead.
 */
export function createPortFromBunRedis(client: BunRedisClientLike): RedisCommandPort {
  return {
    async send(command: string, args: readonly string[]): Promise<unknown> {
      return client.send(command, args as string[]);
    },
  };
}

/** Alias preferred by package docs / Phase 13.1 API. */
export const createBunRedisCommandPort = createPortFromBunRedis;

function toOptions(opts: BunStoreOptions): RedisStoreOptions {
  const topologyCheck: Parameters<typeof assertBunTopologyAllowed>[0] = {};
  if (opts.keys !== undefined) topologyCheck.keys = opts.keys;
  assertBunTopologyAllowed(topologyCheck);
  const client = resolveClient(opts.redis);
  const base: RedisStoreOptions = {
    port: createBunRedisCommandPort(client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.keys !== undefined) {
    if (opts.keys.clusterKeys === true) {
      throw new StoreUnsupportedFeatureError(
        "Bun Redis binding does not support clusterKeys / Redis Cluster",
      );
    }
    base.keys = opts.keys;
  }
  if (opts.retentionTtlMs !== undefined) base.retentionTtlMs = opts.retentionTtlMs;
  return base;
}

export function createRedisIdempotencyStoreFromBun(opts: BunStoreOptions) {
  return createRedisIdempotencyStore(toOptions(opts));
}

export function createRedisWebhookInboxStoreFromBun(opts: BunStoreOptions) {
  return createRedisWebhookInboxStore(toOptions(opts));
}

export function createRedisReconciliationStoreFromBun(opts: BunStoreOptions) {
  return createRedisReconciliationStore(toOptions(opts));
}

/**
 * Create all three stores from an injected Bun client or URL.
 * Prefer `{ redis: { client } }` over URL convenience constructors.
 */
export function createRedisStoresFromBun(opts: BunStoreOptions): RedisStoresBundle {
  return createRedisStores(toOptions(opts));
}
