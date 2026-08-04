# Phase 11 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate after remediation  
**Package under review:** `@paykernel/internal-sql-store` (`internal/sql-store`, **private**)  
**Monorepo peers:** `@paykernel/core`, `@paykernel/webhooks`, `@paykernel/testkit`  
**Reviewer stance:** fail-closed (missing evidence = blocking; implementer claims re-verified independently)  
**Verdict:** **PASS**

> Baseline pointer copy: [`packages/core/docs/baseline/phase-11-gate-report.md`](../../../packages/core/docs/baseline/phase-11-gate-report.md)

---

## Executive summary

Phase 11 delivers a private relational foundation under `internal/sql-store`: four canonical tables, validated namespace, codecs, versioned explicit migrations, pure claim decisions, dialect-tagged SQL templates, and contention proofs on memory-relational + bun:sqlite references.

**Prior gate (same day):** **FAIL** on B1 — exported `webhookFailTemplates()` wrote column `last_error` while foundation DDL/codecs/column maps use `last_error_sanitized`.

**Remediation re-verified:**

| Check | Evidence |
| --- | --- |
| Source templates | `src/claims/templates.ts` SET uses `last_error_sanitized = $4` / `= ?` (comment: never raw `last_error`) |
| Dist | `dist/index.js` contains `last_error_sanitized = $4` / `= ?`; no `last_error =` assignment |
| Regression | `algorithm.test.ts` — `complete/fail templates…` asserts `last_error_sanitized` present and `/\blast_error\s*=/` absent; **`template SET columns are a subset of foundation DDL / column maps`** covers all claim mutators |
| Tests | B1 regression green; sql-store **76 pass** (prior gate 75 + regression) |

Monorepo safety net is green (1262 tests, typecheck, coverage, build, boundaries, portability, validate:package). Core/webhooks do not depend on sql-store; no Phase 12 `packages/adapter-*` exist; package is `"private": true`.

**Fail-closed verdict:** all A1–A3 and deliverables 11.1–11.5 evidenced → **PASS**.

---

## Independent command evidence (re-gate)

| Command | Result |
| --- | --- |
| `bun test packages/core packages/testkit packages/webhooks internal/sql-store` | **1262 pass, 0 fail** (55 files, ~6.7s) |
| `bun test internal/sql-store` | **76 pass, 0 fail** (8 files, 660 expects) |
| `bun test --coverage packages/core` | **1000 pass**; **All files 99.51% funcs / 98.60% lines** |
| `bun run typecheck` | exit 0 (core, webhooks, testkit, sql-store) |
| `bun run typecheck:types` | exit 0 (core type tests) |
| `bun run build` | exit 0; dist present for all four packages |
| `bun run check:boundaries` | **workspace boundaries OK** |
| `bun run check:runtime-portability` | **OK** (Deno smoke SKIP — non-blocking) |
| `bun run validate:package` | **package validation OK** (publint, attw, consumer smoke) |

### Dist presence (post-build)

| Artifact | Size (bytes) |
| --- | --- |
| `internal/sql-store/dist/index.js` | 81102 |
| `packages/core/dist/index.js` | 327936 |
| `packages/testkit/dist/index.js` | 150362 |
| `packages/webhooks/dist/index.js` | 15525 |

---

## Acceptance criteria (roadmap Phase 11)

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Relational adapters share behavior and schema intent without unsafe driver abstraction | **PASS** | Private `@paykernel/internal-sql-store`; canonical tables/columns (`src/schema/tables.ts`); codecs (`src/codecs/*`); dialect-aware templates (`src/claims/templates.ts` — postgres ≠ sqlite, not a pretend-one-driver API); narrow `SqlExecutor` only for migrate/verify; public-api test forbids ORM/query-builder exports; `"private": true` + `paymentsSdk.privateInternal: true`; no public general SQL API; **templates SET columns ⊆ DDL / column maps** (regression) |
| **A2** | Migrations are explicit and versioned | **PASS** | `CURRENT_SCHEMA_VERSION` / `SCHEMA_VERSION_V1` (`src/schema/versions.ts`); `MIGRATIONS` / `MIGRATION_001` metadata (`src/migrations/metadata.ts`); raw dialect SQL builders (`src/migrations/definitions.ts`); explicit `migrate()` / `verifySchema()`; `import-no-migrate.test.ts` + public-api prove **no auto-migrate on import**; migrate.test proves idempotency + dialect placeholders |
| **A3** | Atomic claims validated under contention | **PASS** | `claim-contention.test.ts`: concurrent reserve/claim → **exactly one acquired**; reclaim generation bump; stale token rejected; `atomicityModel === process_local_mutex` (memory) / `sqlite_single_sync_transaction` (bun); multi-connection same-file sqlite one-winner; harness `runClaimContentionHarness`; pure decisions + conditional SQL templates (not get-then-set across connections) |

