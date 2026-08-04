# Phase 15 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Package:** `@paykernel/store-turso` (`packages/store-turso`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Verdict summary

Phase 15 **Turso / libSQL multi-host** adapter is **complete and green**. Independent adversarial re-verification (no trust of implementer claims without code/test/docs evidence) confirms:

| Area | Result |
| --- | --- |
| Full safety net + adapters | **1499 pass, 15 skip, 0 fail** (`core` + `testkit` + `webhooks` + `sql-store` + `adapter-postgres` + `adapter-redis` + `adapter-sqlite` + `adapter-turso`) |
| Adapter-turso focused | **61 pass, 0 fail** (public API, import-no-migrate, migrate, drivers unit, stores unit, errors, conformance libsql memory/file, concurrency 15.3, serverless live skip-clean) |
| typecheck (all workspace packages) | exit 0 |
| `check:boundaries` | OK |
| `check:runtime-portability` | OK (Deno binary smoke skipped — static node: scan required and passed) |
| `validate:package` | OK (build, dist, portability, publint, attw, consumer smoke) |
| Core coverage | **98.60% lines** / 99.51% funcs (`bun test --coverage packages/core`) |
| Package exports | `.` / `./serverless` / `./libsql` only (**no `./sync`**) |
| Manifest | `coordinationScope: "multi-host"`, `durability: "durable"`, `claims: "strong"`, honesty notes present |
| Phase 16 packages | **absent** (no `adapter-cloudflare-d1` / `adapter-cloudflare-do`) |
| Blocking issues | **0** |

## Acceptance criteria

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Turso remote deployments can act as a shared durable inbox and reconciliation store | **PASS** | Package `@paykernel/store-turso`; `TURSO_STORAGE_ADAPTER_MANIFEST` multi-host durable strong claims; three factories `createTursoIdempotencyStore` / `createTursoWebhookInboxStore` / `createTursoReconciliationStore` + `createTursoStores`; UPSERT/RETURNING claims; explicit `migrateTursoAdapter`; conformance on libsql `:memory:` + `file:`; concurrency multi-instance + parallel reserve; docs: overview, guarantees, crash-boundaries, concurrency, claims; `./serverless` + remote libsql path; live remote tests skip-clean when env unset |
| **A2** | libSQL compatibility remains available | **PASS** | Export `./libsql`; `createLibsqlStores` / `createLibsqlExecutor` / per-store factories; duck-typed `@libsql/client` surface (optional peer); remote + `file:` / `:memory:` documented and tested; root does not import `@libsql/client` |
| **A3** | sync or embedded-replica modes not advertised beyond tested guarantees | **PASS** | No `./sync` in `package.json` exports; public-api test asserts export keys exactly `.`, `./libsql`, `./serverless`; `docs/embedded-replicas.md` states embedded replica ≠ local-first sync; manifest notes forbid advertising untested sync; drivers.md honesty |

## Deliverables 15.1–15.4

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **15.1** | Turso serverless binding complete (prefer single-statement claims) | **PASS** | `src/drivers/serverless.ts` + `./serverless` subpath; `createExecutorFromServerless` / `createTursoServerlessStores`; batch mode `"immediate"`; `transactionAsync` → executor.transaction; stores use single-statement UPSERT/RETURNING; unit tests + live skip-clean harness |
| **15.2** | libSQL binding complete (tx/batch; remote + file; replica honesty) | **PASS** | `src/drivers/libsql.ts` + `./libsql`; `BEGIN IMMEDIATE` / COMMIT / ROLLBACK txn; `client.batch(..., "write")`; remote + `file:` / `:memory:` support; embedded-replicas docs + manifest honesty |
| **15.3** | Concurrency tests | **PASS** | `concurrency.turso.test.ts`: concurrent claims (idempotency + webhook), txn rollback, read-after-write, FakeClock lease expiry + stale token, multi-instance (two stores / two clients), live multi-connection skip-clean, serverless multi-connection skip-clean; timeout/reconnect classes mapped in `errors.ts` + unit tests (`TIMEOUT`, fetch failed, hrana stream closed) |
| **15.4** | Drizzle optional schema/examples; claims via tested adapter path | **PASS** | `docs/drizzle.md` docs-only examples; **no** `./drizzle` export; **no** `drizzle-orm` dependency; non-negotiable rule that claims go through `createTurso*Store` |

## Cross-cutting requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Three createTurso\* factories + bundle | **PASS** | `createTursoIdempotencyStore`, `createTursoWebhookInboxStore`, `createTursoReconciliationStore`, `createTursoStores` (+ subpath aliases) |
| UPSERT / single-statement claims | **PASS** | Idempotency `INSERT … ON CONFLICT DO UPDATE … RETURNING`; webhook same pattern; recon conditional `UPDATE … RETURNING` |
| Injectable clock / FakeClock | **PASS** | `StoreClock` + `createSystemClock` / `clockNowIso` / `clockAddMsIso`; `resolveStoreContext` injects `options.clock`; conformance + concurrency use `createFakeClock()`; lease reclaim advances FakeClock |
| Explicit migrate only; never on import | **PASS** | `import-no-migrate.test.ts`; factory construction does not execute; only `migrateTursoAdapter` / `verifyTursoAdapterSchema`; dialect `sqlite` via sql-store |
| Independent serverless vs libsql bindings | **PASS** | Separate subpaths + driver modules; duck-typed surfaces; unit tests for both; manifest notes “NOT interchangeable” |
| Docs complete | **PASS** | overview, claims, concurrency, crash-boundaries, drivers, drizzle, embedded-replicas, guarantees, migrations, testing + README + CHANGELOG |
| Phase 0–14 safety net still green | **PASS** | 1499 pass across full suite including prior adapters |
| Boundaries; no illegal deps | **PASS** | `check:boundaries` OK; turso deps only `payments-internal-sql-store` + `payments-testkit`; optional peers for drivers; core/webhooks do not depend on adapter-turso |
| No Phase 16 packages | **PASS** | No `adapter-cloudflare-d1` / `adapter-cloudflare-do` under `packages/` (roadmap only) |
| Monorepo scripts / build | **PASS** | Root scripts wire adapter-turso into build/test/typecheck; dist has `index`, `serverless`, `libsql` |

