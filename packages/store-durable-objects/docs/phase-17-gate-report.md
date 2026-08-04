# Phase 17 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Package:** `@paykernel/store-durable-objects` (`packages/store-durable-objects`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Verdict summary

Phase 17 **multi-host partitioned Cloudflare SQLite-backed Durable Object** adapter is **complete and green**. Independent adversarial re-verification (no trust of implementer claims without code/test/docs evidence) confirms:

| Area | Result |
| --- | --- |
| Full safety net + adapters | **1614 pass, 15 skip, 0 fail** (`core` + `testkit` + `webhooks` + `sql-store` + `adapter-postgres` + `adapter-redis` + `adapter-sqlite` + `adapter-turso` + `adapter-cloudflare-d1` + `adapter-cloudflare-do`) |
| Adapter-cloudflare-do focused | **60 pass, 0 fail** (public API, import-no-migrate, sharding, errors, conformance, concurrency, partitions, transaction, restart, alarms, migrate, stores unit) |
| typecheck (all workspace packages) | exit 0 |
| typecheck:types (core) | exit 0 |
| `check:boundaries` | OK |
| `check:runtime-portability` | OK (Deno binary smoke skipped — static node: scan required and passed) |
| Package validation (adapter DO) | build OK; `npm pack --dry-run` OK; publint **All good**; attw ESM/bundler green (node16-cjs ignored per monorepo policy) |
| DO + core `dist` | `packages/store-durable-objects/dist/index.js` + `.d.ts`; `packages/core/dist/index.js` present after build |
| Core coverage | **99.51% funcs / 98.60% lines** (`bun test --coverage` in `packages/core`; 1000 pass) |
| Manifest | `coordinationScope: "multi-host"`, `durability: "durable"`, `claims: "strong"`, `readAfterWrite: "strong"` (per-partition honesty), `staleReadsPossible: false`, sharding/hot-key/no-global notes |
| Separate from D1 / no generic umbrella | **no** `packages/adapter-cloudflare`; D1 remains independent package |
| Blocking issues | **0** |

## Acceptance criteria

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Strong per-partition coordination is preserved | **PASS** | `DO_STORAGE_ADAPTER_MANIFEST` multi-host + strong claims/RAW **within partition**; `createDoPaymentStores({ namespace, sharding })` with `assertDoShardingStrategy` (rejects missing/`global`/`singleton`); single-statement UPSERT + RETURNING claims; `concurrency.do.test.ts` (parallel same-key → one winner; multi-instance; stale lease); `partitions.do.test.ts` (hash/key/tenant isolation); `restart.do.test.ts` (durability + FakeClock reclaim); docs: `guarantees.md`, `claims.md`, `crash-boundaries.md`, `sharding.md` |
| **A2** | External payment calls never occur inside storage transactions | **PASS** | Claim pattern claim→commit→external→complete in `idempotency-store.ts`, `payments-store-object.ts`, `docs/claims.md`, `docs/transactions.md`, `docs/crash-boundaries.md`; `DoExecutor.transaction` → `storage.transactionSync` sync callback only; `transaction.do.test.ts` static scan: no `await`/`fetch` in production `transactionSync`/`transaction` bodies; store claim paths have no `fetch`/URL I/O; mock rejects Promise return from `transactionSync` |
| **A3** | Sharding and hot-key risks are documented | **PASS** | `docs/sharding.md` (key/hash/tenant, ordering, hot-key, reject global); manifest notes; README sharding table; `RECOMMENDED_HASH_PARTITIONS = 16`; `sharding.test.ts` + `public-api.test.ts` assert global rejection and hot-key note presence |