---

## Deliverables 11.1–11.5

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **11.1** | Private shared SQL layer | **PASS** | `internal/sql-store` workspace package; tables, codecs, templates, versions, fixtures (`src/fixtures/migration-fixtures.ts`), validation; not published |
| **11.2** | Canonical schema four tables + PKs/indexes/constraints/hashes/timestamps/sanitized errors/tenant | **PASS** | Logical tables: `payment_idempotency`, `payment_webhook_inbox`, `payment_reconciliation_jobs`, `payment_storage_migrations`; PKs on key/version; status CHECKs; indexes for lease/due/available/tenant/payload_hash; `payload_hash TEXT`; ISO TEXT timestamps; `error_sanitized` / `last_error_sanitized` + `MAX_SANITIZED_ERROR_LENGTH=512`; optional `tenant_id` |
| **11.3** | Namespace config validated; never unvalidated table interpolation | **PASS** | `createSchemaNamespace` validates prefix, sqlSchema, tenantColumn; injection attacks rejected (`namespace.test.ts`); `resolveTableName` only on known logical tables + re-validate physical name |
| **11.4** | Migration policy: raw SQL, metadata, migrate, verify; never auto on import/prod construction | **PASS** | definitions + metadata + migrate + verify; import-side-effect tests; reference `applySchemaOnCreate` is **test-only / NON_PRODUCTION** (not package import). Foundation stores raw SQL in TS builders (not separate `.sql` files) — acceptable for private foundation; Phase 12 adapters may ship file-form |
| **11.5** | Atomic claim algorithm: insert/reclaim/generation/token; dialect equivalence intent; contention proof | **PASS** | Pure `decide*` / `evaluateClaim` + generation/token dual fencing; contention proofs (memory + bun:sqlite + multi-connection); dialect templates for reserve/claim/complete/fail; **B1 fixed** — `webhookFailTemplates` uses `last_error_sanitized`; regression asserts all template SET cols ⊆ foundation DDL and column maps |

---

## Package / monorepo safety

| Check | Verdict | Evidence |
| --- | --- | --- |
| Package `private: true` under `internal/sql-store` | **PASS** | `package.json`: `"private": true`, name `@paykernel/internal-sql-store`, `paymentsSdk.privateInternal: true`, no public `publishConfig` |
| Phase 0–10 safety net still green | **PASS** | 1262 tests; typecheck; coverage; build; validate:package |
| Boundaries | **PASS** | `check:boundaries` OK; rules for core↛sql-store, webhooks↛sql-store, sql-store↛core/webhooks |
| No core/webhooks → sql-store | **PASS** | No package.json deps; no source imports of `@paykernel/internal-sql-store` in core/webhooks |
| No Phase 12 `packages/adapter-*` | **PASS** | Workspace packages: core, testkit, webhooks only (`ls packages/` → no adapter-\*) |
| Docs / monorepo / boundaries updated | **PASS** | `docs/monorepo.md`, `docs/workspace-boundaries.md`, `docs/releases.md`, root README, sql-store docs, testkit store-contracts cross-links |

---

## Logical anti-bug probes

