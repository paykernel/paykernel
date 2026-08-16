# Batch reconcile (`reconcileMany`)

**Package:** [`@paykernel/reconciliation`](../README.md)  
**Source:** [`reconciler.ts`](../src/reconciler.ts)  
**Related:** [reconciliation.md](./reconciliation.md) · [safe-lookup.md](./safe-lookup.md) · [scheduling.md](./scheduling.md)

---

## 1. API

```typescript
import {
  createPaymentReconciler,
  decideReconciliationPolicy,
  type ReconciliationTarget,
  type ProviderLookupPort,
  type ReconcileManyItem,
} from "@paykernel/reconciliation";

declare const lookup: ProviderLookupPort;
declare const targets: readonly ReconciliationTarget[];

const reconciler = createPaymentReconciler({ lookup });

for await (const item of reconciler.reconcileMany(targets, {
  concurrency: 5, // default 5; must be >= 1
})) {
  // Completion order — not input order
  // RECON-1: each yield is { index, target, result } so not-found /
  // unavailable outcomes still map to the correct target.
  const { index, target, result } = item satisfies ReconcileManyItem;
  // Persist result / alert / apply policy in YOUR application
  void index;
  void target;
  void result;
}
```

| Option | Default | Notes |
| ------ | ------- | ----- |
| `concurrency` | `5` | Max concurrent lookups; floored to integer ≥ 1 |

- Empty `targets` → async generator yields nothing.
- Each item runs `reconcile` (safe lookup + compare).
- Yields **`ReconcileManyItem`**: `{ index, target, result }` — completion order, with stable input correlation (RECON-1).
- Business outcomes are **result discriminants**; unexpected throws map to `temporarily_unavailable`.

---

## 2. Application responsibilities

The package **does not**:

- Persist results to your ledger / DB
- Send alerts or pages
- Mutate local payment state
- Call `createPayment` or any charge API
- Enforce provider rate-limit budgets beyond the concurrency cap you pass

**You must:**

1. **Persist** outcomes (or schedule durable jobs via `createReconciliationScheduler`) for audit.
2. **Alert** on `drift_detected`, `ambiguous_match`, `manual_review_required`, and terminal policy actions.
3. Apply **only** `safe: true` policy decisions after your own validation.
4. Bound concurrency **per provider** when mixing gateways so you do not storm rate limits.

### Suggested application loop

```typescript
const byGateway = groupBy(targets, (t) => t.gateway);

for (const [gateway, group] of byGateway) {
  const limit = perProviderLimit[gateway] ?? 3;
  for await (const { index, target, result } of reconciler.reconcileMany(
    group,
    { concurrency: limit },
  )) {
    await auditStore.insert({ index, target, result });
    // Always use item.target — never zip by completion position.
    const decision = decideReconciliationPolicy(result, target);
    if (decision.action === "update_local_to_paid" && decision.safe) {
      await payments.markPaid(decision.provider);
    } else if (
      decision.action === "do_not_create_replacement" ||
      decision.action === "manual_review" ||
      decision.action === "apply_drift_review"
    ) {
      await alerts.notify(decision);
      // do_not_create_replacement may still schedule a later *lookup* —
      // never createPayment for the same intent.
    } else if (decision.action === "retry_later") {
      await scheduler.schedule({
        target,
        runAt: new Date(Date.now() + (decision.retryAfterMs ?? 60_000)).toISOString(),
        reason: "retry_after_unavailable",
      });
    }
  }
}
```

**Do not zip completion-order yields to input order.** Use `item.index` / `item.target` (RECON-1). Outcomes like `provider_not_found` and `temporarily_unavailable` carry no payment identity on the result alone.

---

## 3. Concurrency vs durable workers

| Path | Use when |
| ---- | -------- |
| `reconcileMany({ concurrency })` | In-process batch checks; immediate results; no lease |
| `scheduler.claimDue` / `processDue` | Durable multi-host workers; crash-safe leases |
| Both | Online check + schedule stragglers that need retry |

`processDue({ maxInFlightByGateway })` bounds claims within one processDue invocation for keys `recon:{gateway}:{id}`. Handler must return an explicit `{ disposition: "complete" | "retry" | "retry_later" | "manual_review" }` — void is fail-closed to retry so policy `retry_later` cannot silently complete. `{ disposition: "retry_later" }` does not dead-letter at `maxAttempts` (in-flight settlement). Handler overrun past the lease is **not** an infinite reclaim: `fail` after expiry records the attempt when the adapter allows it; otherwise `hangOverrun` budgets the key (RECON-LEASE-1). Discovery is list-then-parallel-claim (handlers stay serial); oversample is capped at 200 (PERF-7). Keep `leaseMs` large enough for the remaining batch. Still set **global** worker parallelism and **per-provider** HTTP limits outside this package.

---

## 4. Safety checklist for batch jobs

1. Never open a “retry charge” fan-out for indeterminate targets.
2. Treat `ambiguous_match` as stop-the-line for that intent.
3. Do not mark local `failed` solely because lookup returned `temporarily_unavailable`.
4. Sanitize anything written to shared logs (`sanitizeReconciliationError`).
5. Prefer scheduling durable re-checks over inventing terminal status under load.

---

## 5. Testing

```typescript
import { createPaymentReconciler } from "@paykernel/reconciliation";

const results: unknown[] = [];
const reconciler = createPaymentReconciler({
  lookup: {
    findByPaymentId: async () => ({ kind: "not_found" }),
  },
});

for await (const item of reconciler.reconcileMany(
  [{ gateway: "stripe", gatewayPaymentId: "pi_1" }],
  { concurrency: 2 },
)) {
  results.push(item);
}
// item.index === 0; item.result.outcome === "provider_not_found", etc.
```

Inject a fake `ProviderLookupPort`; no network required. For durable schedule tests, inject testkit `createMemoryReconciliationStore` from test code only.
