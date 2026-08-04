# Crash boundaries (Durable Objects)

**Package:** `@paykernel/store-durable-objects`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md) · webhooks [crash-boundaries.md](../../webhooks/docs/crash-boundaries.md)

How failures interact with leases, `transactionSync`, object eviction, and optional alarms.

---

## Claim then external work

Correct pattern: **claim → leave storage txn → external provider work → complete/fail/indeterminate with lease token**.

| Failure point | Expected behavior |
| ------------- | ----------------- |
| Crash **before** claim commits | No lease issued; safe retry |
| Crash **after** claim, **before** external side effect | Lease remains until `lease_expires_at`; another worker may reclaim after expiry (`generation++`, new `leaseToken`) |
| Crash **after** side effect, **before** `complete` | Lease holder or reclaim path; use **indeterminate** when outcome is uncertain — **never** invent definitive failure |
| Stale / wrong `leaseToken` on complete | `StoreLeaseLostError` |

**Do not** convert uncertain provider outcomes into failure without lease-aware complete/fail/indeterminate rules.

## transactionSync

- Throw inside the callback → full rollback of partial SQL writes in that transaction.
- Never hold a transaction open across external network calls.
- Worker client RPC methods return after the in-object claim completes; external I/O happens in the Worker (or after the DO method returns storage work) **outside** DO storage transactions.
- Sync callback only — no `await` inside `transactionSync`. Details: [transactions.md](./transactions.md).

## Eviction / restart

- SQLite-backed DO storage is **durable** across eviction and restart.
- Completed / terminal rows remain; active leases may be reclaimed when expired.
- Injectable clock enables **FakeClock** lease-reclaim tests without wall-clock waits ([testing.md](./testing.md)).

## Alarms (optional)

- Cloudflare alarms are **at-least-once** (auto-retry). Handlers must re-check claim/lease state (idempotent).
- One alarm per DO + queue table avoids alarm storms ([alarms.md](./alarms.md)).

## Related

- [claims.md](./claims.md) · [transactions.md](./transactions.md) · [guarantees.md](./guarantees.md) · [limits.md](./limits.md)
