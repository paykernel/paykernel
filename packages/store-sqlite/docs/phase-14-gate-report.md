# Phase 14 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Package:** `@paykernel/store-sqlite` (`packages/store-sqlite`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Verdict summary

Phase 14 local/embedded **single-host** SQLite adapter is **complete and green**. Independent adversarial re-verification (no trust of implementer claims without code/test/docs evidence) confirms:

| Area | Result |
| --- | --- |
| Full safety net + adapters | **1437 pass, 15 skip, 0 fail** (`core` + `testkit` + `webhooks` + `sql-store` + `adapter-postgres` + `adapter-redis` + `adapter-sqlite`) |
| Adapter-sqlite focused | **53 pass, 0 fail** (incl. Bun memory/file conformance, contention, WAL/busy, restart, migration; node + better-sqlite3 ran and passed in this environment) |
| typecheck (all workspace packages) | exit 0 |
| `check:boundaries` | OK |
| `validate:package` | OK (build, dist, portability, publint, attw, consumer smoke) |
| Package exports | `.` / `./bun` / `./node` / `./better-sqlite3` |
| Manifest | `coordinationScope: "single-host"` |
| Phase 15 packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Bun SQLite is a production-capable single-host adapter | **PASS** | Subpath `@paykernel/store-sqlite/bun`; `createBunSqliteStores` / `createBunSqliteExecutor` / in-memory helpers (`createInMemoryBunSqliteStores`, `createBunSqliteStoresInMemory`); prepared statements via `db.prepare`/`db.query`; claim paths use `transaction(fn, { mode: "immediate" })` → `BEGIN IMMEDIATE`; `applyRecommendedPragmas` for `busy_timeout` + optional WAL; Bun memory + file-backed conformance pass; file restart durability test; multi-connection contention pass |
| **A2** | Each subpath imports only its driver | **PASS** | `src/drivers/bun.ts` → `bun:sqlite` only; `src/drivers/node.ts` → `node:sqlite` only; `src/drivers/better-sqlite3.ts` → `better-sqlite3` only; root `src/index.ts` / `dist/index.js` have **zero** driver imports; `public-api.test.ts` walks production graph excluding subpath entry files; dist entry scan confirms isolation |
| **A3** | No local SQLite adapter misrepresented as distributed coordination | **PASS** | `SQLITE_STORAGE_ADAPTER_MANIFEST.coordinationScope === "single-host"`; never multi-host/multi-region; `docs/deployment-limits.md` documents all four 14.5 limits; overview/README/guarantees/claims honesty; manifest notes: one FS authority, no network FS, no serverless ephemeral, scale-out needs shared service |

## Deliverables 14.1–14.6

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **14.1** | Bun SQLite binding complete | **PASS** | `src/drivers/bun.ts`: prepared statements, sync IMMEDIATE txns, `createBunSqliteStores`, in-memory helpers, pragma helpers re-exported; docs in `docs/drivers.md` |
| **14.2** | Node SQLite binding isolated + version/stability docs | **PASS** | Isolated `/node` subpath + `NODE_SQLITE_SUPPORT` matrix (min 22.5.0, experimental); `docs/drivers.md` + README matrix; BigInt `changes` normalized; skip-clean when unavailable |
| **14.3** | better-sqlite3 binding complete | **PASS** | `/better-sqlite3` optional peer; prepared statements + depth-tracked `BEGIN IMMEDIATE`; `defaultSafeIntegers(true)`; skip-clean on native load failure |
| **14.4** | Claim semantics atomic (IMMEDIATE txn or ON CONFLICT) | **PASS** | Stores use `exec.transaction(() => { INSERT OR IGNORE + conditional UPDATE … }, { mode: "immediate" })` for reserve/claim/renew (idempotency, webhook, reconciliation); docs/claims.md forbids unprotected get-then-set; contention tests prove one winner |
| **14.5** | Deployment limits documented | **PASS** | `docs/deployment-limits.md` (four limits), mirrored in README, overview, manifest notes, guarantees |
| **14.6** | Test matrix | **PASS** | Bun memory + file conformance; node skip-clean (passed here); better-sqlite3 skip-clean (passed here); contention; busy + WAL; restart; migration tests present and green |

