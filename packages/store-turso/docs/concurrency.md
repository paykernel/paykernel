# Concurrency — Turso adapter

**Package:** `@paykernel/store-turso`  
**Manifest:** `coordinationScope: "multi-host"`, `claims: "strong"`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)

This document describes multi-instance behavior, concurrent claims, rollback, read-after-write, and reconnect expectations for remote Turso / libSQL.

---

## Multi-host model

- Multiple processes / hosts may call the same stores concurrently.
- Safety comes from **engine-level conditional SQL** on a **shared remote primary**, not process-local mutexes.
- Point every worker at the **same** Turso / libSQL database URL.
- Multi-primary / multi-region active-active without a single consensus leader is **out of scope** for this manifest’s `multi-host` claim.

Local `file:` libsql is fine for CI single-process / same-host multi-connection smoke — it is **not** evidence of multi-region strong consistency.

---

## Concurrent claims

When N workers race `reserve` / `claim` for the same key:

| Outcome | Expectation |
| ------- | ----------- |
| Exactly one | `acquired` with a new `leaseToken` + `generation` |
| Others | `in_progress` (or terminal kinds if already completed) |
| Mechanism | Single-statement UPSERT / conditional UPDATE — **not** get-then-set |

Proofs live in package tests:

- `concurrency.turso.test.ts` — multi-connection / multi-instance races (file: and env-gated remote)
- Conformance suites with `concurrency: true` (same-isolate) plus adapter multi-client harnesses

Serverless and libsql paths are tested **independently** — green on one does not imply the other.

---

## Transaction rollback

When multi-statement work uses `executor.transaction` or transactional `batch`:

- Throw / abort → no durable claim row for the failed unit.
- Single-statement claims do not need an outer txn for atomicity of that statement.

Do not rely solely on interactive remote write transactions (lock/timeout risk) without single-statement or batch atomicity for claims.

---

## Read-after-write

Within the same primary / consistent remote session model:

- After a successful claim or complete on worker A, subsequent reads against the same shared DB observe the committed row (`readAfterWrite: "strong"` under normal single-primary assumptions).
- Cross-region replicas / untested embedded-replica lag is **not** advertised — do not claim multi-region strong consistency without caveats.

---

## Timeout / reconnect

| Event | Adapter behavior |
| ----- | ---------------- |
| Network timeout | `StoreTimeoutError` / `StoreUnavailableError` (retryable where appropriate) |
| Connection refused / DNS | `StoreUnavailableError` |
| Uncertain mid-write | Re-read / re-claim; never invent terminal failure |
| Auth failure | Mapped unavailable/invalid; **token redacted** from messages |

Clients should be recreated or reused per driver docs. Do not log `TURSO_AUTH_TOKEN` / `LIBSQL_AUTH_TOKEN`.

---

## Lease reclaim under contention

1. Worker A holds lease; crashes or times out before complete.
2. After `lease_expires_at` (injectable clock in tests), worker B reclaims.
3. A’s stale mutators → `StoreLeaseLostError`.
4. Handlers are at-least-once — side effects must be idempotent.

FakeClock-driven reclaim is covered in conformance and package tests (see [testing.md](./testing.md)).

---

## libSQL vs serverless concurrency notes

| Binding | Notes |
| ------- | ----- |
| `/serverless` | Fetch remote; Turso serverless concurrency / MVCC characteristics |
| `/libsql` | Remote concurrent-write limits may differ; local `file:` is single-host semantics |

Document operator limits for your deployment. Re-run multi-connection suites when upgrading drivers.

---

## Related

- [claims.md](./claims.md)
- [crash-boundaries.md](./crash-boundaries.md)
- [guarantees.md](./guarantees.md)
- [testing.md](./testing.md)
- [drivers.md](./drivers.md)
