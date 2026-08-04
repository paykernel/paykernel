/**
 * ioredis binding — optional peer, isolated subpath only.
 *
 * Prefer `enableOfflineQueue: false` for correctness-critical store ops so
 * reconnect does not silently replay EVAL / claims. Cluster-capable when the
 * caller uses `Redis.Cluster` + `keys: { clusterKeys: true }` hash tags.
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

/** Minimal ioredis surface used by the adapter. */
export type IoredisLike = {
  call(command: string, ...args: (string | number | Buffer)[]): Promise<unknown>;
  sendCommand?(command: unknown): Promise<unknown>;
};

/**
 * Recommended ioredis connection options for PayKernel stores.
 * Offline queue OFF avoids replaying correctness-critical Lua after reconnect.
 */
export const IOREDIS_STORE_CLIENT_DEFAULTS = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
} as const;

/**
 * Adapt an ioredis client/cluster to {@link RedisCommandPort}.
 *
 * Prefer constructing the client with {@link IOREDIS_STORE_CLIENT_DEFAULTS}
 * (`enableOfflineQueue: false`).
 */
export function createPortFromIoredis(client: IoredisLike): RedisCommandPort {
  return {
    async send(command: string, args: readonly string[]): Promise<unknown> {
      return client.call(command, ...args);
    },
  };
}

/** Alias preferred by package docs / Phase 13 API. */
export const createIoredisCommandPort = createPortFromIoredis;

export type IoredisStoreOptions = {
  client: IoredisLike;
  clock?: StoreClock;
  /**
   * Key design. For `Redis.Cluster`, set `clusterKeys: true` so record + index
   * share a hash tag (same slot).
   */
  keys?: KeyOptions;
  retentionTtlMs?: number;
};

function toOptions(opts: IoredisStoreOptions): RedisStoreOptions {
  const base: RedisStoreOptions = {
    port: createIoredisCommandPort(opts.client),
  };
  if (opts.clock !== undefined) base.clock = opts.clock;
  if (opts.keys !== undefined) base.keys = opts.keys;
  if (opts.retentionTtlMs !== undefined) base.retentionTtlMs = opts.retentionTtlMs;
  return base;
}

export function createRedisIdempotencyStoreFromIoredis(opts: IoredisStoreOptions) {
  return createRedisIdempotencyStore(toOptions(opts));
}

export function createRedisWebhookInboxStoreFromIoredis(opts: IoredisStoreOptions) {
  return createRedisWebhookInboxStore(toOptions(opts));
}

export function createRedisReconciliationStoreFromIoredis(opts: IoredisStoreOptions) {
  return createRedisReconciliationStore(toOptions(opts));
}

export function createRedisStoresFromIoredis(
  opts: IoredisStoreOptions,
): RedisStoresBundle {
  return createRedisStores(toOptions(opts));
}
