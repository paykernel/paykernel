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
const claimed = await scheduler.claimDue({ limit: 10 });
// listDue → atomic store.claim each; skips not_due / in_progress / terminal

for (const job of claimed) {
  try {
    // await reconciler.reconcile(...); apply policy in app
    await scheduler.complete({
      key: job.key,
      leaseToken: job.leaseToken,
    });
  } catch (err) {
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

### `processDue`

Claims due jobs and runs a handler. **Completion requires an explicit disposition** — returning without throwing is **not** success (policy outcomes like `retry_later` must not silently complete recovery).

```typescript
await scheduler.processDue({
  limit: 20,
  maxInFlightByGateway: { stripe: 5, paypal: 3 },
  handler: async (job) => {
    // reconcile + apply policy
    // return { disposition: "complete" } | { disposition: "retry", error? } |
    //        { disposition: "manual_review", note? }
    // void / undefined → treated as retry (fail-closed)
    // throw → same as { disposition: "retry", error }
    return { disposition: "complete" };
  },
});
// → { processed, rescheduled, manualReview, completed, leaseLost }
```

`leaseLost` counts fencing rejections on complete/fail/markManualReview (another worker owns the lease) — these are **not** counted as business reschedules or dead-letters.

`maxInFlightByGateway` is a **per-processDue call** filter using the gateway segment of keys shaped `recon:{gateway}:{id}`. When caps are set, `listDue` is oversampled so a single gateway’s due prefix cannot starve others within the call. Applications should also bound global worker concurrency and per-provider rate limits (see [batch.md](./batch.md)).

### Re-scheduling terminal jobs

`store.schedule` for a key that is already `completed` / `failed` / `manual_review` may reopen the job as `scheduled` (memory store does; durable adapters should match). Active `scheduled` / `claimed` rows still return `already_exists`.

---

## 5. Dead letter / manual review inspection

Terminal `manual_review` and terminal `failed` (without `retryAt`) are dead-letter style outcomes. The store does not require a separate queue.

```typescript
const dead = await scheduler.listDeadLetter({
  keys: ["recon:stripe:pi_123"], // app-tracked keys
  // or:
  // scan: async () => app.listCandidateRecords(),
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
