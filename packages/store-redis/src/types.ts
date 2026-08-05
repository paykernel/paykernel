/**
 * Shared option types for the Redis adapter.
 */

import type { RedisCommandPort } from "./port";
import type { StoreClock } from "./clock";
import type { KeyOptions, ResolvedKeyDesign } from "./keys";

export type { RedisCommandPort } from "./port";
export type { StoreClock } from "./clock";
export type { KeyOptions, ResolvedKeyDesign } from "./keys";

/**
 * Options shared by all createRedis*Store factories.
 *
 * - `port` is required (narrow command port; no driver import at root).
 * - `clock` is optional; default wall clock. Prefer FakeClock in tests.
 * - `keys` configures prefix / tenant / cluster hash tags.
 * - Factories do **not** require Redis at install time (optional adapter).
 */
export type RedisStoreOptions = {
  port: RedisCommandPort;
  /** Injectable clock for lease expiry / ISO timestamps (FakeClock-compatible). */
  clock?: StoreClock;
  /** Key namespace / hash-tag options. */
  keys?: KeyOptions;
  /**
   * When set (>0), terminal **webhook dead_letter / recon failed|manual_review**
   * records may get Redis EXPIRE after fail/markManualReview.
   * **Completed fences never EXPIRE** (REDIS-1 idempotency + STORES-5 webhook/recon):
   * silent eviction re-opens claim and can reprocess paid / re-run recon.
   * Use `deleteExpired` for intentional cleanup. Default (unset/0) is safe.
   */
  retentionTtlMs?: number;
};

export type RedisStoresBundle = {
  idempotency: import("@paykernel/store-contracts").IdempotencyStore;
  webhookInbox: import("@paykernel/store-contracts").WebhookInboxStore;
  reconciliation: import("@paykernel/store-contracts").ReconciliationStore;
  port: RedisCommandPort;
  keys: ResolvedKeyDesign;
  clock: StoreClock;
  manifest: import("@paykernel/store-contracts").StorageAdapterManifest;
};
