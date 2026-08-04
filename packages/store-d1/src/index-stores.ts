/**
 * Store factory re-exports without binding construction.
 * Used so binding helpers and root can share one implementation graph.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/store-contracts";
import { createD1IdempotencyStore } from "./stores/idempotency-store";
import { createD1WebhookInboxStore } from "./stores/webhook-inbox-store";
import { createD1ReconciliationStore } from "./stores/reconciliation-store";
import type { D1StoreOptions, D1StoresBundle } from "./types";
import { resolveStoreContext } from "./stores/shared";
import { D1_STORAGE_ADAPTER_MANIFEST } from "./manifest";

export { createD1IdempotencyStore } from "./stores/idempotency-store";
export { createD1WebhookInboxStore } from "./stores/webhook-inbox-store";
export { createD1ReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing executor, clock, and namespace.
 * Does **not** migrate.
 */
export function createD1Stores(options: D1StoreOptions): D1StoresBundle {
  // Resolve once so namespace validation fails early and clock is shared by identity.
  const ctx = resolveStoreContext(options);
  const shared: D1StoreOptions = {
    executor: options.executor,
    clock: ctx.clock,
  };
  if (options.namespace !== undefined) {
    shared.namespace = options.namespace;
  }

  const idempotency: IdempotencyStore = createD1IdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createD1WebhookInboxStore(shared);
  const reconciliation: ReconciliationStore = createD1ReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    executor: options.executor,
    namespace: ctx.namespace,
    clock: ctx.clock,
    manifest: D1_STORAGE_ADAPTER_MANIFEST,
  };
}
