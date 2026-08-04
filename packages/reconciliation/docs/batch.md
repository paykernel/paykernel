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
} from "@paykernel/reconciliation";

declare const lookup: ProviderLookupPort;
declare const targets: readonly ReconciliationTarget[];

const reconciler = createPaymentReconciler({ lookup });

for await (const result of reconciler.reconcileMany(targets, {
  concurrency: 5, // default 5; must be >= 1
})) {
  // Completion order — not input order
  // Persist result / alert / apply policy in YOUR application
}
```

| Option | Default | Notes |
| ------ | ------- | ----- |
| `concurrency` | `5` | Max concurrent lookups; floored to integer ≥ 1 |

- Empty `targets` → async generator yields nothing.
- Each item runs `reconcile` (safe lookup + compare).
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
  for await (const result of reconciler.reconcileMany(group, {
    concurrency: limit,
  })) {
    await auditStore.insert(result);
    const decision = decideReconciliationPolicy(result, /* matching target */);
    if (decision.action === "update_local_to_paid" && decision.safe) {
      await payments.markPaid(decision.provider);
    } else if (
      decision.action === "do_not_create_replacement" ||
      decision.action === "manual_review" ||
      decision.action === "apply_drift_review"
    ) {
      await alerts.notify(decision);
    } else if (decision.action === "retry_later") {
      await scheduler.schedule({
        target: /* … */,
        runAt: new Date(Date.now() + (decision.retryAfterMs ?? 60_000)).toISOString(),
        reason: "retry_after_unavailable",
      });
    }
  }
}
```

Keep target↔result correlation in application code if you need it (generator yields results only; pair with a mapPool in app if you need indices).

---

## 3. Concurrency vs durable workers

| Path | Use when |
| ---- | -------- |
| `reconcileMany({ concurrency })` | In-process batch checks; immediate results; no lease |
| `scheduler.claimDue` / `processDue` | Durable multi-host workers; crash-safe leases |
| Both | Online check + schedule stragglers that need retry |

`processDue({ maxInFlightByGateway })` bounds claims within one processDue invocation for keys `recon:{gateway}:{id}`. Still set **global** worker parallelism and **per-provider** HTTP limits outside this package.

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

for await (const r of reconciler.reconcileMany(
  [{ gateway: "stripe", gatewayPaymentId: "pi_1" }],
  { concurrency: 2 },
)) {
  results.push(r);
}
// expect provider_not_found retryable, etc.
```

Inject a fake `ProviderLookupPort`; no network required. For durable schedule tests, inject testkit `createMemoryReconciliationStore` from test code only.
