# Crash boundaries — Turso adapter

**Package:** `@paykernel/store-turso`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)  
**Engine-level webhook pipeline:** [webhooks crash-boundaries](../../webhooks/docs/crash-boundaries.md)

This document answers: if a worker dies before or after a side effect and before durable complete, what does the shared Turso / libSQL store still hold, and how does reclaim behave?

---

## Process model

| Event | Effect |
| ----- | ------ |
| Worker crash mid-handler | Lease row remains `reserved` / `claimed` until `lease_expires_at`. Another worker reclaims with a **new** `leaseToken` + incremented `generation`. Stale token mutators throw `StoreLeaseLostError`. |
| Successful `complete` / terminal fail / manual review | Durable terminal status in the remote DB. Survives process restart. |
| Network failure mid-statement | Client may not know commit vs abort. Adapter maps connectivity errors to `StoreUnavailableError` / `StoreTimeoutError`. Do **not** treat uncertain outcomes as business failure without reclaim/replay policy. |
| Partial multi-statement without txn/batch | Claim/complete paths use **single** conditional statements where possible. Multi-step only inside write `transaction` / transactional `batch`. |

Remote clients are **async** (HTTP/fetch). There is no local SQLite `BEGIN IMMEDIATE` reserved lock across hosts — serialization is at the **shared database engine**.

---

## Atomicity

- **Claims** are engine-level: `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` (or multi-step only inside a write transaction / transactional batch).
- Never get-then-set across round-trips for claim correctness.
- Mutators (`complete`, `fail`, `renew`, `markIndeterminate`, `markManualReview`) fence with `WHERE lease_token = ?` (and status predicates). Zero rows → `StoreLeaseLostError`.
- Dual fencing: opaque `leaseToken` + monotonic `generation`.

Details: [claims.md](./claims.md).

---

## Crash scenarios (all three stores)

### 1. Crash after acquire / claim, before side effect

| | |
| - | - |
| **Store** | Row leased (`reserved` / `claimed`); `leaseToken` / `generation` set. |
| **Side effect** | Did not run. |
| **After expiry** | Peer reclaims with new token + higher generation. Old token rejected. |
| **App** | Safe to re-run work after reclaim (no external side effect yet). |

### 2. Crash after external side effect, before complete persistence

| | |
| - | - |
| **Store** | Still leased until expiry (or until another worker reclaims). Terminal complete **not** written. |
| **Side effect** | May have committed at the provider / downstream. |
| **Idempotency** | Prefer `markIndeterminate` **if** the worker still holds a valid lease; otherwise treat as uncertain and reconcile — **never invent terminal failure**. |
| **Webhooks / recon** | Design handlers for **at-least-once** execution; reclaim re-runs the handler. |
| **Stale complete** | After reclaim, the crashed worker’s token fails mutators (`StoreLeaseLostError`). |

### 3. Crash after successful complete

| | |
| - | - |
| **Store** | Terminal status durable in Turso / libSQL. |
| **Restart** | `reserve` / `claim` observe terminal outcome (`already_completed`, etc.); do not re-run side effects. |

### 4. Remote network failure / timeout mid-statement

| | |
| - | - |
| **SQL** | Remote engine either commits or aborts a single-statement claim — not half-applied for that statement. |
| **Client** | May not know which; map to `unavailable` / `timeout` (`retryable: true` where appropriate). |
| **Policy** | Re-read / re-claim with dual fencing; do not convert uncertainty into business failure. |
| **Auth** | Never echo `authToken` / `TURSO_AUTH_TOKEN` in error messages (adapter redacts). |

### 5. Stale mutator after peer reclaim or renew

| | |
| - | - |
| **Store** | Conditional update matches zero rows under old `lease_token`. |
| **Error** | `StoreLeaseLostError` (`code: "lease_lost"`, not retryable as “same ownership”). |
| **Meaning** | Another worker owns the work — not a definitive payment failure. |

---


**Webhook abandoned claims:** `listRetryable` / `get` soft-release `status=claimed` rows whose `lease_expires_at <= now` back to `pending` (lease fields cleared, unfinished attempt restored) so `processRetryable` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases.

**Reconciliation abandoned claims:** `listDue` soft-releases `status=claimed` rows whose `lease_expires_at <= now` back to `scheduled` (lease fields cleared, attempts preserved) so `claimDue` / `processDue` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases. `markManualReview` requires an active (unexpired) lease, matching complete/fail.
## Lease reclaim (dual fencing)

1. Lease expires (`lease_expires_at` compared with injectable `now` bound into SQL — FakeClock works in tests).
2. Peer claim/reserve succeeds with **new** `leaseToken` and higher `generation`.
3. Prior token fails all token-gated mutators.
4. Handler may run again (at-least-once). Idempotent side effects are mandatory for webhooks/recon.

---

## Migrations

- Explicit `migrateTursoAdapter` only.
- Never on package import or default store factory construction.
- Operators own upgrade windows; verify with `verifyTursoAdapterSchema`.
- Mid-deploy schema drift may surface as `StoreInvalidSchemaError` / verify failures — fail fast, do not guess.

See [migrations.md](./migrations.md).

---

## Secrets and payloads

- `last_error` / sanitized error columns accept **sanitized** text only (max length enforced).
- Do **not** store raw provider payloads or signatures by default.
- `StoreError` messages and mapped driver errors must not leak auth tokens, connection strings, or credentials.

---

## Relation to webhook engine

When using `@paykernel/webhooks` with this adapter’s inbox store:

- The engine cannot atomically couple arbitrary provider HTTP with `complete` unless both share one DB transaction (they generally do not).
- Reclaim after crash ⇒ handler re-run. See engine [crash-boundaries.md](../../webhooks/docs/crash-boundaries.md).

---


## Clock fencing (multi-host)

Lease reclaim / complete / fail predicates bind an injectable client `now` (ISO TEXT) rather than dialect `NOW()` / `datetime('now')`. Reasons:

1. Timestamps are stored as ISO-8601 **TEXT** for portability across Postgres/SQLite-family adapters; dialect clock functions return formats that do not lexicographically compare cleanly with ISO `T`/`Z` strings on all engines.
2. Unit tests use **FakeClock** to advance time without wall-clock waits.

**Production multi-host requirement:** keep worker host clocks NTP-synced (or otherwise tightly synchronized). Large skew can early-reclaim still-live leases or reject completes near expiry. Prefer one DB primary for these tables; do not run multi-primary active-active without a single consensus clock/leader.

## Related

- [overview.md](./overview.md)
- [guarantees.md](./guarantees.md) — manifest notes
- [concurrency.md](./concurrency.md) — multi-instance proofs
- [testing.md](./testing.md) — FakeClock lease reclaim
