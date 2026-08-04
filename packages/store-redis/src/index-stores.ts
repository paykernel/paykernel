/**
 * Store factory re-exports without driver bindings.
 * Used by driver subpaths to avoid circular imports through index.ts.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/store-contracts";
import { createRedisIdempotencyStore } from "./stores/idempotency-store";
import { createRedisWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createRedisReconciliationStore } from "./stores/reconciliation-store";
import type { RedisStoreOptions, RedisStoresBundle } from "./types";
import { resolveRedisStoreContext } from "./stores/shared";
import { REDIS_STORAGE_ADAPTER_MANIFEST } from "./manifest";

export { createRedisIdempotencyStore } from "./stores/idempotency-store";
export { createRedisWebhookInboxStore } from "./stores/webhook-inbox-store";
export { createRedisReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing port, clock, and key design.
 */
export function createRedisStores(options: RedisStoreOptions): RedisStoresBundle {
  const ctx = resolveRedisStoreContext(options);
  const shared: RedisStoreOptions = {
    port: options.port,
    clock: ctx.clock,
  };
  if (options.keys !== undefined) shared.keys = options.keys;
  if (options.retentionTtlMs !== undefined) {
    shared.retentionTtlMs = options.retentionTtlMs;
  }

  const idempotency: IdempotencyStore = createRedisIdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createRedisWebhookInboxStore(shared);
  const reconciliation: ReconciliationStore =
    createRedisReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    port: options.port,
    keys: ctx.keys,
    clock: ctx.clock,
    manifest: REDIS_STORAGE_ADAPTER_MANIFEST,
  };
}
