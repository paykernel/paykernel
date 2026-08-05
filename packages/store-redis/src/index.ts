/**
 * @paykernel/store-redis
 *
 * Root entry: store factories, manifest, port, key design, types, scripts.
 * ZERO static imports of ioredis / redis / @upstash/redis / Bun Redis.
 * Use subpaths for driver bindings:
 *   @paykernel/store-redis/bun
 *   @paykernel/store-redis/upstash
 *   @paykernel/store-redis/ioredis
 *   @paykernel/store-redis/node-redis
 */

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

export type {
  RedisCommandPort,
  RedisStoreOptions,
  RedisStoresBundle,
  StoreClock,
  KeyOptions,
  ResolvedKeyDesign,
} from "./types";

export {
  createEvalHelper,
  isRedisCommandPort,
} from "./port";
export type { EvalHelper } from "./port";

export {
  createSystemClock,
  clockNowIso,
  clockAddMsIso,
  clockNowMsString,
  clockAddMsString,
} from "./clock";

export {
  mapDriverError,
  withMappedErrors,
  isLikelyDriverFailure,
  StoreError,
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreTimeoutError,
  StoreSerializationFailureError,
  StoreInvalidSchemaError,
  StoreCorruptedRecordError,
} from "./errors";
export type { StoreErrorCode } from "./errors";

export {
  resolveKeyDesign,
  recordKey,
  logicalKeyFromRecordKey,
  webhookRetryIndexKey,
  reconciliationDueIndexKey,
  retentionIndexKey,
  formatHashTag,
  RedisKeyDesignError,
  DEFAULT_KEY_PREFIX,
  DEFAULT_SCHEMA_VERSION,
} from "./keys";
export type { StoreSegment } from "./keys";

export {
  MAX_SANITIZED_ERROR_LENGTH,
  MAX_RESULT_JSON_BYTES,
  MAX_KEY_SEGMENT_LENGTH,
  MAX_REDIS_KEY_LENGTH,
  enforceMaxSanitizedError,
} from "./limits";

export {
  REDIS_SCRIPT_REGISTRY,
  parseTaggedResult,
  parseIdempotencyRecord,
  parseWebhookRecord,
  parseReconciliationRecord,
} from "./scripts";
