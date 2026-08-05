# Reconciliation types, compare, and policy

**Package:** [`@paykernel/reconciliation`](../README.md)  
**Source:** [`types.ts`](../src/types.ts), [`compare.ts`](../src/compare.ts), [`policy.ts`](../src/policy.ts)  
**Related:** [safe-lookup.md](./safe-lookup.md) · [scheduling.md](./scheduling.md) · [batch.md](./batch.md)

---

## 1. Target

A **`ReconciliationTarget`** names the gateway plus one or more lookup keys and optional expected local state:

```typescript
import type { ReconciliationTarget } from "@paykernel/reconciliation";
import { buildReconciliationTarget, buildLocalPaymentSnapshot } from "@paykernel/reconciliation";

const target: ReconciliationTarget = buildReconciliationTarget({
  gateway: "stripe",
  gatewayPaymentId: "pi_123",
  // optional fallbacks when payment id is unknown after timeout:
  // idempotencyKey: "idem_abc",
  // localReference: "order-42",
  // providerRequestId: "req_xyz",
  expected: buildLocalPaymentSnapshot({
    status: "pending",
    amount: { amount: "10.00", currency: "USD" },
  }),
});
```

| Field | Role |
| ----- | ---- |
| `gateway` | Gateway id (required) |
| `gatewayPaymentId?` | Preferred provider payment id |
| `idempotencyKey?` | Mutation idempotency key used at create |
| `localReference?` | Merchant / order reference |
| `providerRequestId?` | Provider request correlation id |
| `expected?` | `LocalPaymentSnapshot` for compare + policy |

Omit optional keys when absent (`exactOptionalPropertyTypes`). Prefer `buildReconciliationTarget` / `buildLocalPaymentSnapshot`.

---

## 2. Snapshots

### Local (`LocalPaymentSnapshot`)

Partial knowledge is valid — only fields present are compared:

```typescript
type LocalPaymentSnapshot = {
  status?: PaymentStatus;
  amount?: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  gatewayPaymentId?: string;
  localReference?: string;
};
```

### Provider (`ProviderPaymentSnapshot`)

Normalized provider view returned by lookup ports:

```typescript
type ProviderPaymentSnapshot = {
  gatewayPaymentId: string;
  status: PaymentStatus;
  amount: Money;
  capturedAmount?: Money;
  refundedAmount?: Money;
  updatedAt?: string; // ISO-8601 when known
  providerStatus: string; // raw provider status string (not secret)
  relatedIds?: Record<string, string>;
};
```

Use `buildProviderPaymentSnapshot` when mapping gateway responses.

**Money:** always core `Money` (`amount` string + `currency`). Do not mix major-unit numbers with `Money` fields.

---

## 3. Differences (machine-readable)

```typescript
type ReconciliationDifference = {
  field: string; // e.g. "status" | "amount" | "capturedAmount" | "refundedAmount" | "gatewayPaymentId"
  local?: unknown;
  provider?: unknown;
  message?: string; // human hint; machines should prefer `field` + values
};
```

Empty difference list means local expected fields match provider (consistent path when a single snapshot is found).

---

## 4. Result discriminants

Exact outcomes from lookup + compare (never invent paid/failed from uncertain state):

| `outcome` | Meaning |
| --------- | ------- |
| `consistent` | Single provider snapshot; expected fields match (or no expected) |
| `drift_detected` | Single snapshot; one or more field differences |
| `provider_not_found` | All runnable lookups returned not found; `retryable` flag |
| `temporarily_unavailable` | Provider error / throw / unavailable; optional `retryAfterMs` |
| `ambiguous_match` | Multiple snapshots for one lookup step — **never pick first** |
| `manual_review_required` | No keys, or no methods for available keys, etc. |

```typescript
type ReconciliationResult =
  | { outcome: "consistent"; provider: ProviderPaymentSnapshot }
  | {
      outcome: "drift_detected";
      provider: ProviderPaymentSnapshot;
      differences: ReconciliationDifference[];
    }
  | { outcome: "provider_not_found"; retryable: boolean }
  | { outcome: "temporarily_unavailable"; retryAfterMs?: number }
  | { outcome: "ambiguous_match"; matches: ProviderPaymentSnapshot[] }
  | { outcome: "manual_review_required"; reason: string };
```

---

