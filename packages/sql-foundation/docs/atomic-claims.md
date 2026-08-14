# Atomic claims (Phase 11)

**Package:** `@paykernel/sql-foundation`  
**Contracts:** [store-contracts.md](../../../packages/testkit/docs/store-contracts.md)  
**Foundation:** [relational-foundation.md](./relational-foundation.md)

---

## Why this exists

Phase 9 forbids **get-then-set** as a multi-process claim strategy. Phase 11 encodes:

1. **Pure decision functions** — generation, attempts, reclaim eligibility, outcome kinds.
2. **Dialect-tagged SQL templates** — single-statement or single-transaction conditional writes.
3. **Contention expectations** — multi-connection tests / reference harness hooks.

Adapters map decisions + templates onto real drivers. They must not reintroduce application-level races.

---

## Forbidden pattern

```text
// FORBIDDEN multi-connection claim
const row = await db.query("SELECT * FROM t WHERE key = $1", [key]);
if (!row || expired(row)) {
  await db.query("UPDATE t SET ... WHERE key = $1", [key]);
}
```

Two connections can both pass the SELECT and both UPDATE. That is **not** a valid implementation of Phase 9 `reserve` / `claim`.

---

## Required pattern

**Atomic engine-level claim:** conditional `INSERT` / `UPDATE` (or Redis `SET NX`, DO transactional write, etc.) such that concurrent workers serialize **in the storage engine**.

| Dialect    | Typical shape in this package                                             |
| ---------- | ------------------------------------------------------------------------- |
| PostgreSQL | `INSERT … ON CONFLICT DO UPDATE … WHERE <reclaim predicates> RETURNING …` |
| SQLite (local single-host) | `INSERT OR IGNORE` + conditional `UPDATE` **in one sync transaction** |
| SQLite-compatible async remote (Turso / D1) | Prefer single-statement UPSERT + RETURNING; multi-statement only in atomic batch/txn |
| Generic    | Intent comments only — implement per dialect                              |

User values are **bound parameters**. Table names come only from `resolveTableName` after namespace validation.

---

## Dual fencing

On every successful acquire / reclaim / renew that issues a new lease:

| Field         | Rule                                                        |
| ------------- | ----------------------------------------------------------- |
| `generation`  | Monotonic integer; prior + 1 (or `1` on insert)             |
| `lease_token` | New unguessable opaque string; old token must fail mutators |

Token-gated methods (complete / fail / renew / markIndeterminate / markManualReview) must check the **current** token (and typically expected status). Stale/wrong token → lease lost — **not** a definitive business failure of the payment.

**Lease clock nuance:** `complete` / `renew` still require an **active** (unexpired) lease. Webhook `fail` succeeds after lease expiry when the token still matches (WEBHOOKS-2: hang/timeout handlers must record the attempt). Reconciliation `fail` still requires an active lease per contract. `markIndeterminate` (idempotency A4) parks on `status = reserved` + matching `lease_token` **without** requiring `lease_expires_at > now`, so a worker can still preserve an uncertain outcome near/at expiry before reclaim. After another worker reclaims, the prior token fails. This is intentional near-expiry parking — not a post-reclaim fence hole.

---

## Pure decision API

| Function                    | Store          | Acquire when                                                                                                                                                      |
| --------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluateClaim`             | All            | Unified dispatcher over the three `decide*` functions (unit tests / harness)                                                                                      |
| `decideIdempotencyReserve`  | Idempotency    | No row → insert; matching fingerprint + reclaimable (expired / not active reserved) → update; else completed / indeterminate / in_progress / fingerprint_conflict |
| `decideWebhookClaim`        | Webhook inbox  | No row → insert claimed; matching payload_hash + pending-when-due (`availableAt <= now`) or expired lease → update; pending + future `availableAt` → `not_available`; expired lease reclaim allowed even if `availableAt` future; else completed / in_progress / payload_hash_conflict / duplicate_failed |
| `decideReconciliationClaim` | Reconciliation | Row must exist (schedule first); due + scheduled/expired lease → update; else not_found / not_due / in_progress / already_terminal                                |
| `decideLeaseMutation`       | Mutators       | Pure fencing for complete/fail/renew: not_found / wrong_status / lease_lost / ok                                                                                  |

Helpers: `isLeaseActive`, `isActiveLeaseToken`, `addMsIso`, `nowIso`.

These functions perform **no I/O**. They may be used inside:

- A single-isolate critical section (memory-relational reference), or
- A **single synchronous** SQLite `db.transaction()` with **no `await`** (bun:sqlite reference), or
- Logic that **mirrors** what the conditional SQL already enforces (adapters should prefer SQL predicates as source of truth under contention).

Never: read in process A, decide, write in process B without engine atomicity.

**Indeterminate (A4):** when status is `indeterminate`, reserve returns `indeterminate` and **must not** issue a new lease.

---

## SQL templates

```ts
import {
  createSchemaNamespace,
  idempotencyReserveTemplates,
  webhookClaimTemplates,
  reconciliationClaimTemplates,
  pickClaimTemplate,
} from "@paykernel/sql-foundation";

