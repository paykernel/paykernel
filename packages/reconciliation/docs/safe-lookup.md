# Safe ordered provider lookup

**Package:** [`@paykernel/reconciliation`](../README.md)  
**Source:** [`lookup.ts`](../src/lookup.ts)  
**Related:** [reconciliation.md](./reconciliation.md) · [crash-boundaries.md](./crash-boundaries.md)

---

## 1. Why ordered lookup?

After a timeout, the app may lack a provider payment id even though the charge might exist. Recovery must try identifiers in a **safe order**, handle multi-match explicitly, and never invent terminal payment status from transport errors.

---

## 2. Inject `ProviderLookupPort`

Gateway-agnostic port. Each method is **optional** (capability-aware):

```typescript
import type {
  ProviderLookupPort,
  LookupOutcome,
  ProviderPaymentSnapshot,
} from "@paykernel/reconciliation";

const lookup: ProviderLookupPort = {
  async findByPaymentId(gateway, id): Promise<LookupOutcome> {
    // e.g. PaymentClient.getPayment / gateway retrieve
    return { kind: "found", snapshots: [/* single ProviderPaymentSnapshot */] };
  },
  async findByIdempotencyKey(gateway, key): Promise<LookupOutcome> {
    return { kind: "not_found" };
  },
  // findByLocalReference?
  // findByProviderRequestId?
};
```

### `LookupOutcome`

| `kind` | Meaning |
| ------ | ------- |
| `found` | Zero, one, or many snapshots in `snapshots` |
| `not_found` | This key is known absent at the provider |
| `unavailable` | Transient; optional `retryAfterMs` |
| `error` | Method failed; `retryable` + optional sanitized `message` |

Map gateway HTTP/SDK responses into these kinds. Do **not** pass raw signed payloads or secrets.

---

## 3. Order (when key + method present)

1. **`gatewayPaymentId`** → `findByPaymentId`
2. **`idempotencyKey`** → `findByIdempotencyKey`
3. **`localReference`** → `findByLocalReference`
4. **`providerRequestId`** → `findByProviderRequestId`

Implementation: `resolveProviderSnapshot` (alias: `safeLookup`).

```typescript
import {
  resolveProviderSnapshot,
  safeLookup, // alias
  type ReconciliationTarget,
} from "@paykernel/reconciliation";

const result = await resolveProviderSnapshot(target, lookup);
// same as: await safeLookup(target, lookup);
```

---

## 4. Engine rules

| Situation | Result |
| --------- | ------ |
| No keys on target | `manual_review_required` |
| Keys present but **no** methods implemented for those keys | `manual_review_required` (documents capability gap; not silent invent) |
| Method missing for a key | **Skip** that step (capability-aware) |
| `found` with **>1** snapshot | **`ambiguous_match`** immediately — never pick-first |
| `found` with 0 snapshots | Treat as not_found; continue |
| `found` with 1 snapshot | Compare against `target.expected` → `consistent` or `drift_detected` |
| `not_found` | Continue to next runnable step (see RECON-3 when primary was `gatewayPaymentId`) |
| `unavailable` or thrown exception | `temporarily_unavailable` (optional `retryAfterMs`) |
| `error` with `retryable: true` | `temporarily_unavailable` — do not invent paid/failed; do **not** continue to later keys (primary may still exist) |
| `error` with `retryable: false` | Continue to next runnable method (e.g. unsupported key shape for this method) |
| All steps not_found (or only non-retryable method errors) | `provider_not_found` with `retryable: true` |
| Primary `gatewayPaymentId` was `not_found`, secondary finds a **different** payment (RECON-3) | `manual_review_required` — **do not** attach the foreign snapshot as `provider` |
| Single found snapshot but `provider.gatewayPaymentId` ≠ `target.gatewayPaymentId` (when target has one) | `manual_review_required` — never expose foreign payment as canonical `provider` (no silent consistent / drift with wrong charge) |
| Primary `not_found` then secondary recovers the **same** `gatewayPaymentId` | Compare as usual (`consistent` / `drift_detected`) — eventual-consistency recovery |

**Multi-match is never silent.** Operators / policy must resolve ambiguity (`manual_review`); apps must not create replacement charges for `ambiguous_match` (see `shouldForbidReplacementCharge`).

---

## 5. Capability gaps

If your gateway client only supports retrieve-by-payment-id, implement only `findByPaymentId`. When a target only has `idempotencyKey` and you never implemented `findByIdempotencyKey`, the engine returns:

```text
manual_review_required
reason: No lookup methods implemented for available keys: idempotencyKey
```

That is intentional: the gap is **visible**, not a silent empty success.

When adding support for secondary keys, implement the matching method and return `found` with **all** matches (so multi-match can surface), never a random first hit.

---

## 6. Wiring with core `PaymentClient`

Typical production port (sketch):

```typescript
import type { PaymentClient } from "@paykernel/core";
import {
  buildProviderPaymentSnapshot,
  type ProviderLookupPort,
  type LookupOutcome,
} from "@paykernel/reconciliation";

function createLookupPort(client: PaymentClient): ProviderLookupPort {
  return {
    async findByPaymentId(gateway, id): Promise<LookupOutcome> {
      try {
        const payment = await client.getPayment(gateway, id);
        if (!payment) return { kind: "not_found" };
        return {
          kind: "found",
          snapshots: [
            buildProviderPaymentSnapshot({
              gatewayPaymentId: payment.id /* or references.providerPaymentId */,
              status: payment.status,
              amount: payment.amount,
              providerStatus: String(payment.status),
            }),
          ],
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
```

Adapt field mapping to your gateway’s `Payment` / references shape. Prefer core `Money` and `PaymentStatus`.

---

## 7. Interaction with reconciler

`createPaymentReconciler({ lookup }).reconcile(target)` calls `resolveProviderSnapshot` and maps unexpected throws to `temporarily_unavailable`. Policy and store completion stay in application / scheduler code.