## Cross-cutting requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Three createSqlite\* factories + bundle | **PASS** | `createSqliteIdempotencyStore`, `createSqliteWebhookInboxStore`, `createSqliteReconciliationStore`, `createSqliteStores` (+ per-driver `createBunSqliteStores` / `createNodeSqliteStores` / `createBetterSqlite3Stores`) |
| Injectable clock / FakeClock | **PASS** | `StoreClock` + `createSystemClock` / `clockNowIso` / `clockAddMsIso`; conformance injects `createFakeClock()`; unit test “FakeClock controls lease reclaim” |
| Explicit migrate only; never on import | **PASS** | `import-no-migrate.test.ts`; factories do not migrate; only `migrateSqliteAdapter` / `verifySqliteAdapterSchema` |
| Uses internal/sql-store foundation | **PASS** | Depends on `@paykernel/internal-sql-store`; sqlite claim templates + migrate/verify + namespace |
| Docs complete (incl. 14.5) | **PASS** | overview, claims, crash-boundaries, deployment-limits, drivers, guarantees, migrations, testing + README + CHANGELOG |
| Phase 0–13 safety net still green | **PASS** | 1437 pass across full suite including postgres/redis adapters |
| Boundaries; no illegal deps | **PASS** | `check:boundaries` OK; core/webhooks do not depend on adapter-sqlite; redis does not depend on sql-store |
| No Phase 15 packages | **PASS** | No `adapter-turso` / D1 / cloudflare packages under `packages/` |
| Monorepo scripts / build | **PASS** | Root scripts wire adapter-sqlite into build/test/typecheck; dist builds 4 entries (`index`, `bun`, `node`, `better-sqlite3`) |

## Anti-bug matrix (logical risks)

| Risk | Verdict | Evidence |
| --- | --- | --- |
| get/set claim race | **PASS** | IMMEDIATE multi-step claims; multi-connection contention tests |
| async txn callbacks on claim path | **PASS** | Claim bodies are sync `transaction(fn, { mode: "immediate" })`; docs forbid async inside claim callbacks; `withStoreTransaction` requires `runInTransaction` for async |
| multi-host lies | **PASS** | Manifest + docs + A3; public-api asserts not multi-host/multi-region |
| secrets unbounded | **PASS** | `enforceMaxSanitizedError` on error fields; `mapDriverError` sanitizes; errors.test covers secret-like tokens |
| root importing drivers | **PASS** | A2 evidence + public-api graph walk |
| FakeClock ignored | **PASS** | Conformance + unit reclaim test use injected clock via `clockNowIso` / SQL `now` binds |
| auto-migrate | **PASS** | import-no-migrate + factory construction does not execute |
| serverless advertised durable | **PASS** | deployment-limits explicitly forbids ephemeral serverless FS for durable inbox/idempotency |

## Dist driver isolation (independent scan)

```text
dist/index.js            → (none)
dist/bun.js              → import { Database } from "bun:sqlite"
dist/node.js             → import { DatabaseSync } from "node:sqlite"
dist/better-sqlite3.js   → import Database from "better-sqlite3"
```

## Independent re-run evidence

```text
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite
  → 1437 pass, 15 skip, 0 fail

bun test packages/store-sqlite
  → 53 pass, 0 fail

bun run typecheck                     → exit 0 (all 7 workspace packages)
bun run check:boundaries              → workspace boundaries OK
bash scripts/validate-package.sh      → package validation OK
  (includes build of adapter-sqlite 4 entries, portability, publint, attw, consumer smoke)
```

### Skip inventory (non-blocking)

- Live PostgreSQL suites skip without `PAYMENTS_SDK_PG_URL` / `DATABASE_URL` (3)
- Live Redis suites skip without Redis/Valkey URL (11)
- Deno smoke SKIP when `deno` binary absent (portability static scan still required and passed)
- Node / better-sqlite3 suites are skip-clean when drivers unavailable; **in this gate run both loaded and passed**

## Docs inventory

| Doc | Role |
| --- | --- |
| `docs/overview.md` | Phase 14 overview + honesty |
| `docs/claims.md` | 14.4 IMMEDIATE claim strategy |
| `docs/deployment-limits.md` | **14.5** four limits |
| `docs/drivers.md` | Subpaths + Node matrix |
| `docs/guarantees.md` | Manifest field honesty |
| `docs/migrations.md` | Explicit migrate |
| `docs/testing.md` | Matrix + FakeClock |
| `docs/crash-boundaries.md` | Crash / reclaim boundaries |
| `README.md` / `CHANGELOG.md` | Package surface |

## Non-blocking notes

- Live multi-host PG/Redis integration not re-exercised without servers (expected skip pattern; Phase 14 is single-host file SQLite)
- Deno consumer smoke skipped when binary absent (static `node:` ban still enforced on portable packages)
- better-sqlite3 may still skip-clean under Bun ABI mismatch on other machines (documented; not a gate failure)

## Final verdict

**PASS** — Phase 14 complete. Bun is production-capable single-host; drivers isolated per subpath; coordination honesty enforced in manifest + docs; claim paths use `BEGIN IMMEDIATE` multi-step transactions; migrate is explicit; full monorepo safety net and package validation green; no Phase 15 adapters.