## Anti-bug matrix (logical risks)

| Risk | Verdict | Evidence |
| --- | --- | --- |
| get/set claim race | **PASS** | Single-statement UPSERT/RETURNING claim SQL; post-empty SELECT is classify-only; concurrent claim tests require exactly one `acquired` |
| root importing drivers | **PASS** | `src/index.ts` zero static driver imports; `public-api.test.ts` walks production graph; `dist/index.js` only imports sql-store + testkit |
| secrets/auth tokens in errors | **PASS** | `mapDriverError` sanitizes authToken, Bearer, turso/libsql URLs, env token names; `errors.test.ts` asserts redaction |
| FakeClock ignored | **PASS** | Lease predicates bind `clockNowIso(ctx.clock)`; concurrency FakeClock reclaim with generation++ |
| auto-migrate | **PASS** | import-no-migrate + factories do not call migrate |
| conflating local sqlite with turso | **PASS** | Manifest + docs: “Not the same as packages/store-sqlite”; multi-host remote vs single-host local |
| untested sync advertised | **PASS** | A3 evidence; no `./sync` export |
| treating serverless and libsql as identical | **PASS** | Independent bindings + docs + manifest note |
| secrets unbounded in store error columns | **PASS** | `enforceMaxSanitizedError` on fail paths (sql-store helper) |

## Dist / export isolation (independent scan)

```text
package.json exports → ".", "./serverless", "./libsql"  (no "./sync")
dist/index.js        → @paykernel/internal-sql-store, @paykernel/testkit only
                       (no static import of @tursodatabase/* or @libsql/*)
drivers              → duck-typed client surfaces; optional peers loaded by consumer
src root graph       → public-api walk excludes drivers/, serverless.ts, libsql.ts subpath entries
```

## Independent re-run evidence

Commands executed by this gate (not claimed by implementer alone):

```bash
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso
# → 1499 pass, 15 skip, 0 fail (133.11s)

bun test packages/store-turso
# → 61 pass, 0 fail (793ms)

bun run typecheck
# → all workspace packages exit 0

bun run check:boundaries
# → workspace boundaries OK

bun run check:runtime-portability
# → runtime portability OK (Deno smoke SKIP: binary not found)

bash scripts/validate-package.sh
# → package validation OK

bun test --coverage packages/core
# → All files: 99.51% funcs, 98.60% lines; 1000 pass
```

### Skip inventory (honest)

| Skip class | Count / note |
| --- | --- |
| Postgres env-gated | present in full suite (no `PAYMENTS_SDK_PG_URL` / `DATABASE_URL` for some live paths) |
| Redis live env-gated | multi-connection / integration skips without Redis URL |
| Turso live remote | concurrency + serverless + conformance live suites **skip-clean** without `TURSO_` / `LIBSQL_` remote URL (CI still green via libsql memory/file) |
| Deno smoke | binary not installed — static portability scan still required and OK |

## Non-blocking observations

1. **Live Turso Cloud / serverless multi-connection** not exercised in this environment (skip-clean). Claim atomicity is still proven on libsql `:memory:` and `file:` multi-instance harnesses; remote harnesses exist and fail-hard once connected.
2. **Timeout/reconnect** proven primarily via `mapDriverError` unit classification (TIMEOUT → `StoreTimeoutError`; fetch/hrana → `StoreUnavailableError`) plus docs — not a multi-hour live reconnect soak.
3. **Serverless live conformance** is env-gated; unit tests cover serverless executor mapping independently of libsql.

None of the above are acceptance-criteria failures under the roadmap’s skip-clean live pattern used in Phases 12–14.

## Checklist

- [x] A1 shared durable multi-host inbox/reconciliation
- [x] A2 libSQL subpath + factories
- [x] A3 no untested sync/embedded-replica advertising
- [x] 15.1 serverless binding
- [x] 15.2 libsql binding (tx/batch, remote+file, replica honesty)
- [x] 15.3 concurrency matrix
- [x] 15.4 drizzle honesty (docs-only)
- [x] Injectable clock
- [x] Explicit migrate only
- [x] Phase 0–14 safety net green
- [x] Boundaries + no illegal deps
- [x] No Phase 16 packages
- [x] Anti-bug matrix clear
- [x] Independent test/typecheck/boundaries/portability/validate re-run

## Final verdict

**PASS** — Phase 15 complete. Zero blocking findings.
