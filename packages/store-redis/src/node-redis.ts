/**
 * Subpath: @paykernel/store-redis/node-redis
 *
 * Prefer disableOfflineQueue: true (see NODE_REDIS_STORE_CLIENT_DEFAULTS).
 * Cluster: keys.clusterKeys: true for hash-tag co-location.
 */

export {
  createPortFromNodeRedis,
  createNodeRedisCommandPort,
  NODE_REDIS_STORE_CLIENT_DEFAULTS,
  createRedisIdempotencyStoreFromNodeRedis,
  createRedisWebhookInboxStoreFromNodeRedis,
  createRedisReconciliationStoreFromNodeRedis,
  createRedisStoresFromNodeRedis,
} from "./drivers/node-redis";
export type { NodeRedisLike, NodeRedisStoreOptions } from "./drivers/node-redis";

export {
  createRedisIdempotencyStore,
  createRedisWebhookInboxStore,
  createRedisReconciliationStore,
  createRedisStores,
} from "./index-stores";

export {
  REDIS_STORAGE_ADAPTER_MANIFEST,
  getRedisStorageAdapterManifest,
} from "./manifest";
