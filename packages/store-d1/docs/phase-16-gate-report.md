# Phase 16 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Package:** `@paykernel/store-d1` (`packages/store-d1`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Verdict summary

Phase 16 **Cloudflare D1 multi-host Workers** adapter is **complete and green**. Independent adversarial re-verification (no trust of implementer claims without code/test/docs evidence) confirms:

| Area | Result |
| --- | --- |
| Full safety net + adapters | **1556 pass, 15 skip, 0 fail** (`core` + `testkit` + `webhooks` + `sql-store` + `adapter-postgres` + `adapter-redis` + `adapter-sqlite` + `adapter-turso` + `adapter-cloudflare-d1`) |
| Adapter-cloudflare-d1 focused | **58 pass, 0 fail** (public API, import-no-migrate, errors, stores unit, migrate, conformance, batch, concurrency, sessions, restart, prepared-bind) |
| typecheck (all workspace packages) | exit 0 |
| `check:boundaries` | OK |
| `check:runtime-portability` | OK (Deno binary smoke skipped — static node: scan required and passed) |
| `validate:package` | OK (build, dist, portability, publint, attw, consumer smoke) |
| Full monorepo `build` | exit 0 (includes adapter-cloudflare-d1 `dist/index.js` + `.d.ts`) |
| Core coverage | **99.51% funcs / 98.60% lines** (`bun test --coverage packages/core`; 1000 pass) |
| Manifest | `coordinationScope: "multi-host"`, `durability: "durable"`, `claims: "strong"`, `readAfterWrite: "session"`, `staleReadsPossible: true`, honesty notes present |
| Phase 17 package | **absent** (no `adapter-cloudflare-do`) |
| Blocking issues | **0** |

## Acceptance criteria

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Safe for distributed Worker deployments | **PASS** | Package `@paykernel/store-d1`; `D1_STORAGE_ADAPTER_MANIFEST` multi-host durable strong claims + session RAW honesty; `createD1PaymentStores({ db })` + three Phase-9 factories; single-statement UPSERT/UPDATE RETURNING claims; `batch()` multi-statement with rollback tests; concurrency multi-instance + parallel reserve; restart/lease reclaim with FakeClock; docs: overview, guarantees, claims, crash-boundaries, limits, sessions-and-replication |
| **A2** | No local SQLite driver assumptions leak into D1 implementation | **PASS** | Production `src/**` (excluding `test-utils/`) has **zero** imports of `bun:sqlite` / `better-sqlite3` / `node:sqlite` / `cloudflare:workers` / `@libsql/*`; `public-api.test.ts` walks production graph; `dist/index.js` only depends on `payments-internal-sql-store` + `payments-testkit`; async `prepare`/`bind`/`batch` executor; claims are single-statement UPSERT not sync `BEGIN IMMEDIATE` claim locks; docs contrast with `adapter-sqlite`; mock D1 uses bun:sqlite **test-only** |
| **A3** | D1-specific guarantees and limits documented | **PASS** | `docs/guarantees.md`, `limits.md`, `sessions-and-replication.md`, `binding.md`, `wrangler.md`, `migrations.md`, `numeric-portability.md`, `claims.md`, `crash-boundaries.md`, `testing.md`, `overview.md` + README/CHANGELOG; honest multi-host manifest notes; batch limits; read-replication caveats; Wrangler binding examples; Binding API pin **2026-08-03** |

## Deliverables 16.1–16.6

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **16.1** | Accept D1 binding `createD1PaymentStores({ db })` — no REST required | **PASS** | `src/d1-binding.ts` primary API; structural `D1DatabaseLike` (`prepare`/`bind`/`batch`); no REST/account token for normal operation; `prepared-bind.d1.test.ts` + `public-api.test.ts`; `paymentsSdk.runtime: "cloudflare-only"` |
| **16.2** | Prepared statements; single-statement claims preferred; batch multi-statement; sessions | **PASS** | `createD1Executor` prepare+bind+all/run; stores use UPSERT/UPDATE RETURNING; `executor.batch` → `db.batch`; sessions helpers (`withD1Session`, `first-primary`, `createSessionScopedExecutor`, `session` option on factory); `batch.d1.test.ts` + `sessions.d1.test.ts` |
| **16.3** | D1-compatible migrations without unsupported txn wrappers; Wrangler examples | **PASS** | `migrateD1Adapter` / `verifyD1AdapterSchema` (dialect `sqlite`); `migrations/0001_foundation.sql` has **no** BEGIN/COMMIT (asserted in `migrate.d1.test.ts`); `examples/wrangler.toml` + `docs/wrangler.md` / `migrations.md` |
| **16.4** | Numeric portability (TEXT IDs/tokens/hashes/money-like) | **PASS** | Foundation DDL TEXT for keys/tokens/hashes/timestamps; INTEGER only for counters; `newLeaseToken()` opaque TEXT; `docs/numeric-portability.md`; migrate packaging notes |
| **16.5** | Claims are primary writes; post-write reads use session strategy when replication enabled | **PASS** | Claims are conditional writes; manifest `readAfterWrite: "session"`, `staleReadsPossible: true`; `docs/sessions-and-replication.md`; factory `session` option; session-scoped executor helpers + tests |
| **16.6** | Tests: concurrent deliveries, atomic claims, batch rollback, sessions, migrations, restarts | **PASS** | `concurrency.d1.test.ts`, `conformance.d1.test.ts` (all three suites), `batch.d1.test.ts`, `sessions.d1.test.ts`, `migrate.d1.test.ts`, `restart.d1.test.ts`, plus public-api / import-no-migrate / errors / prepared-bind / stores unit — **58 pass** on mock D1 |

