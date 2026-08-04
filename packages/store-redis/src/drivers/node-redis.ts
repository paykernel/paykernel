/**
 * node-redis (`redis` package) binding — optional peer, isolated subpath only.
 *
 * Cluster-capable: pass `keys: { clusterKeys: true }` so record + index share hash tags.
 * Prefer `disableOfflineQueue: true` when constructing the client so correctness-critical
 * commands do not silently replay after reconnect.
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

/** Minimal node-redis v4+ client surface. */
export type NodeRedisLike = {
  sendCommand(args: string[]): Promise<unknown>;
};

/**
 * Recommended node-redis client options for PayKernel stores.
 * Offline queue disabled for correctness-critical Lua / claims.
 */
export const NODE_REDIS_STORE_CLIENT_DEFAULTS = {
  disableOfflineQueue: true,
} as const;

/**
 * Adapt a node-redis client to {@link RedisCommandPort}.
 *
 * Prefer constructing the client with {@link NODE_REDIS_STORE_CLIENT_DEFAULTS}.
 */
export function createPortFromNodeRedis(client: NodeRedisLike): RedisCommandPort {
  return {
    async send(command: string, args: readonly string[]): Promise<unknown> {
      return client.sendCommand([command, ...args]);
    },
  };
}

/** Alias preferred by package docs / Phase 13 API. */
export const createNodeRedisCommandPort = createPortFromNodeRedis;

export type NodeRedisStoreOptions = {
  client: NodeRedisLike;
  clock?: StoreClock;
  /**
   * Key design. For Redis Cluster, set `clusterKeys: true` so record + index
   * share a hash tag (same slot).
   */
  keys?: KeyOptions;
  retentionTtlMs?: number;
};

function toOptions(opts: NodeRedisStoreOptions): RedisStoreOptions {
  const base: RedisStoreOptions = {
    port: createNodeRedisCommandPort(opts.client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.keys !== undefined) base.keys = opts.keys;
  if (opts.retentionTtlMs !== undefined) base.retentionTtlMs = opts.retentionTtlMs;
  return base;
}

export function createRedisIdempotencyStoreFromNodeRedis(opts: NodeRedisStoreOptions) {
  return createRedisIdempotencyStore(toOptions(opts));
}

export function createRedisWebhookInboxStoreFromNodeRedis(opts: NodeRedisStoreOptions) {
  return createRedisWebhookInboxStore(toOptions(opts));
}

export function createRedisReconciliationStoreFromNodeRedis(
  opts: NodeRedisStoreOptions,
) {
  return createRedisReconciliationStore(toOptions(opts));
}

export function createRedisStoresFromNodeRedis(
  opts: NodeRedisStoreOptions,
): RedisStoresBundle {
  return createRedisStores(toOptions(opts));
}
