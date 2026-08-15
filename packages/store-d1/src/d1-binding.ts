/**
 * Ergonomic Workers D1 binding factories (Phase 16.1).
 *
 * Primary roadmap API: createD1PaymentStores({ db: env.PAYMENTS_DB }).
 * Does **not** migrate — call migrateD1Adapter explicitly.
 * Does **not** require Cloudflare REST / account API tokens.
 *
 * **Sessions default:** when `db.withSession` exists and `session` is omitted,
 * binding factories and `createD1Executor` use `"first-primary"` so post-claim
 * SELECTs are not served from a stale replica under D1 read replication.
 * Pass `session: false` to opt out.
 */

import { createD1Executor } from "./executor";
import { createD1Stores } from "./index-stores";
import type { D1BindingStoreOptions, D1StoresBundle, D1StoreOptions } from "./types";
import { createD1IdempotencyStore } from "./stores/idempotency-store";
import { createD1WebhookInboxStore } from "./stores/webhook-inbox-store";
import { createD1ReconciliationStore } from "./stores/reconciliation-store";
import type {
  IdempotencyStore,
  ReconciliationStore,
  WebhookInboxStore,
} from "@paykernel/store-contracts";

function bindingToStoreOptions(options: D1BindingStoreOptions): D1StoreOptions {
  // Same session default as createD1Executor / migrateD1Adapter (first-primary
  // when withSession exists; session: false stays unbound).
  const executor = createD1Executor(
    options.db,
    options.session !== undefined ? { session: options.session } : {},
  );
  const storeOpts: D1StoreOptions = { executor };
  if (options.clock !== undefined) storeOpts.clock = options.clock;
  if (options.namespace !== undefined) storeOpts.namespace = options.namespace;
  return storeOpts;
}

/**
 * Primary ergonomic factory: Workers D1 binding → three lease-aware stores.
 *
 * ```ts
 * const stores = createD1PaymentStores({ db: env.PAYMENTS_DB });
 * // defaults to session: "first-primary" when withSession is available
 * ```
 *
 * Does **not** migrate schema. Defaults to D1 Sessions `"first-primary"` when
 * the binding exposes `withSession` (safe read-after-write under replication).
 * Pass `session: false` to opt out, or an explicit constraint/bookmark string.
 */
export function createD1PaymentStores(
  options: D1BindingStoreOptions,
): D1StoresBundle {
  return createD1Stores(bindingToStoreOptions(options));
}

/** Binding helper: idempotency store only. Does not migrate. */
export function createD1IdempotencyStoreFromBinding(
  options: D1BindingStoreOptions,
): IdempotencyStore {
  return createD1IdempotencyStore(bindingToStoreOptions(options));
}

/** Binding helper: webhook inbox store only. Does not migrate. */
export function createD1WebhookInboxStoreFromBinding(
  options: D1BindingStoreOptions,
): WebhookInboxStore {
  return createD1WebhookInboxStore(bindingToStoreOptions(options));
}

/** Binding helper: reconciliation store only. Does not migrate. */
export function createD1ReconciliationStoreFromBinding(
  options: D1BindingStoreOptions,
): ReconciliationStore {
  return createD1ReconciliationStore(bindingToStoreOptions(options));
}
