# Reconciliation overview (Phase 19)

**Package:** [`@paykernel/reconciliation`](../README.md)  
**npm:** `@paykernel/reconciliation`  
**Portable:** `paymentsSdk.portable: true` — no Node-only production imports; depends only on `@paykernel/core` (core).

---

## 1. Purpose

Payment operations can leave the **local** system and the **provider** temporarily out of sync:

- Network timeouts after a create/capture left the local payment **indeterminate**
- Webhooks delayed, reordered, or never delivered
- Status drift (local `pending` vs provider `paid` / `failed`)
- Ambiguous search results when recovering by merchant reference

This package provides **portable domain primitives** so applications can:

1. **Look up** provider state safely (ordered keys, multi-match → `ambiguous_match`)
2. **Compare** local expected snapshots vs provider (machine-readable `ReconciliationDifference[]`)
3. **Decide** policy actions **without** mutating payments or creating charges
4. **Schedule** durable recovery work over any `ReconciliationStore` (no mandatory queue product)
5. **Batch** reconcile with bounded concurrency

It does **not** replace webhooks, PSP gateways, or durable store adapters. It sits **above** store contracts and **beside** application fulfillment logic.

---

## 2. Package boundary

| This package **does** | This package **does not** |
| --------------------- | ------------------------- |
| Own domain types (`ReconciliationTarget`, snapshots, results) | Depend on testkit, webhooks, adapters, Redis, or DB drivers |
| Dual-own `ReconciliationStore` (structurally compatible with Phase 9 testkit) | Import memory/durable store factories into production code |
| Safe ordered lookup via injectable `ProviderLookupPort` | Call `createPayment` / capture / refund / void |
| Decision-only policy helpers | Auto-mutate local payment rows |
| Scheduler wrappers over `store.schedule` / `claim` / `complete` / `fail` / `markManualReview` | Require a queue product or Redis |
| `createPaymentReconciler` + `reconcileMany` | Depend on OpenTelemetry / observability packages (Phase 20) |
| Sanitize errors for stored notes | Store raw provider payloads or secrets by default |

**Forbidden dependency edges:**

- **Core** must not depend on reconciliation.
- **Reconciliation** must not depend on testkit, webhooks, adapters, Redis, or DB drivers.
- Durable adapters implement `ReconciliationStore` and pass testkit `runReconciliationStoreConformanceSuite`; apps inject those stores at the edge.

See monorepo [workspace-boundaries.md](../../../docs/workspace-boundaries.md).

---

## 3. Mental model

```text
Indeterminate op / drift signal
        │
        ▼
  ReconciliationTarget  (gateway + lookup keys + optional expected)
        │
        ├─► createPaymentReconciler → resolveProviderSnapshot / compare
        │         │
        │         ▼
        │   ReconciliationResult  (exact discriminants)
        │         │
        │         ▼
        │   decideReconciliationPolicy → ReconciliationDecision
        │         │
        │         ▼
        │   YOUR app applies safe updates (or alerts / manual review)
        │
        └─► createReconciliationScheduler.schedule({ target, runAt, reason })
                  │
                  ▼
            ReconciliationStore  (SQL / Redis / DO / memory tests)
                  │
                  ▼
            claimDue → lookup → complete | failAndReschedule | markManualReview
```

---

## 4. Engineering rules (authoritative)

1. **Decision-only policy** — helpers return decisions; never auto-mutate local payments.
2. **No replacement charges** while the original payment is indeterminate or matches are ambiguous.
3. **Never invent failure** from timeouts / `temporarily_unavailable` without a definitive provider response (Rule 3).
4. **Multi-match → `ambiguous_match`** — never silent pick-first.
5. **Atomic claim** only via `store.claim` — no get-then-set races in the scheduler.
6. **No secrets** in errors, logs, or stored `lastError` (`sanitizeReconciliationError`).
7. **No mandatory queue** — `ReconciliationStore` is the scheduling abstraction.
8. **Portable timestamps** — ISO-8601 strings; opaque string lease tokens.
9. **exactOptionalPropertyTypes** — omit optional keys when absent (builders help).

---

## 5. Documentation map

| Doc | Contents |
| --- | -------- |
| **[reconciliation.md](./reconciliation.md)** | Targets, snapshots, results, compare, policy helpers |
| **[safe-lookup.md](./safe-lookup.md)** | Ordered lookup, `ProviderLookupPort`, multi-match |
| **[scheduling.md](./scheduling.md)** | Scheduler over store; backoff/jitter; manual review; no queue |
| **[batch.md](./batch.md)** | `reconcileMany` concurrency; app persistence/alerts |
| **[crash-boundaries.md](./crash-boundaries.md)** | Schedule / claim / lookup / complete under process death |
| [testkit store-contracts](../../store-contracts/docs/contracts.md) | Lease-aware store semantics + conformance |
| [adapter-selection](../../../docs/adapter-selection.md) | Which durable store adapter to inject |

---

## 6. Install

```bash
bun add @paykernel/reconciliation
# workspace / peer: @paykernel/core
```

For durable jobs, also install a store adapter (postgres, redis, sqlite, turso, d1, or do) and inject its `ReconciliationStore`. For unit tests, use testkit `createMemoryReconciliationStore` (test code only — not imported by this package).
