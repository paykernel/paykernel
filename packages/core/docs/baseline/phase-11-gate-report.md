# Phase 11 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate after remediation  
**Package:** `@paykernel/internal-sql-store` (`internal/sql-store`, private)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`internal/sql-store/docs/phase-11-gate-report.md`](../../../../internal/sql-store/docs/phase-11-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 11 private relational foundation is **complete and green**. Prior fail-closed gate blocked on `webhookFailTemplates` column mismatch (`last_error` vs `last_error_sanitized`); remediation is independently re-verified (source + dist + regression + safety net).

| Area | Result |
| --- | --- |
| Tests | **1262 pass, 0 fail** (`bun test packages/core packages/testkit packages/webhooks internal/sql-store`); sql-store focused **76 pass** |
| Coverage (core) | **99.51% funcs / 98.60% lines** |
| typecheck / typecheck:types | exit 0 (all packages + core types) |
| build + dist | core / webhooks / testkit / sql-store OK (`sql-store` index.js **81102** bytes) |
| boundaries / portability / validate:package | all OK (Deno smoke SKIP, non-blocking) |
| A1 migrations/schema share without unsafe abstraction | **PASS** |
| A2 explicit versioned migrations | **PASS** |
| A3 atomic claims under contention | **PASS** |
| 11.1–11.5 deliverables | **PASS** (11.5 B1 fixed) |
| Package private / privateInternal | **yes** |
| core/webhooks → sql-store | **none** |
| Phase 12 adapter-\* packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Share behavior/schema intent without unsafe driver abstraction | **PASS** |
| A2 | Migrations explicit and versioned | **PASS** |
| A3 | Atomic claims validated under contention | **PASS** |

## Prior blocking (resolved)

1. **`webhookFailTemplates` used `last_error`; foundation schema uses `last_error_sanitized`.**  
   **Resolved:** templates SET `last_error_sanitized`; regression in `algorithm.test.ts` asserts template SET cols ⊆ DDL/column maps and forbids bare `last_error =`; dist rebuilt.

## Non-blocking

- Deno smoke SKIP when binary absent  
- Migrations as TS string builders (not separate `.sql` files) for private foundation  
- Multi-host Postgres contention deferred to Phase 12 adapters (documented)

## Independent re-run evidence (high level)

```text
bun test packages/core packages/testkit packages/webhooks internal/sql-store  → 1262 pass
bun test internal/sql-store                                                    → 76 pass
bun run typecheck                                                              → 0
bun test --coverage packages/core                                              → 99.51% / 98.60%
bun run build                                                                  → 0
bun run check:boundaries                                                       → OK
bun run check:runtime-portability                                              → OK
bun run validate:package                                                       → OK
```

Full checklist, file citations, anti-bug matrix, and B1 resolution: see primary report.
