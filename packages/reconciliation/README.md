# @paykernel/reconciliation

Portable **reconciliation primitives** for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): safe ordered provider lookup, machine-readable drift, decision-only policy helpers, store-backed durable scheduling (no mandatory queue), and bounded-concurrency batch reconcile.

> **Portable.** No Node-only imports. No Redis/queue product required. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web APIs). Depends only on `@paykernel/core`.

## Install

```bash
bun add @paykernel/reconciliation
# peer / workspace: @paykernel/core
```

## Quickstart

### 1. Safe check of an indeterminate payment

Inject a `ProviderLookupPort` (and optionally a durable or test store for scheduling).

```typescript
import {
  createPaymentReconciler,
  decideReconciliationPolicy,
  type ProviderLookupPort,
  type ReconciliationTarget,
} from "@paykernel/reconciliation";

declare const lookup: ProviderLookupPort;

const reconciler = createPaymentReconciler({ lookup });

const target: ReconciliationTarget = {
  gateway: "stripe",
  gatewayPaymentId: "pi_123",
  expected: { status: "pending" },
};

const result = await reconciler.reconcile(target);
const decision = decideReconciliationPolicy(result, target);

// Apply local updates in YOUR app — this package never mutates payments.
if (decision.action === "update_local_to_paid" && decision.safe) {
  // await orderService.markPaid(decision.provider);
}
// NEVER create a replacement charge while original is indeterminate.
// Multi-match is never silent pick-first (outcome: ambiguous_match).
```

### 2. Durable schedule (store-backed, no queue)

```typescript
import {
  createReconciliationScheduler,
  type ReconciliationStore,
} from "@paykernel/reconciliation";

declare const store: ReconciliationStore; // testkit memory in tests; adapter in production

const scheduler = createReconciliationScheduler({ store, maxAttempts: 8 });

await scheduler.schedule({
  target: {
    gateway: "stripe",
    gatewayPaymentId: "pi_123",
    expected: { status: "pending" },
  },
  runAt: new Date().toISOString(),
  reason: "indeterminate_create",
});

const claimed = await scheduler.claimDue({ limit: 10 });
for (const job of claimed) {
  // run reconcile, then:
  await scheduler.complete({ key: job.key, leaseToken: job.leaseToken });
  // or failAndReschedule / markManualReview
}
```

Inject any `ReconciliationStore` (testkit `createMemoryReconciliationStore` in tests; postgres/redis/sqlite/turso/d1/do adapters in production). Durable adapters must pass `runReconciliationStoreConformanceSuite` from `@paykernel/testkit`.

(`@paykernel/reconciliation` does **not** depend on testkit — import memory stores only from test code.)

### 3. Batch with concurrency limit

```typescript
for await (const result of reconciler.reconcileMany(targets, { concurrency: 5 })) {
  // Persist or alert in application code — package does not auto-mutate.
}
```

## Design rules (authoritative)

1. **Decision-only policy** — helpers return enums; never auto-mutate local payments.
2. **No replacement charges** while original is indeterminate or matches are ambiguous.
3. **Never invent failure** from timeouts / unavailable provider responses.
4. **Multi-match → `ambiguous_match`** — never silent pick-first.
5. **Atomic claim** only via `store.claim` — no get-then-set races in the scheduler.
6. **No secrets** in errors, logs, or stored `lastError` (use `sanitizeReconciliationError`).
7. **No mandatory queue** — `ReconciliationStore` is the scheduling abstraction.

## Lookup order

When keys and methods are available:

1. provider payment ID (`findByPaymentId`)
2. idempotency key (`findByIdempotencyKey`)
3. merchant local reference (`findByLocalReference`)
4. provider request ID (`findByProviderRequestId`)

Unsupported methods are skipped (capability-aware). Missing all methods for available keys → `manual_review_required`.

## Documentation

| Doc | Contents |
| --- | -------- |
| **[docs/overview.md](./docs/overview.md)** | Purpose, package boundary, mental model |
| **[docs/reconciliation.md](./docs/reconciliation.md)** | Target, snapshots, results, compare, policy |
| **[docs/safe-lookup.md](./docs/safe-lookup.md)** | Ordered lookup, `ProviderLookupPort`, multi-match |
| **[docs/scheduling.md](./docs/scheduling.md)** | Scheduler, backoff/jitter, manual review, no queue |
| **[docs/batch.md](./docs/batch.md)** | `reconcileMany`, concurrency, app persist/alert |
| **[docs/crash-boundaries.md](./docs/crash-boundaries.md)** | Schedule / claim / lookup / complete under crash |
| [testkit store-contracts](../testkit/docs/store-contracts.md) | Lease-aware store semantics + conformance |
| [adapter selection](../../docs/adapter-selection.md) | Choosing a durable store adapter |

## Package boundary

- Depends only on `@paykernel/core` (core).
- Does **not** import testkit, webhooks, adapters, Redis, or DB drivers.
- Dual-owns `ReconciliationStore` structurally compatible with Phase 9 testkit.
- Core must never depend on this package.

## License

MIT
