/**
 * Store factory re-exports without driver bindings.
 * Used by driver subpaths to avoid circular imports through index.ts.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/testkit";
import { createPostgresIdempotencyStore } from "./stores/idempotency-store";
import { createPostgresWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createPostgresReconciliationStore } from "./stores/reconciliation-store";
import type { PostgresStoreOptions, PostgresStoresBundle } from "./types";
import { resolveStoreContext } from "./stores/shared";
import { POSTGRES_STORAGE_ADAPTER_MANIFEST } from "./manifest";

export { createPostgresIdempotencyStore } from "./stores/idempotency-store";
export { createPostgresWebhookInboxStore } from "./stores/webhook-inbox-store";
export { createPostgresReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing executor, clock, and namespace.
 * Does **not** migrate.
 */
export function createPostgresStores(options: PostgresStoreOptions): PostgresStoresBundle {
  // Resolve once so namespace validation fails early and clock is shared by identity.
  const ctx = resolveStoreContext(options);
  const shared: PostgresStoreOptions = {
    executor: options.executor,
    clock: ctx.clock,
  };
  if (options.namespace !== undefined) {
    shared.namespace = options.namespace;
  }

  const idempotency: IdempotencyStore = createPostgresIdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createPostgresWebhookInboxStore(shared);
  const reconciliation: ReconciliationStore = createPostgresReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    executor: options.executor,
    namespace: ctx.namespace,
    clock: ctx.clock,
    manifest: POSTGRES_STORAGE_ADAPTER_MANIFEST,
  };
}