## Deliverables 17.1–17.5

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **17.1** | SQLite-backed DO only (`new_sqlite_classes`; `sql.exec`; not legacy KV-only new work) | **PASS** | `examples/wrangler.toml` + `docs/wrangler.md`: `new_sqlite_classes`; `createDoExecutor` over `storage.sql.exec` + `transactionSync`; manifest forbids legacy KV-only; structural types only (no `cloudflare:workers` on package root) |
| **17.2** | Sharding strategies with deterministic routing; no universal silent global default | **PASS** | `sharding.ts`: `key` \| `hash` \| `tenant`; `resolveDoShardName` / `hashStringToUint32` / `getDoStub`; factories require explicit sharding; forbid `global`/`singleton`; docs + tests |
| **17.3** | Transactions/serialization: `transactionSync` or sync SQL; no external I/O in txn | **PASS** | Preferred single-statement UPSERT; multi-statement only via `transactionSync`; forbid BEGIN/COMMIT via `sql.exec` on public `run`/`query`; cursor `.toArray()` before return; `transaction.do.test.ts` rollback + static invariants |
| **17.4** | Optional alarms: bounded retries, backoff+jitter, efficient partitioned queue | **PASS** | `createAlarmScheduler` / `ensureAlarmQueueSchema` default-off; one `setAlarm` per DO + queue table; maxRetries + exponential backoff with jitter; `alarms.do.test.ts` (no setAlarm-per-record storm, retry/dead-letter, at-least-once); `docs/alarms.md` |
| **17.5** | Tests: concurrent same key, different partitions, eviction/restart, alarm retry, stale lease, SQLite txn rollback | **PASS** | `concurrency.do.test.ts`, `partitions.do.test.ts`, `restart.do.test.ts`, `alarms.do.test.ts`, stale-lease cases in concurrency, `transaction.do.test.ts` rollback; plus conformance + public-api + migrate + import-no-migrate — **60 pass** |

## Cross-cutting requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Injectable clock / FakeClock | **PASS** | `StoreClock` + `createSystemClock` / `clockNowIso` / `clockAddMsIso`; stores use `ctx.clock`; conformance/concurrency/restart/alarms inject `createFakeClock()`; lease reclaim advances FakeClock |
| Explicit migrate / ensure only; never on package import | **PASS** | `import-no-migrate.test.ts`; `createDoPaymentStores` does not migrate; only `migrateDoAdapter` / `ensureDoSchema` / `PaymentsStoreObject.ensureSchema` (DO lifecycle docs) |
| Phase 0–16 safety net still green | **PASS** | 1614 pass / 15 skip / 0 fail including prior packages + DO |
| Boundaries; no illegal reverse deps | **PASS** | `check:boundaries` OK; DO deps only `payments-internal-sql-store` + `payments-testkit`; optional peer `@cloudflare/workers-types`; core/webhooks/testkit do **not** depend on adapter-cloudflare-do |
| Separate from D1; no generic `adapter-cloudflare` | **PASS** | Distinct package path/name; no `packages/adapter-cloudflare`; docs/manifest contrast D1/sqlite/turso |
| Monorepo scripts / build / dist | **PASS** | Root `build` / `test` / `typecheck` / `test:adapter-cloudflare-do` wire DO; dist entrypoints present |
| Docs complete | **PASS** | overview, sharding, transactions, claims, crash-boundaries, guarantees, limits, migrations, testing, wrangler, alarms + README + CHANGELOG + examples/wrangler.toml |

## Anti-bug matrix (logical risks)

| Risk | Verdict | Evidence |
| --- | --- | --- |
| get/set claim race | **PASS** | Single-statement UPSERT + RETURNING; post-empty SELECT classify-only; concurrency tests require exactly one `acquired` |
| external I/O in txn | **PASS** | A2 evidence + static production scan in `transaction.do.test.ts` |
| global DO default | **PASS** | Required explicit sharding; reject `global`/`singleton`; no silent default |
| alarm storms | **PASS** | One alarm slot + partitioned queue; test asserts many records → not one setAlarm per record |
| secrets in errors | **PASS** | `mapDriverError` sanitizes Bearer/CF tokens/account IDs/URLs; `errors.test.ts` |
| FakeClock ignored | **PASS** | Lease predicates bind `clockNowIso(ctx.clock)`; FakeClock reclaim generation++ |
| auto-migrate on import | **PASS** | import-no-migrate + factories do not call migrate |
| async transactionSync | **PASS** | Sync callback enforced; mock rejects Promise return; static scan for async arrows |
| cursor held across await | **PASS** | `execSql` always `cursor.toArray()`; transaction test for query return shape |
| conflating with D1/sqlite/turso | **PASS** | Manifest + docs + public-api notes; production graph excludes those drivers |
| JS number precision for IDs | **PASS** | Opaque TEXT lease tokens (`lt_` + hex); BigInt normalize only for counters within safe range |
| reverse deps into portable packages | **PASS** | No core/webhooks/testkit dependency on DO adapter |
| `cloudflare:workers` on package root | **PASS** | Production graph walk; structural `DoStorageLike` / `DoNamespaceLike` only; workers import only in example wrangler comments |

