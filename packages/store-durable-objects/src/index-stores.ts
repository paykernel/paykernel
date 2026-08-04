/**
 * Store factory re-exports without namespace construction.
 * Direct executor / storage paths for tests and in-object use.
 */

import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/testkit";
import { createDoIdempotencyStore } from "./stores/idempotency-store";
import { createDoWebhookInboxStore } from "./stores/webhook-inbox-store";
import { createDoReconciliationStore } from "./stores/reconciliation-store";
import type { DoStoreOptions, DoStorageStoreOptions, DoStoresBundle } from "./types";
import { resolveStoreContext } from "./stores/shared";
import { DO_STORAGE_ADAPTER_MANIFEST } from "./manifest";
import { createDoExecutor } from "./sql-executor";

export { createDoIdempotencyStore } from "./stores/idempotency-store";
export { createDoWebhookInboxStore } from "./stores/webhook-inbox-store";
export { createDoReconciliationStore } from "./stores/reconciliation-store";

/**
 * Convenience bundle: three stores sharing executor, clock, and namespace.
 * Does **not** migrate.
 */
export function createDoStores(options: DoStoreOptions): DoStoresBundle {
  const ctx = resolveStoreContext(options);
  const shared: DoStoreOptions = {
    executor: options.executor,
    clock: ctx.clock,
  };
  if (options.namespace !== undefined) {
    shared.namespace = options.namespace;
  }

  const idempotency: IdempotencyStore = createDoIdempotencyStore(shared);
  const webhookInbox: WebhookInboxStore = createDoWebhookInboxStore(shared);
  const reconciliation: ReconciliationStore =
    createDoReconciliationStore(shared);

  return {
    idempotency,
    webhookInbox,
    reconciliation,
    executor: options.executor,
    namespace: ctx.namespace,
    clock: ctx.clock,
    manifest: DO_STORAGE_ADAPTER_MANIFEST,
  };
}

/**
 * Build stores from DoStorageLike (single partition). Does **not** migrate.
 */
export function createDoStoresFromStorage(
  options: DoStorageStoreOptions,
): DoStoresBundle {
  const executor = createDoExecutor(options.storage);
  const storeOpts: DoStoreOptions = { executor };
  if (options.clock !== undefined) storeOpts.clock = options.clock;
  if (options.namespace !== undefined) storeOpts.namespace = options.namespace;
  return createDoStores(storeOpts);
}