const ns = createSchemaNamespace({ tablePrefix: "pay_" });
const set = idempotencyReserveTemplates(ns);
const frag = pickClaimTemplate(set, "postgres");
// frag.sql, frag.params (names), frag.intent
```

Each `ClaimTemplateSet` has:

- `intent` — portable English description of the atomic claim
- `postgres` / `sqlite` / `generic` — `SqlFragment` with placeholders and ordered param **names**

### Idempotency reserve intent

1. Insert if absent (unique `key`) with `generation = 1`, `status = reserved`.
2. Else update reclaim when fingerprint matches **and** status allows reclaim (expired lease or `expired` status) **and** not `completed` / `indeterminate`.
3. Increment `generation` / `attempts`; set new lease owner/token/expiry.
4. Return lease + state (Postgres `RETURNING`).

### Webhook claim intent

1. Insert if absent as `claimed`, or reclaim `pending` when `available_at <= now`, or reclaim expired `claimed` lease.
2. `status=pending` with future `available_at` is **not** reclaimable (backoff / `retryAfterMs` gate). Expired lease reclaim for crash recovery is still allowed even when `available_at` is in the future.
3. `payload_hash` must match on conflict; mismatch is conflict (not silent overwrite).
4. Do not reclaim terminal `completed` / `failed` / `dead_letter` via this template path.
5. Increment fencing fields; bind all user values.
6. Lease expiry comparisons use a bound injectable `now` (ISO TEXT) so FakeClock tests work; production multi-host deployments must keep host clocks NTP-synced (timestamps are ISO TEXT, not dialect `NOW()`), see adapter crash-boundaries docs.

### Reconciliation claim intent

1. **Update only** (row created by `schedule`).
2. Claim when `due_at <= now` and status is `scheduled` or lease expired; not terminal.
3. Increment generation/attempts; set lease fields.

---

## Equivalence (postgres ↔ sqlite)

Templates implement the **same logical transitions** as `evaluateClaim` / `decide*`. Syntax differs by design:

- Postgres: single-statement UPSERT + `RETURNING` (and `(xmax = 0)` insert detection where useful).
- SQLite: `INSERT OR IGNORE` + conditional `UPDATE` in **one transaction**.

Phase 12 adapters must execute templates as **prepared statements** and pass testkit conformance. Do not hide dialect differences in a leaky abstraction that loses atomicity.

Complete / renew templates (`idempotencyCompleteTemplates`, `webhookCompleteTemplates`) fence with `WHERE lease_token = … AND status = … AND lease_expires_at > now` so stale tokens update **zero** rows. `webhookFailTemplates` match `lease_token` + `status = claimed` only — webhook fail succeeds after expiry with a matching token. Reconciliation fail still requires an active lease per contract.

---

## Same-isolate vs multi-connection

| Scope                                 | What proves atomicity                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Testkit memory + default conformance  | Same-isolate concurrent double-claim (Map critical section). **Does not** prove multi-host. |
| sql-store memory-relational reference | Process-local promise mutex (`atomicityModel: "process_local_mutex"`); A3 tests             |
| sql-store bun:sqlite reference        | Single sync `db.transaction` (no await); multi-connection same-file test                    |
| `runClaimContentionHarness`           | Portable A3 suite for memory + Phase 12 adapters                                            |
| Phase 12 production adapters          | Must pass testkit conformance **and** multi-connection claim proofs with real drivers       |

Document coordination honestly in `StorageAdapterManifest` (`single-process` vs `multi-host`, etc.).

### A3 harness scenarios

1. N concurrent claim/reserve → exactly one `acquired`
2. After lease expiry → reclaim with higher `generation` + new token
3. Stale token complete/fail → `lease_lost`
4. Concurrent webhook claims with different `payload_hash` → one acquire + conflicts
5. Generation monotonic across reclaim chain

---

## Crash boundaries (relational)

| Boundary                           | Behavior                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| After claim, before work complete  | Lease held until expiry; reclaim possible with new token + higher generation                              |
| After side effect, before complete | Uncertain — use indeterminate (idempotency) or idempotent handler re-run (webhooks); never invent failure |
| Stale worker complete              | Zero-row token-conditional update / lease_lost                                                            |
| Transaction callback (SQLite sync) | Claim/complete mutations only; **no** `await` of external provider I/O inside the sync callback           |

Webhooks engine crash model: [crash-boundaries.md](../../../packages/webhooks/docs/crash-boundaries.md).

---

## Implementation checklist for adapters

1. Use templates (or equivalent SQL) with **engine-level** atomicity.
2. Bind parameters; resolve tables via namespace helpers.
3. On acquire: new opaque `leaseToken`, increment `generation`.
4. Mutators require current token; reclaim invalidates prior token.
5. Map SQL outcomes to Phase 9 result discriminants (`acquired`, `in_progress`, …).
6. Add multi-connection contention tests (two clients, same key, one winner).
7. Pass `run*StoreConformanceSuite` from testkit.
8. Do not store secrets in error columns; enforce max sanitized length.

---

## Related source

- `src/claims/algorithm.ts` — pure decisions (`evaluateClaim`, `decide*`, `decideLeaseMutation`)
- `src/claims/templates.ts` — dialect fragments (claim + complete/fail)
- `src/claims/harness.ts` — `runClaimContentionHarness` for adapter equivalence
- `src/claims/dialect.ts` — `postgres` \| `sqlite` \| `generic`
- `src/claim-contention.test.ts` — A3 contention proofs (memory + bun:sqlite)
- `src/reference/memory-relational-store.ts` — NON-PRODUCTION mutex reference
- `src/reference/bun-sqlite-store.test.ts` — NON-PRODUCTION bun:sqlite reference (not on main export)
