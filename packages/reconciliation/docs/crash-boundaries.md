# Crash boundaries (Phase 19)

**Package:** [`@paykernel/reconciliation`](../README.md)  
**APIs:** `createReconciliationScheduler` · `createPaymentReconciler` · `resolveProviderSnapshot`  
**Related:** [scheduling.md](./scheduling.md) · [safe-lookup.md](./safe-lookup.md) · [overview.md](./overview.md)

This document describes process crashes relative to reconciliation schedule, claim, lookup, and complete. Silent conversion of uncertain outcomes into terminal failure is **forbidden**.

---

## Pipeline positions

```text
 schedule(target) → [A] store.schedule
     → due time arrives
     → [B] listDue + store.claim (atomic)
     → [C] lookup / reconcile (provider HTTP)
     → [D] policy decision (in-memory only)
     → [E] store.complete | fail(retryAt) | markManualReview
```

| Label | Boundary |
| ----- | -------- |
| Before schedule | Crash before `store.schedule` returns |
| After schedule, before claim | Job row `scheduled`; no lease |
| After claim, before/during lookup | Job `claimed` with lease; provider may or may not have been contacted |
| After lookup, before complete | Result known in memory; store not yet terminal |
| After complete / manual_review / failed | Terminal store status |

Lease expiry while claimed: another worker may **reclaim** after `leaseExpiresAt` via atomic `store.claim`. Stale `leaseToken` on complete → `StoreLeaseLostError`.

---

## 1. Crash before schedule

### Store state

- No job for this key (unless a prior schedule already wrote it).

### Provider / local payment

- Unchanged. Indeterminate local payment remains indeterminate.

### Recovery

- Application re-runs `scheduler.schedule` (idempotent: `already_exists` if key present).

---

## 2. Crash after schedule, before claim

### Store state

- Row `status === "scheduled"`, `dueAt` set, `attempts === 0` (or previous attempt count if rescheduled).

### Lookup

- Did not run.

### Recovery

- Worker `listDue` + atomic `claim` when due. No duplicate schedule required.

---

## 3. Crash after claim, during lookup

### Store state

- Row `status === "claimed"` with active lease until `leaseExpiresAt`.

### Lookup

- May be partial or complete at the provider; response may be lost.

### Recovery

- After lease expiry, another worker reclaims (generation++, new token).
- Re-run full safe lookup order. Provider reads are side-effect free.
- **Do not** create a replacement charge because the first attempt timed out.
- **Do not** mark local payment `failed` solely because the worker died mid-lookup.

---

## 4. Crash after lookup, before complete

### Store state

- Still `claimed` under the old lease (if not expired).

### Local payment

- Policy decisions are in-memory only until **your** app applies them.
- This package never mutates local payment rows.

### Recovery

- If lease still held: call `complete` / `failAndReschedule` / `markManualReview` with the active token.
- If lease lost: reclaim and re-reconcile (lookup is safe to repeat).
- Re-apply policy only after a fresh result; do not assume prior decision without re-check when uncertain.

---

## 5. Crash after complete

### Store state

- `status === "completed"` (or `manual_review` / terminal `failed`).

### Recovery

- Claim returns `already_terminal`. No re-lookup required for the job key.
- Application still owns local payment consistency if it crashed after complete but before applying a decision — re-read provider or rely on webhooks.

---

## Stale lease complete (fencing)

```text
Worker A claims → token T1
Lease expires → Worker B claims → token T2, generation++
Worker A complete(T1) → StoreLeaseLostError
Worker B owns the work
```

Treat `StoreLeaseLostError` (or `isStoreLeaseLostError`) as **another worker owns the work**, not as payment failure.

Renew also rotates the token: complete with the pre-renew token fails the same way.

---

## Never create a duplicate charge

Across **all** crash positions above:

1. Indeterminate local + lost response → schedule / reclaim / re-lookup only.
2. `ambiguous_match` → manual resolution; never pick-first and never re-charge blindly.
3. `temporarily_unavailable` → retry later; never invent local `failed`.
4. Policy `do_not_create_replacement` / `shouldForbidReplacementCharge` → hard stop on replacement `createPayment`.

---

## Secrets

- `fail` / `markManualReview` notes must be sanitized (`sanitizeReconciliationError`).
- Never store raw provider payloads or API keys on job rows by default.

---

## Rules 3 / 5 / 14 / 17 reminders

- **Rule 3:** Never convert uncertain provider outcomes into local `failed` without a definitive provider response.
- **Rule 5:** No secret leakage in errors/logs/stored records.
- **Rule 14:** Portable ISO-8601 timestamps and opaque string lease tokens.
- **Rule 17:** Documented crash boundaries for schedule / claim / lookup / complete (this file).
