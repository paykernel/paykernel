/**
 * Payment reconciler + bounded-concurrency batch (Phase 19.7).
 *
 * NEVER creates charges. NEVER mutates local payment stores.
 * Lookup errors map to temporarily_unavailable / provider_not_found —
 * never invent paid/failed from uncertain outcomes.
 */

import type { ProviderLookupPort } from "./lookup";
import { resolveProviderSnapshot } from "./lookup";
import type { ReconciliationResult, ReconciliationTarget } from "./types";

export type CreatePaymentReconcilerOptions = {
  lookup: ProviderLookupPort;
};

export type ReconcileManyOptions = {
  /** Max concurrent lookups (default 5). Must be >= 1. */
  concurrency?: number;
};

/**
 * High-level reconciler: safe lookup + compare against expected.
 */
export type PaymentReconciler = {
  /**
   * Reconcile a single target. Never throws for business outcomes —
   * maps lookup failures to result discriminants.
   */
  reconcile(target: ReconciliationTarget): Promise<ReconciliationResult>;
  /**
   * Bounded-concurrency async generator yielding results in completion order.
   * Empty targets → no yields. Default concurrency 5.
   */
  reconcileMany(
    targets: readonly ReconciliationTarget[],
    options?: ReconcileManyOptions,
  ): AsyncGenerator<ReconciliationResult, void, unknown>;
};

/**
 * Create a payment reconciler over an injectable lookup port.
 *
 * The reconciler has no createPayment / capture / refund methods — by design.
 * Apply local mutations only after {@link decideReconciliationPolicy}.
 */
export function createPaymentReconciler(
  options: CreatePaymentReconcilerOptions,
): PaymentReconciler {
  const { lookup } = options;

  return {
    async reconcile(target: ReconciliationTarget): Promise<ReconciliationResult> {
      try {
        return await resolveProviderSnapshot(target, lookup);
      } catch {
        // Unexpected throw from lookup path → temporarily_unavailable
        return { outcome: "temporarily_unavailable" };
      }
    },

    async *reconcileMany(
      targets: readonly ReconciliationTarget[],
      options: ReconcileManyOptions = {},
    ): AsyncGenerator<ReconciliationResult, void, unknown> {
      if (targets.length === 0) return;

      const concurrency = Math.max(1, Math.floor(options.concurrency ?? 5));
      const reconcileOne = (target: ReconciliationTarget) =>
        resolveProviderSnapshot(target, lookup).catch(
          (): ReconciliationResult => ({ outcome: "temporarily_unavailable" }),
        );
      for await (const result of mapPool(targets, concurrency, reconcileOne)) {
        yield result;
      }
    },
  };
}

/**
 * Async pool: run up to `concurrency` tasks; yield results in completion order.
 */
async function* mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): AsyncGenerator<R, void, unknown> {
  const n = items.length;
  if (n === 0) return;

  const limit = Math.min(concurrency, n);
  let nextIndex = 0;
  const pending = new Map<number, Promise<{ slot: number; value: R }>>();
  let slotCounter = 0;

  const startOne = (): void => {
    if (nextIndex >= n) return;
    const index = nextIndex++;
    const slot = slotCounter++;
    const task = fn(items[index] as T, index).then((value) => ({
      slot,
      value,
    }));
    pending.set(slot, task);
  };

  for (let i = 0; i < limit; i++) {
    startOne();
  }

  while (pending.size > 0) {
    const { slot, value } = await Promise.race(pending.values());
    pending.delete(slot);
    yield value;
    startOne();
  }
}
