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


## Clock fencing (multi-host)

Lease reclaim / complete / fail predicates bind an injectable client `now` (ISO TEXT) rather than dialect `NOW()` / `datetime('now')`. Reasons:

1. Timestamps are stored as ISO-8601 **TEXT** for portability across Postgres/SQLite-family adapters; dialect clock functions return formats that do not lexicographically compare cleanly with ISO `T`/`Z` strings on all engines.
2. Unit tests use **FakeClock** to advance time without wall-clock waits.

**Production multi-host requirement:** keep worker host clocks NTP-synced (or otherwise tightly synchronized). Large skew can early-reclaim still-live leases or reject completes near expiry. Prefer one DB primary for these tables; do not run multi-primary active-active without a single consensus clock/leader.

## Related

- [claims.md](./claims.md) · [transactions.md](./transactions.md) · [guarantees.md](./guarantees.md) · [limits.md](./limits.md)

**Webhook abandoned claims:** `listRetryable` / `get` soft-release `status=claimed` rows whose `lease_expires_at <= now` back to `pending` (lease fields cleared, attempts preserved) so `processRetryable` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases.

**Reconciliation abandoned claims:** `listDue` soft-releases `status=claimed` rows whose `lease_expires_at <= now` back to `scheduled` (lease fields cleared, attempts preserved) so `claimDue` / `processDue` can drain them after worker crash. Key-addressed `claim` also reclaims expired leases. `markManualReview` requires an active (unexpired) lease, matching complete/fail.

**Multi-partition Worker client:** under `kind: "hash"`, `listDue` / `listRetryable` / `deleteExpired` **fan out** to every partition so soft-release + rediscovery reach non-sentinel shards. Under `kind: "key"`, global list/cleanup hard-fails (`StoreUnsupportedFeatureError`); claim/complete by real key remain correct. Details: [sharding.md](./sharding.md).
