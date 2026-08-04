# Crash boundaries (D1)

**Package:** `@paykernel/store-d1`  
**Engine (inbox):** [webhooks crash-boundaries](../../webhooks/docs/crash-boundaries.md) (domain)  
**Contracts:** Phase 9 lease reclaim + fencing in testkit

How isolate restarts, mid-request crashes, and lease reclaim interact with durable D1 rows.

---

## Claim acquisition

- Single-statement UPSERT/RETURNING is engine-atomic: either the lease is issued (RETURNING row) or the write did not take the claim path.
- After a crash mid-request, a reserved/claimed row with an active lease blocks other workers until lease expiry (or reclaim via FakeClock-compatible `now` predicates).
- Completing with a stale lease token fails with `StoreLeaseLostError` (fencing).

| Timing | Outcome |
| ------ | ------- |
| Crash **before** claim write commits | No lease; safe for another worker to acquire |
| Crash **after** claim write, before side effect | Active lease blocks peers until expiry / reclaim |
| Crash **after** side effect, before `complete` | Holder or reclaim path; do **not** invent terminal failure if outcome is uncertain → `markIndeterminate` |
| Stale `complete` after peer reclaim | `StoreLeaseLostError` |

---

## Multi-statement batch

- `db.batch([...])` is a SQL transaction on D1: failure aborts/rolls back the **entire** sequence.
- Prefer single-statement claims; use batch only when multi-statement is unavoidable.
- Partial application of a claim sequence across unprotected round-trips is **forbidden**.

---

## Indeterminate outcomes

- Do **not** convert uncertain provider outcomes into terminal failure.
- `markIndeterminate` preserves the row; retention cleanup does **not** delete indeterminate by default.
- Aligns with Phase 9 A4 and core indeterminate contracts.

---

## Worker isolate restarts

- D1 is **durable** across Worker isolate restarts when using the **shared** D1 database.
- In-memory only state is lost; lease rows are not (shared DB).
- Local mock file reopen tests (`restart.d1.test.ts`) prove lease rows survive handle reopen.
- Multi-host safety assumes **one shared D1** bound into all instances — not separate D1 DBs per isolate without consensus.

---

## Secrets

- Never persist raw provider payloads/signatures by default.
- Map driver errors through `mapDriverError` (token/account redaction).
- Never echo Cloudflare API tokens or account IDs in `StoreError` messages.

---


## Clock fencing (multi-host)

Lease reclaim / complete / fail predicates bind an injectable client `now` (ISO TEXT) rather than dialect `NOW()` / `datetime('now')`. Reasons:

1. Timestamps are stored as ISO-8601 **TEXT** for portability across Postgres/SQLite-family adapters; dialect clock functions return formats that do not lexicographically compare cleanly with ISO `T`/`Z` strings on all engines.
2. Unit tests use **FakeClock** to advance time without wall-clock waits.

**Production multi-host requirement:** keep worker host clocks NTP-synced (or otherwise tightly synchronized). Large skew can early-reclaim still-live leases or reject completes near expiry. Prefer one DB primary for these tables; do not run multi-primary active-active without a single consensus clock/leader.

## Related

- [claims.md](./claims.md)  
- [sessions-and-replication.md](./sessions-and-replication.md)  
- [guarantees.md](./guarantees.md)  
- [limits.md](./limits.md)  

**Webhook abandoned claims:** `listRetryable` / `get` soft-release `status=claimed` rows whose `lease_expires_at <= now` back to `pending` (lease fields cleared, attempts preserved) so `processRetryable` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases.

**Reconciliation abandoned claims:** `listDue` soft-releases `status=claimed` rows whose `lease_expires_at <= now` back to `scheduled` (lease fields cleared, attempts preserved) so `claimDue` / `processDue` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases. `markManualReview` requires an active (unexpired) lease, matching complete/fail.
