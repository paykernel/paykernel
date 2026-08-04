/**
 * Subpath: @paykernel/store-redis/bun
 *
 * Bun native Redis/Valkey. Rejects Cluster/Sentinel. Prefer injected client.
 * REDIS_URL / VALKEY_URL / PAYMENTS_SDK_REDIS_URL are convenience only
 * (createBunRedisFromEnv / { fromEnv: true }).
 */

export {
  createPortFromBunRedis,
  createBunRedisCommandPort,
  createBunRedisClientFromUrl,
  createBunRedisFromEnv,
  assertBunTopologyAllowed,
  createRedisIdempotencyStoreFromBun,
  createRedisWebhookInboxStoreFromBun,
  createRedisReconciliationStoreFromBun,
  createRedisStoresFromBun,
} from "./drivers/bun";
export type {
  BunRedisClientLike,
  BunRedisConfig,
  BunStoreOptions,
  ForbiddenBunTopology,
} from "./drivers/bun";

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
