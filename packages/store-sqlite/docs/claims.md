# Claim strategy — SQLite adapter

**Package:** `@paykernel/store-sqlite`  
**Contracts:** [store-contracts.md](../../store-contracts/docs/contracts.md)  
**Templates:** [`@paykernel/sql-foundation` atomic claims](../../sql-foundation/docs/atomic-claims.md)

This document defines how Phase 9 `reserve` / `claim` atomicity is achieved for local SQLite. It is the production counterpart to `@paykernel/sql-foundation` sqlite templates — **not** the NON_PRODUCTION `internal/sql-store` bun reference store.

---

## Required shape

Claims must be **engine-serialized** so concurrent connections to the same database file cannot both become owner:

1. **Take a reserved lock** with `BEGIN IMMEDIATE` (or driver equivalent: better-sqlite3 `.transaction(fn).immediate()`, Bun/Node immediate transaction mode).
2. **Inside one synchronous transaction**, run `@paykernel/sql-foundation` sqlite claim templates:
   - Idempotency / webhook: `INSERT OR IGNORE` then conditional `UPDATE` (multi-step-in-txn), or equivalent ON CONFLICT path verified in conformance.
   - Reconciliation: conditional claim `UPDATE` when due / lease-expired.
3. **Pure decision functions** from `@paykernel/sql-foundation` (`decideIdempotencyReserve`, `decideWebhookClaim`, `decideLeaseMutation`) interpret the row; indeterminate rows **block** new leases.
4. **Commit** the transaction. No `async` / `await` and no external I/O inside the callback.

This is Phase 14.4: either single-statement ON CONFLICT … RETURNING **or** `BEGIN IMMEDIATE` + conditional statements in one sync transaction — both after conformance verification.

---

## Forbidden

```text
// FORBIDDEN — unprotected get-then-set across connections
const row = store.get(key);           // connection A
if (!row || expired(row)) {
  store.set(key, claimed);            // race with connection B
}
```

| Pattern | Why it fails |
| ------- | ------------ |
| Read then write without reserved lock | Two connections can both observe “free” and both write |
| `async`/`await` inside SQLite txn | Releases interleaving; violates Rule 12 / roadmap §12 |
| Application-level mutex only | Does not serialize multi-process same-host writers |
| Claiming “strong” without IMMEDIATE/ON CONFLICT | Dishonest manifest |

---

## Dual fencing after claim

On successful acquire:

| Field | Behavior |
| ----- | -------- |
| `leaseToken` | New unguessable opaque string (`crypto.getRandomValues`, `lt_*` prefix) |
| `generation` | Monotonic integer; **must** increment on acquire / reclaim / renew |
| `leaseExpiresAt` | ISO-8601 from injectable clock + `leaseMs` |

Post-claim mutators (`renew`, `complete`, `fail`, `markIndeterminate`, `markManualReview`) use **conditional** `UPDATE … WHERE lease_token = ?` (and status predicates). Zero rows → `StoreLeaseLostError`.

---

## Indeterminate (idempotency A4)

When a mutation outcome is uncertain:

1. Call `markIndeterminate` while still holding a valid lease (if possible).
2. Later `reserve` returns `{ kind: "indeterminate", record }` — **no new lease**.
3. Do **not** convert indeterminate into failure/completed without an explicit operator path.
4. `deleteExpired` must **not** remove indeterminate by default.

---

## Multi-connection same host

Same-host multi-connection correctness relies on:

1. SQLite reserved lock from `BEGIN IMMEDIATE` (writers queue; `busy_timeout` reduces `SQLITE_BUSY` thrash).
2. Conditional SQL so at most one connection’s claim path “wins” the row.
3. File on a **local** durable filesystem (not NFS/SMB as shared write authority) — see [deployment-limits.md](./deployment-limits.md).

Conformance and contention tests prove same-file multi-connection claims under Bun. Node / better-sqlite3 suites use `describe.skip` / `it.skip` when the driver is unavailable — never a silent `return` that looks like a pass.

---

## Prepared statements

Production stores use **prepared** statements for claim and mutator paths (per-driver binding). Do not concatenate untrusted values into SQL identifiers; namespaces come from `@paykernel/sql-foundation` validated prefixes.

---

## Related

- [overview.md](./overview.md)
- [guarantees.md](./guarantees.md) — `claims: "strong"` honesty
- [crash-boundaries.md](./crash-boundaries.md)
- [drivers.md](./drivers.md) — IMMEDIATE / busy_timeout / WAL
- sql-foundation [atomic-claims.md](../../sql-foundation/docs/atomic-claims.md)
