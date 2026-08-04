# Phase 15 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate  
**Package:** `@paykernel/store-turso` (`packages/store-turso`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/store-turso/docs/phase-15-gate-report.md`](../../../store-turso/docs/phase-15-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 15 **multi-host Turso / libSQL** adapter (`@paykernel/store-turso`) is **complete and green**. Independent adversarial re-verification: **1499 tests pass** (15 env-gated skips), typecheck, boundaries, runtime portability, and package validation all pass. Core coverage **98.60% lines**. A1–A3 and 15.1–15.4 satisfied; root has no driver static imports; claims use single-statement UPSERT/RETURNING; migrate is explicit; no `./sync`; no Phase 16 Cloudflare packages.

| Area | Result |
| --- | --- |
| Tests | **1499 pass, 15 skip, 0 fail** (core + testkit + webhooks + sql-store + adapter-postgres + adapter-redis + adapter-sqlite + adapter-turso) |
| Adapter-turso focused | **61 pass, 0 fail** |
| typecheck / boundaries / runtime-portability / validate:package | all OK |
| Core coverage | **98.60% lines** |
| A1 Turso remote shared durable store | **PASS** |
| A2 libSQL compatibility | **PASS** |
| A3 no untested sync/embedded-replica claims | **PASS** |
| 15.1–15.4 deliverables | **PASS** |
| Phase 16 packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Turso remote shared durable inbox + reconciliation | **PASS** |
| A2 | libSQL compatibility (`./libsql`, createLibsqlStores) | **PASS** |
| A3 | sync/embedded-replica not advertised beyond tested guarantees | **PASS** |

## Deliverables (short)

| Section | Verdict |
| --- | --- |
| 15.1 Turso serverless binding | **PASS** |
| 15.2 libSQL binding (tx/batch; remote + file; replica honesty) | **PASS** |
| 15.3 Concurrency (claims, rollback, RAW, timeout map, lease, multi-instance) | **PASS** |
| 15.4 Drizzle optional docs-only; claims via adapter path | **PASS** |

## Cross-cutting (short)

| Requirement | Verdict |
| --- | --- |
| Injectable clock / FakeClock | **PASS** |
| Explicit migrate; never on import | **PASS** |
| Root free of driver static imports | **PASS** |
| Multi-host honest manifest | **PASS** |
| No illegal deps / Phase 16 packages | **PASS** |
| Phase 0–14 safety net | **PASS** |

## Independent re-run (summary)

```text
bun test … (core testkit webhooks sql-store postgres redis sqlite turso) → 1499 pass / 15 skip / 0 fail
bun test packages/store-turso → 61 pass
bun run typecheck → 0
bun run check:boundaries → OK
bun run check:runtime-portability → OK
bash scripts/validate-package.sh → OK
bun test --coverage packages/core → 98.60% lines
```

## Non-blocking

- Live Turso Cloud / serverless multi-connection skip-clean without remote env (harnesses present).
- Timeout/reconnect via error-mapping unit tests + docs (not live soak).
- Deno smoke skipped (binary missing); static portability scan still required and OK.

## Final verdict

**PASS** — Phase 15 complete. Zero blocking findings.

Full evidence tables, anti-bug matrix, and dist isolation: see the [primary report](../../../store-turso/docs/phase-15-gate-report.md).
