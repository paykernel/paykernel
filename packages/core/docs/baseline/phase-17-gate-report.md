# Phase 17 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate  
**Package:** `@paykernel/store-durable-objects` (`packages/store-durable-objects`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/store-durable-objects/docs/phase-17-gate-report.md`](../../../store-durable-objects/docs/phase-17-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 17 **multi-host partitioned SQLite-backed Durable Objects** adapter (`@paykernel/store-durable-objects`) is **complete and green**. Independent adversarial re-verification: **1614 tests pass** (15 env-gated skips), typecheck, boundaries, runtime portability, DO+core builds, and adapter pack/publint/attw all pass. Core coverage **99.51% funcs / 98.60% lines**. A1–A3 and 17.1–17.5 satisfied; production graph has no local-sqlite/`cloudflare:workers` static imports; claims use single-statement UPSERT RETURNING + optional `transactionSync`; sharding is explicit (`key`/`hash`/`tenant`, never global); optional partitioned alarms with backoff/jitter; separate from D1; no generic `adapter-cloudflare`.

| Area | Result |
| --- | --- |
| Tests | **1614 pass, 15 skip, 0 fail** (core + testkit + webhooks + sql-store + adapter-postgres + adapter-redis + adapter-sqlite + adapter-turso + adapter-cloudflare-d1 + adapter-cloudflare-do) |
| Adapter-cloudflare-do focused | **60 pass, 0 fail** |
| typecheck / boundaries / runtime-portability / build / pack·publint·attw (DO) | all OK |
| Core coverage | **99.51% funcs / 98.60% lines** |
| A1 strong per-partition coordination | **PASS** |
| A2 no external I/O inside storage transactions | **PASS** |
| A3 sharding + hot-key docs | **PASS** |
| 17.1–17.5 deliverables | **PASS** |
| Separate from D1 / no generic umbrella | **PASS** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Strong per-partition coordination (manifest, atomic claims, concurrency, partitions, restart) | **PASS** |
| A2 | External payment calls never inside storage transactions | **PASS** |
| A3 | Sharding strategies + hot-key risks documented; no global DO default | **PASS** |

## Deliverables (short)

| Section | Verdict |
| --- | --- |
| 17.1 SQLite-backed DO only (`new_sqlite_classes`, `sql.exec`) | **PASS** |
| 17.2 Sharding key/hash/tenant; deterministic; no silent global | **PASS** |
| 17.3 transactionSync / sync SQL; no external I/O in txn | **PASS** |
| 17.4 Optional alarms: bounded retries, backoff+jitter, partitioned queue | **PASS** |
| 17.5 Tests: concurrent key, partitions, restart, alarms, stale lease, txn rollback | **PASS** |
| Injectable FakeClock; explicit migrate only | **PASS** |
| Phase 0–16 safety net; boundaries; no illegal deps | **PASS** |

## Independent counts (gate re-run)

```text
core + testkit + webhooks + sql-store     → 1261 pass
redis + sqlite + turso + d1 + do          →  300 pass, 12 skip
adapter-postgres                          →   53 pass,  3 skip
────────────────────────────────────────────────────────────
TOTAL                                     → 1614 pass, 15 skip, 0 fail
adapter-cloudflare-do focused             →   60 pass,  0 fail
core coverage                             → 99.51% funcs / 98.60% lines
```

## Non-blocking

- Worker client list/cleanup is partition-local (sentinel shard keys under hash sharding) — documented.
- See primary report for full anti-bug matrix and command transcripts.

## Verdict

**PASS** — Phase 17 complete and green. No blocking findings. No fixes required by this gate.
