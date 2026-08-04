/**
 * Store factory re-exports without driver bindings.
 * Used by driver subpaths to avoid circular imports through index.ts.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/store-contracts";
import { createTursoIdempotencyStore } from "./stores/idempotency-store";
import { createTursoWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createTursoReconciliationStore } from "./stores/reconciliation-store";
import type { TursoStoreOptions, TursoStoresBundle } from "./types";
import { resolveStoreContext } from "./stores/shared";
import { TURSO_STORAGE_ADAPTER_MANIFEST } from "./manifest";

export { createTursoIdempotencyStore } from "./stores/idempotency-store";
export { createTursoWebhookInboxStore } from "./stores/webhook-inbox-store";
export { createTursoReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing executor, clock, and namespace.
 * Does **not** migrate.
 */
export function createTursoStores(options: TursoStoreOptions): TursoStoresBundle {
  // Resolve once so namespace validation fails early and clock is shared by identity.
  const ctx = resolveStoreContext(options);
  const shared: TursoStoreOptions = {
    executor: options.executor,
    clock: ctx.clock,
  };
  if (options.namespace !== undefined) {
    shared.namespace = options.namespace;
  }

  const idempotency: IdempotencyStore = createTursoIdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createTursoWebhookInboxStore(shared);
  const reconciliation: ReconciliationStore = createTursoReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    executor: options.executor,
    namespace: ctx.namespace,
    clock: ctx.clock,
    manifest: TURSO_STORAGE_ADAPTER_MANIFEST,
  };
}
