# Claim strategy — Turso adapter

**Package:** `@paykernel/store-turso`  
**Contracts:** [store-contracts.md](../../store-contracts/docs/contracts.md)  
**Templates / algorithms:** [`@paykernel/sql-foundation` atomic claims](../../sql-foundation/docs/atomic-claims.md)

This document defines how Phase 9 `reserve` / `claim` atomicity is achieved for **remote multi-host** Turso / libSQL. Contrast with local [`store-sqlite` claims](../../store-sqlite/docs/claims.md) (`BEGIN IMMEDIATE` sync).

---

## Required shape (remote-friendly)

Claims must serialize **at the storage engine** so concurrent workers on different hosts cannot both become owner:

1. **Prefer single-statement conditional UPSERT** with `RETURNING`:

   ```sql
   INSERT INTO … (…, lease_token, generation, …)
   VALUES (?, …)
   ON CONFLICT (key) DO UPDATE SET
     …,
     generation = table.generation + 1,
     lease_token = excluded.lease_token,
     …
   WHERE /* free or lease-expired + fingerprint/status predicates */
   RETURNING …
   ```

2. **Multi-statement only** inside one write `transaction` or transactional `batch` (driver-supported). Never spread claim steps across independent round-trips without an atomic batch/txn.

3. **Pure decision functions** from sql-store (`decideIdempotencyReserve`, `decideWebhookClaim`, etc.) interpret the row when needed; indeterminate rows **block** new leases.

4. Remote clients are **async**. Do **not** copy adapter-sqlite’s requirement for sync `BEGIN IMMEDIATE` callbacks as the only path — prefer engine-level single-statement UPSERT for remote latency and lock behavior.

This is Phase 15: single-statement ON CONFLICT … RETURNING preferred; multi-step only in write txn/batch after conformance verification.

---

## Forbidden

```text
// FORBIDDEN — unprotected get-then-set across remote round-trips
const row = await store.get(key);     // connection / request A
if (!row || expired(row)) {
  await store.set(key, claimed);      // race with worker B
}
```

| Pattern | Why it fails |
| ------- | ------------ |
| Read then write without atomic UPSERT/txn | Two workers can both observe “free” and both write |
| Multi-statement claim without txn/batch | Partial apply + races under multi-host load |
| Application-level mutex only | Does not serialize multi-host writers |
| ORM get-then-set claim builders | Loses engine-level atomicity — see [drizzle.md](./drizzle.md) |
| Claiming “strong” without conditional SQL | Dishonest manifest |

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

## Remote vs local SQLite

| | Turso adapter (this package) | SQLite adapter |
| - | ---------------------------- | -------------- |
| Scope | multi-host shared remote | single-host local file |
| Client | async HTTP / fetch (or libsql file for CI only) | sync embedded drivers |
| Preferred claim | single-statement UPSERT + RETURNING | `BEGIN IMMEDIATE` + multi-step-in-txn **or** ON CONFLICT |
| Coordination | remote primary | one host filesystem |

Using `file:` via `/libsql` is valid for **CI and single-process tests**. It does **not** turn this adapter into a multi-host coordination story for a local file — for production multi-host, point all workers at a **shared remote** database.

---

## Bound parameters

Production stores use **bound** `?` placeholders for claim and mutator paths. Do not concatenate untrusted values into SQL identifiers; namespaces come from sql-store validated prefixes.

---

## Related

- [overview.md](./overview.md)
- [guarantees.md](./guarantees.md) — `claims: "strong"` honesty
- [concurrency.md](./concurrency.md)
- [crash-boundaries.md](./crash-boundaries.md)
- [drivers.md](./drivers.md)
- [drizzle.md](./drizzle.md) — claims must not use ORM builders alone
- sql-foundation [atomic-claims.md](../../sql-foundation/docs/atomic-claims.md)