## Cross-cutting requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Injectable clock / FakeClock | **PASS** | `StoreClock` + `createSystemClock` / `clockNowIso` / `clockAddMsIso`; `resolveStoreContext` injects `options.clock`; conformance + concurrency + restart use `createFakeClock()`; lease reclaim advances FakeClock |
| Explicit migrate only; never on import | **PASS** | `import-no-migrate.test.ts`; factories do not execute SQL; only `migrateD1Adapter` / `verifyD1AdapterSchema` |
| Phase 0–15 safety net still green | **PASS** | 1556 pass across full suite including prior adapters + D1 |
| Boundaries; no illegal reverse deps | **PASS** | `check:boundaries` OK; D1 deps only `payments-internal-sql-store` + `payments-testkit`; optional peer `@cloudflare/workers-types`; core/webhooks/testkit/other adapters do **not** depend on adapter-cloudflare-d1 |
| No Phase 17 `adapter-cloudflare-do` package | **PASS** | No `packages/store-durable-objects` (roadmap only) |
| Monorepo scripts / build / dist | **PASS** | Root build/test/typecheck/test:adapter-cloudflare-d1 wire D1; `dist/index.js` + `index.d.ts` present after build |
| Docs complete | **PASS** | Full docs set listed under A3 + README + CHANGELOG |

## Anti-bug matrix (logical risks)

| Risk | Verdict | Evidence |
| --- | --- | --- |
| get/set claim race | **PASS** | Single-statement UPSERT/UPDATE RETURNING claim SQL; post-empty SELECT is classify-only; concurrent claim tests require exactly one `acquired` |
| local sqlite APIs leaked into prod path | **PASS** | No production imports of bun/better/node sqlite; mock isolated under `test-utils/`; root graph walk test |
| secrets in errors | **PASS** | `mapDriverError` sanitizes apiToken/Bearer/CF tokens/account IDs/cloudflare URLs; `errors.test.ts` asserts redaction |
| FakeClock ignored | **PASS** | Lease predicates bind `clockNowIso(ctx.clock)`; concurrency FakeClock reclaim with generation++ |
| auto-migrate | **PASS** | import-no-migrate + factories do not call migrate |
| BEGIN/COMMIT in D1 migration packaging | **PASS** | `migrations/0001_foundation.sql` + migrate packaging test forbids BEGIN/COMMIT; sql-store foundation SQL has no BEGIN/COMMIT |
| REST required for Workers path | **PASS** | Binding-only factories; manifest + docs: no REST for normal operation; live REST path skip-clean only |
| conflating D1 with turso/sqlite/DO | **PASS** | Manifest + docs: not adapter-sqlite, not adapter-turso, not Durable Objects |
| JS number precision for IDs | **PASS** | TEXT storage + opaque lease tokens; numeric-portability docs |
| reverse deps into portable packages | **PASS** | No core/webhooks/testkit dependency on adapter-cloudflare-d1 |

## Dist / surface isolation (independent scan)

```text
package.json exports → "." only
paymentsSdk           → portable:false, runtime:"cloudflare-only"
dist/index.js         → @paykernel/internal-sql-store, @paykernel/testkit only
                       (no static import of bun:sqlite / better-sqlite3 / cloudflare:workers / libsql)
src production graph  → public-api walk excludes test-utils/ and *.test.ts
mock D1               → src/test-utils/mock-d1.ts only (test-only bun:sqlite)
```

## Independent re-run evidence

Commands executed by this gate (not claimed by implementer alone):

```bash
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite \
  packages/store-turso packages/store-d1
# → 1556 pass, 15 skip, 0 fail (193.58s)

bun test packages/store-d1
# → 58 pass, 0 fail (368ms)

bun run typecheck
# → all workspace packages exit 0

bun run check:boundaries
# → workspace boundaries OK

bun run check:runtime-portability
# → runtime portability OK (Deno smoke SKIP: binary not found)

bun run build
# → all packages including adapter-cloudflare-d1 exit 0

bash scripts/validate-package.sh
# → package validation OK

bun test --coverage packages/core
# → All files: 99.51% funcs, 98.60% lines; 1000 pass
```

### Skip inventory (honest)

| Skip class | Count / note |
| --- | --- |
| Postgres env-gated | present in full suite without `PAYMENTS_SDK_PG_URL` / `DATABASE_URL` for some live paths |
| Redis live env-gated | multi-connection / integration skips without Redis URL |
| Turso live remote | skip-clean without remote Turso/libSQL env |
| D1 live binding | conformance live REST/binding skip-clean without `PAYMENTS_SDK_D1_BINDING_AVAILABLE` / Cloudflare env — **CI green via mock D1** |
| Deno smoke | binary not installed — static portability scan still required and OK |

## Non-blocking observations

1. **Live Workers / miniflare:** Conformance and concurrency run on mock D1 (`bun:sqlite` fidelity layer). Live binding path is skip-clean when env unset. Harnesses and docs recommend verifying RETURNING/session behavior on target D1 version; not a gate blocker given Phase 15 precedent (libsql memory/file).
2. **Optional interactive `transaction` on executor:** Implemented with `BEGIN IMMEDIATE` for mock/same-connection and store `withTransaction` convenience. Documented that live D1 prefers single-statement UPSERT or `batch()` — claims do **not** depend on interactive BEGIN for correctness.
3. **Deno smoke:** Skipped when binary absent; static `node:` portability scan still required and OK.

## Final verdict

**PASS** — Phase 16 complete. Zero blocking findings. No fixes required. Not committed by this gate.