## 5. Compare

```typescript
import {
  compareSnapshots,
  comparePaymentSnapshots, // alias
  moneyEquals,
} from "@paykernel/reconciliation";

const diffs = compareSnapshots(target.expected, provider);
// Money: currency codes are case-insensitive (ISO 4217 alphabetic);
// amounts compare by minor units so "10" and "10.00" match for the same
// currency (not raw string equality).
```

Only fields present on the local snapshot are compared. Pure function — no I/O.

`moneyEquals` uses core `toMinorUnits` (bigint) for amount equality. Currency codes compare case-insensitively (`"usd"` ≡ `"USD"`). Equivalent decimal spellings of the same numeric value match; different currencies or unparseable/excess-precision amounts do not.

---

## 6. Policy helpers (decision-only)

**Critical:** policy returns a **`ReconciliationDecision`**. It never mutates local payments, never calls PSP charge APIs, and never creates replacement payments.

```typescript
import {
  createPaymentReconciler,
  decideReconciliationPolicy,
  decideReconciliationAction, // alias
  shouldForbidReplacementCharge,
  type ProviderLookupPort,
} from "@paykernel/reconciliation";

declare const lookup: ProviderLookupPort;

const reconciler = createPaymentReconciler({ lookup });
const result = await reconciler.reconcile(target);
const decision = decideReconciliationPolicy(result, target);

switch (decision.action) {
  case "update_local_to_paid":
    if (decision.safe) {
      // await orderService.markPaid(decision.provider);
    }
    break;
  case "update_local_to_failed":
    // Only when provider status is definitive failed/cancelled
    break;
  case "mark_consistent":
    break;
  case "apply_drift_review":
    // Alert / ops with decision.differences — do not auto-fix money totals
    break;
  case "retry_later":
    // Schedule again; optional decision.retryAfterMs
    break;
  case "manual_review":
  case "do_not_create_replacement":
    // Never create a new charge for the same intent
    break;
}
```

### Decision actions

| `action` | `safe` | When |
| -------- | ------ | ---- |
| `update_local_to_paid` | `true` | Indeterminate/pending local + provider **paid-like** (`paid` only via `isPaidLikePaymentStatus`; **not** `approved` / `authorized` / `partially_captured`); status-only drift pending→paid; provider must match `target.gatewayPaymentId` when set |
| `update_local_to_failed` | `true` | Indeterminate local + provider **definitive** `failed` / `cancelled` / `canceled` (identity-bound) |
| `mark_consistent` | `true` | Consistent snapshot without upgrade path and **not** sparse local + open incomplete provider |
| `apply_drift_review` | `false` | Non-trivial drift (money totals, multi-field, identity mismatch, **authorized/partially_captured → paid**, etc.) |
| `retry_later` | `false` | Temporarily unavailable / retryable not-found on terminal non-open locals (when not forbidding replacement via primary action) |
| `manual_review` | `false` | Ambiguous matches (never pick first); non-retryable not-found; incomplete inputs; **sparse/indeterminate local + open incomplete provider** (auth/approved/partial/`refund_pending`/`refund_failed` — surface capture/refund work) |
| `do_not_create_replacement` | `false` | Not-found while local is indeterminate **or open money** (incl. `refund_pending`) |

### Replacement charge rule

```typescript
if (shouldForbidReplacementCharge(result, target)) {
  // Do NOT call createPayment / re-charge for this intent
}
```

Returns `true` when:

- `result.outcome === "ambiguous_match"`, or
- `result.outcome === "provider_not_found"` (original may still settle), or
- `result.outcome === "temporarily_unavailable"`, or
- local expected is missing/indeterminate **or** any open money state
  (`pending` / `processing` / `authorized` / `approved` / partial / `paid` /
  `refunded` / `refund_pending` / setup)

**Never** convert `temporarily_unavailable` or retryable `provider_not_found` into local `failed` without a definitive provider response.

---

## 7. High-level reconcile

```typescript
const reconciler = createPaymentReconciler({ lookup });
const result = await reconciler.reconcile(target);
// Business outcomes are result discriminants — reconcile does not throw for them.
// Unexpected throws from the lookup path map to temporarily_unavailable.
```

The reconciler has **no** `createPayment` / capture / refund methods — by design. See [batch.md](./batch.md) for `reconcileMany`.
