# Phase 16 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate  
**Package:** `@paykernel/store-d1` (`packages/store-d1`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/store-d1/docs/phase-16-gate-report.md`](../../../store-d1/docs/phase-16-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 16 **multi-host Cloudflare D1** adapter (`@paykernel/store-d1`) is **complete and green**. Independent adversarial re-verification: **1556 tests pass** (15 env-gated skips), typecheck, boundaries, runtime portability, full monorepo build, and package validation all pass. Core coverage **99.51% funcs / 98.60% lines**. A1–A3 and 16.1–16.6 satisfied; production graph has no local-sqlite/`cloudflare:workers` static imports; claims use single-statement UPSERT/UPDATE RETURNING; migrate is explicit; multi-host honest manifest with session RAW caveats; no Phase 17 `adapter-cloudflare-do` package.

| Area | Result |
| --- | --- |
| Tests | **1556 pass, 15 skip, 0 fail** (core + testkit + webhooks + sql-store + adapter-postgres + adapter-redis + adapter-sqlite + adapter-turso + adapter-cloudflare-d1) |
| Adapter-cloudflare-d1 focused | **58 pass, 0 fail** |
| typecheck / boundaries / runtime-portability / validate:package / build | all OK |
| Core coverage | **99.51% funcs / 98.60% lines** |
| A1 distributed Worker safety | **PASS** |
| A2 no local SQLite leak | **PASS** |
| A3 D1 guarantees/limits docs | **PASS** |
| 16.1–16.6 deliverables | **PASS** |
| Phase 17 package | **absent** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Safe for distributed Worker deployments (multi-host, atomic claims, concurrency, restart) | **PASS** |
| A2 | No local SQLite driver assumptions in D1 production path | **PASS** |
| A3 | D1-specific guarantees, limits, sessions/replication, Wrangler docs | **PASS** |

## Deliverables (short)

| Section | Verdict |
| --- | --- |
| 16.1 D1 binding `createD1PaymentStores({ db })` — no REST | **PASS** |
| 16.2 Prepared statements; single-statement claims; batch; sessions | **PASS** |
| 16.3 Migrations without BEGIN/COMMIT; Wrangler examples | **PASS** |
| 16.4 TEXT numeric portability | **PASS** |
| 16.5 Primary claims + session strategy for RAW under replication | **PASS** |
| 16.6 Concurrent deliveries, atomic claims, batch rollback, sessions, migrations, restarts | **PASS** |

## Cross-cutting (short)

| Requirement | Verdict |
| --- | --- |
| Injectable clock / FakeClock | **PASS** |
| Explicit migrate; never on import | **PASS** |
| Production free of local-sqlite / cloudflare:workers imports | **PASS** |
| Multi-host honest manifest | **PASS** |
| No illegal reverse deps / Phase 17 DO package | **PASS** |
| Phase 0–15 safety net | **PASS** |

## Independent re-run (summary)

```text
bun test … (core testkit webhooks sql-store postgres redis sqlite turso cloudflare-d1)
  → 1556 pass / 15 skip / 0 fail
bun test packages/store-d1 → 58 pass
bun run typecheck → 0
bun run check:boundaries → OK
bun run check:runtime-portability → OK
bun run build → 0
bash scripts/validate-package.sh → OK
bun test --coverage packages/core → 99.51% funcs / 98.60% lines
```

## Non-blocking

- Live D1 binding / REST conformance skip-clean without Cloudflare env (mock D1 CI path green).
- Optional executor interactive `BEGIN IMMEDIATE` for mock/withTransaction; live path prefers UPSERT/`batch()` (documented).
- Deno smoke skipped (binary missing); static portability scan still required and OK.

## Final verdict

**PASS** — Phase 16 complete. Zero blocking findings.

Full evidence tables, anti-bug matrix, and dist isolation: see the [primary report](../../../store-d1/docs/phase-16-gate-report.md).
