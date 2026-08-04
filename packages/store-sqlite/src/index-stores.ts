/**
 * Store factory re-exports without driver bindings.
 * Used by driver subpaths to avoid circular imports through index.ts.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/testkit";
import { createSqliteIdempotencyStore } from "./stores/idempotency-store";
import { createSqliteWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createSqliteReconciliationStore } from "./stores/reconciliation-store";
import type { SqliteStoreOptions, SqliteStoresBundle } from "./types";
import { resolveStoreContext } from "./stores/shared";
import { SQLITE_STORAGE_ADAPTER_MANIFEST } from "./manifest";

export { createSqliteIdempotencyStore } from "./stores/idempotency-store";
export { createSqliteWebhookInboxStore } from "./stores/webhook-inbox-store";
export { createSqliteReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing executor, clock, and namespace.
 * Does **not** migrate.
 */
export function createSqliteStores(options: SqliteStoreOptions): SqliteStoresBundle {
  // Resolve once so namespace validation fails early and clock is shared by identity.
  const ctx = resolveStoreContext(options);
  const shared: SqliteStoreOptions = {
    executor: options.executor,
    clock: ctx.clock,
  };
  if (options.namespace !== undefined) {
    shared.namespace = options.namespace;
  }

  const idempotency: IdempotencyStore = createSqliteIdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createSqliteWebhookInboxStore(shared);
  const reconciliation: ReconciliationStore = createSqliteReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    executor: options.executor,
    namespace: ctx.namespace,
    clock: ctx.clock,
    manifest: SQLITE_STORAGE_ADAPTER_MANIFEST,
  };
}
