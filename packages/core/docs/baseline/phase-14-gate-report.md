# Phase 14 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate  
**Package:** `@paykernel/store-sqlite` (`packages/store-sqlite`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/store-sqlite/docs/phase-14-gate-report.md`](../../../store-sqlite/docs/phase-14-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 14 **single-host** SQLite adapter (`@paykernel/store-sqlite`) is **complete and green**. Independent adversarial re-verification: **1437 tests pass** (15 env-gated skips), typecheck, build, boundaries, and package validation all pass. A1–A3 and 14.1–14.6 satisfied; root has no drivers; claims use `BEGIN IMMEDIATE`; migrate is explicit; no Phase 15 packages.

| Area | Result |
| --- | --- |
| Tests | **1437 pass, 15 skip, 0 fail** (core + testkit + webhooks + sql-store + adapter-postgres + adapter-redis + adapter-sqlite) |
| Adapter-sqlite focused | **53 pass, 0 fail** |
| typecheck / build / boundaries / validate:package | all OK |
| A1 Bun production-capable single-host | **PASS** |
| A2 Subpath driver isolation | **PASS** |
| A3 No multi-host misrepresentation | **PASS** |
| 14.1–14.6 deliverables | **PASS** |
| Phase 15 packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Bun SQLite production-capable single-host adapter | **PASS** |
| A2 | Each subpath imports only its driver; root has none | **PASS** |
| A3 | Local SQLite never advertised as distributed coordination | **PASS** |

## Deliverables (short)

| Section | Verdict |
| --- | --- |
| 14.1 Bun binding | **PASS** |
| 14.2 Node SQLite isolated + stability matrix | **PASS** |
| 14.3 better-sqlite3 binding | **PASS** |
| 14.4 Atomic claims (BEGIN IMMEDIATE) | **PASS** |
| 14.5 Deployment limits documented | **PASS** |
| 14.6 Test matrix (memory/file/contention/WAL/restart/migration) | **PASS** |

## Non-blocking

- Live PG/Redis suites skip without URLs (15 total skips in combined run)
- Deno smoke SKIP when binary absent
- better-sqlite3 may skip-clean under Bun ABI mismatch on other hosts (passed in this run)

## Independent re-run evidence (high level)

```text
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite
  → 1437 pass, 15 skip, 0 fail

bun test packages/store-sqlite
  → 53 pass, 0 fail

bun run typecheck                     → exit 0
bun run check:boundaries              → OK
bash scripts/validate-package.sh      → OK
```

## Final verdict

**PASS** — Phase 14 complete. See primary report for full evidence matrix and anti-bug checklist.