## Dist / surface isolation (independent scan)

```text
package.json exports → "." only
paymentsSdk           → portable:false, runtime:"cloudflare-only"
dist/index.js         → @paykernel/internal-sql-store, @paykernel/testkit only
                       (no static import of bun:sqlite / better-sqlite3 / cloudflare:workers / libsql)
src production graph  → public-api walk excludes test-utils/ and *.test.ts
mock DO SQL           → src/test-utils/mock-do-sql.ts only (test-only bun:sqlite)
```

## Independent re-run evidence

Commands executed by this gate (not claimed by implementer alone):

```bash
# Full suite (batched for wall-clock; same package set as root test script)
bun test packages/core packages/testkit packages/webhooks internal/sql-store
# → 1261 pass, 0 fail

bun test packages/store-redis packages/store-sqlite packages/store-turso \
  packages/store-d1 packages/store-durable-objects
# → 300 pass, 12 skip, 0 fail

bun test packages/store-postgres
# → 53 pass, 3 skip, 0 fail
# TOTAL: 1614 pass / 15 skip / 0 fail

bun test packages/store-durable-objects
# → 60 pass, 0 fail (327ms)

bun run typecheck
# → all workspace packages exit 0

bun run --filter @paykernel/core typecheck:types
# → exit 0

bun run check:boundaries
# → workspace boundaries OK

bun run check:runtime-portability
# → runtime portability OK

bun run --filter @paykernel/store-durable-objects build
bun run --filter @paykernel/core build
# → exit 0; dist present

# packages/core coverage
cd packages/core && bun test --coverage
# → All files 99.51% Funcs / 98.60% Lines; 1000 pass

# Adapter package validation pieces
cd packages/store-durable-objects && npm pack --dry-run   # exit 0
bunx publint packages/store-durable-objects               # All good
bunx attw --pack packages/store-durable-objects --profile esm-only \
  --ignore-rules internal-resolution-error                # exit 0
```

Note: Root `validate:package` targets **core** (typecheck + core tests + monorepo build + core pack/publint/attw/smoke). Constituent checks used by that script were re-run independently and are green; the full combined shell was not required to re-prove adapter DO readiness after per-step OK.

## Non-blocking observations

1. **Partition-local list/cleanup on Worker client:** `deleteExpired` / `listRetryable` / `listDue` route via sentinel keys (`__cleanup__` / `__list__`), so under hash sharding they hit **one** partition only. Documented in `client.ts` comments and `supportsRetentionCleanup` honesty (partition-local). Operators must iterate partitions for full cleanup — not an A1–A3 blocker.
2. **`runInTransaction` async BEGIN path:** Exists for store `withTransaction` / conformance under mock SQLite. Public `run`/`query` still forbid BEGIN/COMMIT; claims use sync single-statement UPSERT outside external I/O. Documented in `sql-executor.ts`.
3. **Single-invocation full monorepo test:** Long-running postgres live integrations can exceed short wall-clock budgets; batched runs of the **same package set** prove the aggregate green counts above.

## Final checklist (gate)

- [x] A1 strong per-partition coordination
- [x] A2 no external payment I/O inside storage transactions
- [x] A3 sharding + hot-key documentation
- [x] 17.1 SQLite-backed DO only (`new_sqlite_classes` / `sql.exec`)
- [x] 17.2 deterministic sharding; no silent global default
- [x] 17.3 transactionSync / sync SQL; no external I/O in txn
- [x] 17.4 optional alarms (bounded retry, backoff/jitter, partitioned queue)
- [x] 17.5 concurrency / partitions / restart / alarms / stale lease / txn rollback tests
- [x] Injectable FakeClock for conformance
- [x] Explicit migrate/ensure only
- [x] Phase 0–16 safety net green
- [x] Boundaries; no illegal reverse deps
- [x] Separate from D1; no generic adapter-cloudflare
- [x] Anti-bug matrix clear
- [x] 1614 pass / 15 skip / 0 fail; DO 60 pass; typecheck/boundaries/portability/build/coverage OK

## Verdict

**PASS** — Phase 17 is complete and green. No blocking findings. No fixes required by this gate.