| Bug class | Verdict | Evidence |
| --- | --- | --- |
| Auto-migrate on import | **PASS** | `import-no-migrate.test.ts` (dynamic import → 0 executor calls); public-api fake db empty after import; index.ts documents never invoke migrate at load |
| Get-then-set claim race | **PASS** | Memory: mutex critical section; bun:sqlite: single sync `db.transaction` (no await in callback); SQL templates: conditional INSERT/UPDATE WHERE predicates; contention → one winner |
| SQL injection via table names | **PASS** | Namespace validators reject `;'"\\.\s`, `--`, `/*`; only `ALL_LOGICAL_TABLES` resolvable |
| `await` in sync SQLite tx | **PASS** | `bun-sqlite-store.test.ts` claim paths: transaction callbacks with no await; documented + tested |
| Secrets unbounded in error columns | **PASS** | `enforceMaxSanitizedError` max 512; codecs truncate; reference fail path uses sanitizer |
| JS number for 64-bit IDs | **PASS** | Keys / lease tokens are **strings**; generation/attempts validated as safe non-negative ints only (not as DB 64-bit identity) |
| Publishing internal package | **PASS** | `private: true`; no public publishConfig; boundaries require private internals |
| Core depending on sql-store | **PASS** | Boundaries + dep scan |
| **Template column vs schema** | **PASS** | B1 remediated: `webhookFailTemplates` → `last_error_sanitized`; regression `template SET columns are a subset of foundation DDL / column maps` for all mutators; dist rebuilt |

---

## Prior blocking issues (resolved)

### B1 — `webhookFailTemplates` wrote non-existent column `last_error` — **RESOLVED**

**Severity (at prior gate):** BLOCKING  
**Location:** `internal/sql-store/src/claims/templates.ts` (`webhookFailTemplates`)

**Canonical truth (consistent after fix):**

- DDL (`migrations/definitions.ts`): `last_error_sanitized TEXT`
- Column map (`schema/tables.ts`): `lastErrorSanitized: "last_error_sanitized"`
- Codecs (`codecs/rows.ts`): `last_error_sanitized`
- Reference bun:sqlite fail UPDATE: `last_error_sanitized = ?`
- Templates (source + dist): `last_error_sanitized = $4` / `= ?`

**Fix applied:**

1. SET columns changed to `last_error_sanitized`.
2. Regression test asserts every SET column in claim templates ⊆ foundation DDL / `*_COLUMNS` maps; also forbids bare `last_error =`.
3. `internal/sql-store` dist rebuilt (81102 bytes index.js).

---

## Blocking issues

**None.**

---

## Non-blocking notes

| ID | Note |
| --- | --- |
| NB1 | Deno import smoke SKIP when Deno binary absent (portability static scan still OK) — same as prior phases |
| NB2 | Foundation migrations are TS string builders, not separate `.sql` files; OK for private foundation; adapters may re-export file form in Phase 12 |
| NB3 | bun:sqlite reference defaults `applySchemaOnCreate: true` — test construction only, labeled NON_PRODUCTION; not package import auto-migrate |
| NB4 | Multi-host real Postgres contention remains Phase 12+ adapter responsibility (documented); Phase 11 proves intent + sqlite multi-connection + same-isolate mutex |

---

## Checklist

- [x] A1 schema/behavior share without unsafe driver abstraction
- [x] A2 explicit versioned migrations + no import auto-migrate
- [x] A3 contention: one acquired, generation bump, stale token, not get-then-set
- [x] 11.1 private shared SQL layer present
- [x] 11.2 four canonical tables + PK/index/CHECK/hash/timestamp/error/tenant
- [x] 11.3 namespace validated; no unvalidated table interpolation
- [x] 11.4 migrate/verify explicit; never on import
- [x] **11.5 templates fully schema-aligned** (B1 fixed + regression)
- [x] package private under `internal/sql-store`
- [x] 1262 tests green (core + testkit + webhooks + sql-store)
- [x] typecheck all packages + core type tests
- [x] core coverage 99.51% / 98.60%
- [x] build + dist present
- [x] check:boundaries OK
- [x] check:runtime-portability OK
- [x] validate:package OK
- [x] core/webhooks free of sql-store
- [x] no packages/adapter-\* production adapters
- [x] anti-bugs: auto-migrate, claim race, SQL injection, await-in-sqlite-tx, unbounded errors, JS 64-bit IDs, publish internal, core→sql-store
- [x] **anti-bug: template columns match schema** (regression + dist)

---

## Verdict

**PASS** — prior blocking defect B1 (`webhookFailTemplates` column `last_error` ≠ schema `last_error_sanitized`) is remediated and independently re-verified (source, dist, regression, full safety net). All Phase 11 acceptance criteria (A1–A3) and deliverables 11.1–11.5 pass under fail-closed review.

---

## Report paths

- Primary: `internal/sql-store/docs/phase-11-gate-report.md` (this file)
- Baseline: `packages/core/docs/baseline/phase-11-gate-report.md`
