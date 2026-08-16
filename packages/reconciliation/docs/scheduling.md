# Scheduling over ReconciliationStore

**Package:** [`@paykernel/reconciliation`](../README.md)  
**Source:** [`scheduler.ts`](../src/scheduler.ts), [`backoff.ts`](../src/backoff.ts), [`store.ts`](../src/store.ts)  
**Related:** [crash-boundaries.md](./crash-boundaries.md) · [testkit store-contracts](../../testkit/docs/store-contracts.md)

---

## 1. No mandatory queue

**`ReconciliationStore` is the scheduling abstraction.** This package does not require Redis Streams, SQS, Bull, or any queue product.

Durable adapters (postgres, redis, sqlite, turso, d1, do) implement the store. Workers poll `listDue` + atomic `claim`. Cloudflare Durable Objects may also use **alarms** as infrastructure to wake workers — that is adapter/infra, not a domain queue API.

Redis remains **optional** for the monorepo; any conforming `ReconciliationStore` works.

---

## 2. Store contract (dual-owned)

Phase 19 dual-owns `ReconciliationStore` in this package (structurally compatible with Phase 9 testkit). Production sources **never** import testkit. Durable adapters must still pass testkit `runReconciliationStoreConformanceSuite`.

| Method | Role |
| ------ | ---- |
| `schedule` | Insert job or `already_exists` |
| `claim` | **Atomic** claim when due / after lease expiry |
| `renew` | Extend lease; rotates token + generation |
| `complete` | Terminal success (lease-fenced) |
| `fail` | Terminal fail **or** reschedule via `retryAt` |
| `markManualReview` | Terminal human review |
| `get` / `listDue` | Read / list due (`listDue` **must** soft-release/re-index expired claims — see [crash-boundaries](./crash-boundaries.md#listdue-recovery-contract-adapters)) |
| `deleteExpired` | Retention cleanup |

Statuses: `scheduled` | `claimed` | `completed` | `failed` | `manual_review`.

Claim is **never** get-then-set. Stale `leaseToken` → `StoreLeaseLostError` / `lease_lost`.

`claimDue` / `processDue` discover work only via `listDue` → `claim`. Adapters that only allow key-addressed reclaim after crash (without making the job reappear in `listDue`) break poll-worker recovery.

---

## 3. High-level scheduler

```typescript
import {
  createReconciliationScheduler,
  deriveReconciliationJobKey,
  createExponentialBackoff,
  type ReconciliationStore,
} from "@paykernel/reconciliation";

declare const store: ReconciliationStore;

const scheduler = createReconciliationScheduler({
  store,
  owner: "recon-worker-1",
  defaultLeaseMs: 30_000,
  maxAttempts: 10,
  // optional custom backoff:
  // backoff: createExponentialBackoff({ baseMs: 1_000, maxMs: 15 * 60_000, jitterRatio: 0.2 }),
});

await scheduler.schedule({
  target: {
    gateway: "stripe",
    gatewayPaymentId: "pi_123",
    expected: { status: "pending" },
  },
  runAt: new Date().toISOString(), // ISO-8601
  reason: "indeterminate_create",
  // key?: omit to use deriveReconciliationJobKey(target)
});
```

### `schedule({ target, runAt, reason, key? })` → `store.schedule`

| Wrapper field | Store field |
| ------------- | ----------- |
| `key` or derived | `key` |
| subject from target ids | `subjectId` |
| `reason` | `reason` |
| `runAt` | `dueAt` |

Default key: `recon:{gateway}:{primaryId}` via `deriveReconciliationJobKey`  
Primary id preference: `gatewayPaymentId` → `idempotencyKey` → `localReference` → `providerRequestId`.

Idempotent by key: second schedule → `{ kind: "already_exists", record }`.

**Important:** the store row holds `subjectId` + `reason`, not a full serialized target. Applications should keep enough state (or encode target data out-of-band) to re-run full lookup on claim. Prefer stable keys that still allow reloading order + payment intent.

---

## 4. Claim, complete, reschedule, manual review

```typescript
import {
  decideReconciliationPolicy,
  type PaymentReconciler,
  type ReconciliationTarget,
} from "@paykernel/reconciliation";

declare const reconciler: PaymentReconciler;
declare function loadTarget(job: {
  record: { subjectId: string };
}): Promise<ReconciliationTarget>;
declare function applyLocalUpdate(decision: {
  action: "update_local_to_paid" | "update_local_to_failed";
  provider: unknown;
}): Promise<void>;

const claimed = await scheduler.claimDue({ limit: 10 });
// listDue → atomic store.claim each; skips not_due / in_progress / terminal

for (const job of claimed) {
  try {
    const target = await loadTarget(job); // store row is subjectId + reason, not a full target
    const result = await reconciler.reconcile(target);
    const decision = decideReconciliationPolicy(result, target);
    // Never complete on raw result.outcome === "consistent":
    // sparse/pending local + provider pending/processing is still settling
    // (retry_later), not recovery-complete.

    if (decision.action === "mark_consistent" && decision.safe) {
      await scheduler.complete({
        key: job.key,
        leaseToken: job.leaseToken,
      });
    } else if (
      (decision.action === "update_local_to_paid" ||
        decision.action === "update_local_to_failed") &&
      decision.safe
    ) {
      // RECON-4: apply the local paid/failed update in YOUR app *before*
      // complete — do not finish the job while local remains pending.
      await applyLocalUpdate(decision);
      await scheduler.complete({
        key: job.key,
        leaseToken: job.leaseToken,
      });
    } else if (decision.action === "retry_later") {
      // RECON-3: in-flight settlement — reschedule; do not park at maxAttempts.
      await scheduler.failAndReschedule({
        key: job.key,
        leaseToken: job.leaseToken,
        error: new Error("retry_later"),
        attempt: job.record.attempts,
      });
    } else if (decision.action === "do_not_create_replacement") {
      // Never createPayment for the same intent; reschedule lookup if needed.
      await scheduler.failAndReschedule({
        key: job.key,
        leaseToken: job.leaseToken,
        error: new Error(decision.reason),
        attempt: job.record.attempts,
      });
    } else if (
      decision.action === "manual_review" ||
      decision.action === "apply_drift_review"
    ) {
      await scheduler.markManualReview({
        key: job.key,
        leaseToken: job.leaseToken,
        note: decision.action, // sanitized
      });
    }
  } catch (err) {
    // Handler/transient failure budget only — not policy retry_later.
    if (job.record.attempts >= scheduler.maxAttempts) {
      await scheduler.markManualReview({
        key: job.key,
        leaseToken: job.leaseToken,
        note: "max attempts", // sanitized
      });
    } else {
      await scheduler.failAndReschedule({
        key: job.key,
        leaseToken: job.leaseToken,
        error: err,
        attempt: job.record.attempts,
      });
    }
  }
}
```

### `failAndReschedule`

Uses exponential backoff + jitter to set `retryAt` on `store.fail`. Errors are passed through `sanitizeReconciliationError` before storage.

Default backoff: base 1s, max 15m, multiplier 2, jitter ratio 0.2. Inject `random` on `createExponentialBackoff` for deterministic tests.

`listDeadLetter()` with no `keys` / `scan` uses `store.listTerminal()` when the adapter implements it (memory stores do). Durable adapters that omit `listTerminal` still need `keys` or `scan`.

`maxInFlightByGateway` is enforced on the **scheduler instance** (overlapping `processDue` calls share the count). It is not a multi-worker store lock.

### `processDue`

Claims due jobs and runs a handler. **Completion requires an explicit disposition** — returning without throwing is **not** success (policy outcomes like `retry_later` must not silently complete recovery).

```typescript
await scheduler.processDue({
  limit: 20,
  maxInFlightByGateway: { stripe: 5, paypal: 3 },
  handler: async (job) => {
    const target = await loadTarget(job);
    const result = await reconciler.reconcile(target);
    const decision = decideReconciliationPolicy(result, target);
    // complete ONLY after mark_consistent, or after *applying* a safe
    // paid/failed local update (RECON-4). Never complete while local is
    // still pending. Never complete on raw outcome === "consistent".
    if (decision.action === "mark_consistent" && decision.safe) {
      return { disposition: "complete" };
    }
    if (
      (decision.action === "update_local_to_paid" ||
        decision.action === "update_local_to_failed") &&
      decision.safe
    ) {
      await applyLocalUpdate(decision); // YOUR app — persist paid/failed first
      return { disposition: "complete" };
    }
    if (decision.action === "retry_later") {
      // RECON-3: does not consume the maxAttempts dead-letter budget.
      return { disposition: "retry_later", error: new Error("retry_later") };
    }
    if (decision.action === "do_not_create_replacement") {
      return { disposition: "retry", error: new Error(decision.action) };
    }
    if (
      decision.action === "manual_review" ||
      decision.action === "apply_drift_review"
    ) {
      return { disposition: "manual_review", note: decision.action };
    }
    // void / undefined → treated as retry (fail-closed)
    // throw → same as { disposition: "retry", error }
    return { disposition: "retry" };
  },
});
// → { processed, rescheduled, manualReview, completed, leaseLost }
```

`leaseLost` counts fencing rejections on complete/fail/markManualReview (another worker owns the lease) — these are **not** counted as business reschedules or dead-letters.

`maxInFlightByGateway` uses the gateway segment of keys shaped `recon:{gateway}:{id}` (canonical) or app-supplied `{gateway}:{id}` (RECON-4). Counts are shared across overlapping `processDue` calls on the **same scheduler instance**. Keys without a parseable gateway segment map to `"unknown"`. When caps are set, `listDue` is oversampled (3× / +16, capped at 200 — PERF-7) so a single gateway’s due prefix cannot starve others. Claim fencing stays per-key `store.claim`. This is not a multi-worker store lock — bound workers at the app layer for that. See [batch.md](./batch.md).

`{ disposition: "retry_later" }` reschedules in-flight settlement and **does not** `markManualReview` when `attempts >= maxAttempts`. `{ disposition: "retry" }` / throw still dead-letters at the attempt budget.

### Re-scheduling terminal jobs

`store.schedule` for a key that is already `completed` / `failed` / `manual_review` may reopen the job as `scheduled` (memory store does; durable adapters should match). Active `scheduled` / `claimed` rows still return `already_exists`.

---

## 5. Dead letter / manual review inspection

Terminal `manual_review` and terminal `failed` (without `retryAt`) are dead-letter style outcomes. The store does not require a separate queue.

```typescript
const dead = await scheduler.listDeadLetter();
// memory stores implement listTerminal — no keys required.
// durable adapters: pass keys or scan, unless they implement listTerminal.

const tracked = await scheduler.listDeadLetter({
  keys: ["recon:stripe:pi_123"],
  // or: scan: async () => app.listCandidateRecords(),
});
// returns records with status manual_review | failed
```

Also: `store.get(key)` for a single job. Operators re-open work by scheduling a new key or re-processing after fixing data — never by inventing local failure from an old timeout.

---

## 6. Backoff helper (standalone)

```typescript
import { createExponentialBackoff } from "@paykernel/reconciliation";

const backoff = createExponentialBackoff({
  baseMs: 1_000,
  maxMs: 900_000,
  multiplier: 2,
  jitterRatio: 0.2,
  random: () => 0.5, // injectable for tests
});

const delayMs = backoff.nextDelayMs(attempt); // 0-based attempt index
```

Portable: no Node timers or crypto required for delay math.

---

## 7. Adapter / infra notes

| Backend | How scheduling is powered |
| ------- | ------------------------- |
| Postgres / SQLite / Turso / D1 | SQL job rows + worker poll / cron |
| Redis | Sorted due index + Lua claim (optional infra) |
| Durable Objects | Per-partition store + optional **alarms** to wake work |
| Testkit memory | `createMemoryReconciliationStore` in tests only |

See [adapter-selection.md](../../../docs/adapter-selection.md) for choosing a store. Domain code depends only on `ReconciliationStore`.

---

## 8. Secrets

- Pass unknown errors through `sanitizeReconciliationError` before `fail` / notes.
- Do not store raw provider payloads, signatures, or API keys on job rows by default.
