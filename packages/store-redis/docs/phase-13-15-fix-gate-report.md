# Phase 13–15 fix-gate report

**Date (UTC):** 2026-08-14  
**Packages:** `@paykernel/store-redis@0.1.0-next.0`, `@paykernel/store-sqlite@0.1.0-next.0`, `@paykernel/store-turso@0.1.0-next.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-13-15-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`4cebf24`); not a release commit.

**Verdict:** **PASS** (listed P1315 blockers closed; typecheck + targeted tests green)

Historical Phase 13 / 14 / 15 gates (`packages/store-redis/docs/phase-13-gate-report.md`, `packages/store-sqlite/docs/phase-14-gate-report.md`, `packages/store-turso/docs/phase-15-gate-report.md`) had already landed the Redis, local SQLite, and Turso adapters. The holes below were still present on `4cebf24`: recon attempt burn on reclaim, Cluster-unaware SCAN recovery, Lua fingerprint-before-terminal classify, terminal `EXPIRE`, lexical `deleteExpired`, sqlite unbounded result JSON + bun bigint `changes`, sqlite `sqlSchema` quoted as if CREATE SCHEMA existed, libsql concurrent tx join + missing-protocol BEGIN, replica clients accepted as multi-host, and skip-clean tests that returned without `expect`.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation of the workflow IDs against committed `HEAD` (`4cebf24`).

| ID | Status at `HEAD` | Evidence |
| --- | --- | --- |
| **P1315-REDIS-1** | **STILL PRESENT** | `RECON_CLAIM_LUA` always `attempts + 1`, including expired `claimed` reclaim (`packages/store-redis/src/scripts/reconciliation.lua.ts` L144). `RECON_GET_LUA` soft-release `HSET` did not decrement `attempts` (same file, GET path). SQL / webhook keep-on-reclaim + restore-on-soft-release. |
| **P1315-REDIS-2** | **STILL PRESENT** | Claim Lua `ZREM`ed the due/retry ZSET. `listDue` / `listRetryable` recovery used cluster-unaware `SCAN` then GET (`packages/store-redis/src/stores/shared.ts` `softReleaseExpiredClaimedViaScan`). ioredis/node-redis Cluster SCAN is per-node; abandoned HASH on other masters never re-indexed. |
| **P1315-TURSO-1** | **STILL PRESENT** | `packages/store-turso/src/drivers/libsql.ts` process-global `txDepth` / `activeQueryable`. `if (txDepth > 0)` joined the first interactive stream. Store ALS cannot prevent the join. Comment: “Nested transactions join the outer scope.” |
| **P1315-REDIS-3** | **STILL PRESENT** | `WEBHOOK_FAIL_LUA` dead_letter, `RECON_FAIL_LUA` terminal failed, and `RECON_MARK_MANUAL_REVIEW_LUA` called `redis.call('EXPIRE', rec, retentionTtlSec)` when `retentionTtlMs` was set. After TTL `EXISTS==0`, next webhook claim is `acquired` not `duplicate_failed`. Completed paths already `PERSIST` (REDIS-1). |
| **P1315-REDIS-4** | **STILL PRESENT** | `IDEMPOTENCY_RESERVE_LUA` compared `fp ~= fingerprint` **before** `status == 'completed'` / `indeterminate` (`packages/store-redis/src/scripts/idempotency.lua.ts` L73 then L78). Contract + `classifyIdempotencyReserveMiss` require terminals first. |
| **P1315-REDIS-5** | **STILL PRESENT** | `deleteIfExpired` Lua compared `updated_at > beforeIso` lexically; stores bound raw `input.before`. Offset-form `before` vs stored `Z` could delete live fences. ARGV was `beforeIso` only (no `beforeMs`). |
| **P1315-SQLITE-1** | **STILL PRESENT** | `packages/store-sqlite/src/stores/shared.ts` `serializeResultJson` was `return JSON.stringify(result)` — no `MAX_RESULT_JSON_BYTES` fail-closed (STORES-3). Postgres / D1 / Turso / Redis throw `StoreSerializationFailureError`. |
| **P1315-SQLITE-2** | **STILL PRESENT** | `packages/store-sqlite/src/drivers/bun.ts` `typeof result?.changes === "number" ? result.changes : 0`. Bun `safeIntegers` bigint `changes` became `0` → false miss / `lease_lost` after commit. Node / better-sqlite3 already `normalizeChanges`. |
| **P1315-TURSO-2** | **STILL PRESENT** | `preferInteractiveTransaction` true only when `protocol` was `http` / `ws` / `wss`. Missing protocol on a remote duck-typed client used sequential `BEGIN IMMEDIATE` via `client.execute` (not one HTTP txn). |
| **P1315-TURSO-3** | **STILL PRESENT** | `createExecutorFromLibsql` accepted `file` + `syncUrl` / replica-like clients under `TURSO_STORAGE_ADAPTER_MANIFEST` `coordinationScope: "multi-host"` and `staleReadsPossible: false`. |
| **P1315-REDIS-6** | **STILL PRESENT** | `docs/scripts-atomicity.md` / `crash-boundaries.md` said `WEBHOOK_FAIL_LUA` required an unexpired lease. Code already accepted matching token after expiry (WEBHOOKS-2). |
| **P1315-SQLITE-3** | **STILL PRESENT** | `createSchemaNamespace` accepted `sqlSchema` and emitted quoted `schema.table`. SQLite has no `CREATE SCHEMA`. Factories / migrate did not reject it. |
| **P1315-TEST-1** | **STILL PRESENT** | Turso `conformance.turso.test.ts` / `concurrency.turso.test.ts` `if (!opened) return` (pass with zero assertions). Sqlite node / better-sqlite3 conformance `return` on unavailable driver (same silent pass). |

### Already fixed before this gate

- `classifyIdempotencyReserveMiss` order in `@paykernel/sql-foundation` (Phase 11–12). Redis Lua still inverted.
- `WEBHOOK_FAIL_LUA` already WEBHOOKS-2 in code; docs lagged (`P1315-REDIS-6`).
- `WEBHOOK_GET_LUA` already restores one attempt on expired-claim soft-release.
- Idempotency / webhook / recon **complete** already `PERSIST` (REDIS-1 / STORES-5).
- Redis `serializeResultJson` already fail-closed at `MAX_RESULT_JSON_BYTES`.
- Node / better-sqlite3 drivers already `normalizeChanges`.
- Sqlite `public-api.test.ts` already rejected **invalid** `sqlSchema` injection; it did not reject a valid schema name.

**Critic summary:** 13 IDs still present at `HEAD`. REDIS-6 was a docs lie. SQLITE-3 / TURSO-3 / TEST-1 were honesty / fail-closed gaps. The rest were implementation holes in attempts, Cluster recovery, Lua classify, terminal TTL, lexical delete, sqlite serialize/changes, and libsql tx join.

---

## Four fix streams

Non-overlapping edits on the uncommitted tree (35 files, +1140 / −317 vs `HEAD`).

### Stream A — Redis logic (`P1315-REDIS-1/2/3/4/5`)

Files only under `packages/store-redis/src/` (scripts, stores, clock helpers, tests). Did **not** edit sqlite/turso.

| File | Change |
| --- | --- |
| `src/scripts/reconciliation.lua.ts` | `RECON_CLAIM_LUA` increments `attempts` only when `status == 'scheduled'`; expired `claimed` reclaim keeps `attempts`. Claim `ZADD`s due index at `leaseExpiresMs` (not `ZREM`). `RECON_GET_LUA` decrements `attempts` (floor 0) on expired-claim soft-release. Terminal fail / `markManualReview` `PERSIST` (no `EXPIRE`). `RECON_DELETE_IF_EXPIRED_LUA` prefers numeric `updated_ms` vs `beforeMs`. |
| `src/scripts/webhook-inbox.lua.ts` | Claim `ZADD`s retry index at `leaseExpiresMs`. Dead-letter fail `PERSIST`. Delete Lua takes canonical `beforeIso` + `beforeMs`. |
| `src/scripts/idempotency.lua.ts` | Reserve classifies `completed` → `indeterminate` → `fingerprint_conflict`. Delete Lua canonical `beforeIso` / `beforeMs`. |
| `src/scripts/registry.test.ts` | STORES-5: webhook/recon complete, fail, `markManualReview` have no `redis.call EXPIRE` and do `PERSIST`. P1315-REDIS-1/2/4 source-contract tests. |
| `src/stores/shared.ts` | `canonicalizeIsoZ` via `msFromIso` + `Date#toISOString` (fail-closed). SCAN helper comment: extra / standalone-only; not the only recovery path. `retentionTtlSec` still computed for API parity; terminal scripts ignore `EXPIRE`. |
| `src/stores/idempotency-store.ts` | `deleteExpired` binds `canonicalizeIsoZ(input.before)` + `beforeMs`. |
| `src/stores/webhook-inbox-store.ts` | Same `before` canonicalize. `listRetryable` comment: claim ZADD + SCAN extra. |
| `src/stores/reconciliation-store.ts` | Same. `listDue` rediscovers via `ZRANGEBYSCORE` when SCAN is empty. |
| `src/types.ts` | `retentionTtlMs` JSDoc: terminal fences never EXPIRE; cleanup via `deleteExpired`. |
| `src/stores/stores.mock.test.ts` | P1315-REDIS-1 reclaim/soft-release nets; REDIS-2 ZRANGEBYSCORE + claim ARGV `leaseExpiresMs`; REDIS-3 fail/mark still invoke scripts with retention; REDIS-4 completed/indeterminate before fingerprint; REDIS-5 offset `before` does not delete later `Z` `updated_at`, invalid `before` fail-closed. |
| `src/integration.redis.test.ts` | Live abandoned-claim re-index comment: claim ZADDs retry/due at `lease_expires_ms`. |

Stream A did **not** delete the public `retentionIndexKey` export (`src/keys.ts` / `src/index.ts`).

### Stream B — SQLite (`P1315-SQLITE-1/2/3`)

Files only under `packages/store-sqlite/` production + unit tests (conformance skip honesty is Stream D).

| File | Change |
| --- | --- |
| `src/stores/shared.ts` | `serializeResultJson` throws `StoreSerializationFailureError` when JSON exceeds `MAX_RESULT_JSON_BYTES` from `@paykernel/sql-foundation`. `assertNoSqliteSqlSchema` → `StoreInvalidSchemaError`. `resolveStoreContext` rejects `namespace.sqlSchema`. |
| `src/stores/stores.unit.test.ts` | Oversized result rejected. `createSqlite*Store` / `resolveStoreContext` / `migrateSqliteAdapter` reject `sqlSchema`. |
| `src/drivers/bun.ts` | `normalizeChanges` (bigint safe `Number`, same idea as node / better-sqlite3). `run()` uses it. |
| `src/drivers/drivers.unit.test.ts` | `changes: 1n` → `1` via mock `stmt.run`. |
| `src/migrate.ts` | `migrateSqliteAdapter` calls `assertNoSqliteSqlSchema`. |
| `src/types.ts` | `SqliteStoreOptions.namespace` JSDoc: `sqlSchema` is rejected. |

Stream B did **not** edit store-redis or store-turso.

### Stream C — Turso driver (`P1315-TURSO-1/2/3`, turso half of `P1315-TEST-1`)

Files only under `packages/store-turso/src/drivers/` plus existing driver / concurrency / conformance tests. Did **not** rewrite claim SQL.

| File | Change |
| --- | --- |
| `src/drivers/libsql.ts` | Concurrent `executor.transaction` when `txDepth > 0` throws `StoreUnsupportedFeatureError` (do not join). `preferInteractiveTransaction`: `transaction()` exists **and** protocol is not local `file` / `:memory:` — missing protocol uses interactive write. `assertNotEmbeddedReplica`: refuse `syncUrl` / replica-like fields unless `allowEmbeddedReplica: true` (default false). |
| `src/drivers/drivers.unit.test.ts` | Overlapping `transaction()` does not share a stream (second throws). Missing protocol + `transaction()` → interactive, no `BEGIN IMMEDIATE`. File + `syncUrl` / client `syncUrl` refused. |
| `src/concurrency.turso.test.ts` | `@libsql/client` installed-but-unopenable throws. Suites use `describe.skipIf(!libsql.ok)` / `describe.skipIf(!liveRemoteTurso)` — no bare `if (!opened) return`. |
| `src/conformance.turso.test.ts` | Same skip honesty. Live remote still `skipIf(!hasLiveTurso())`. |

Stream C did **not** edit store-redis or store-sqlite.

### Stream D — Docs + sqlite skip-clean honesty (`P1315-REDIS-6`, REDIS-2/3 docs, SQLITE docs, TURSO docs, `P1315-TEST-1` sqlite)

Docs / README / skip-clean tests only. No production Lua/SQL/driver logic.

| File | Change |
| --- | --- |
| `packages/store-redis/docs/scripts-atomicity.md` | Webhook fail accepts matching token after expiry (WEBHOOKS-2); complete still requires unexpired lease; recon fail still requires unexpired lease. Recovery is keyed ZSET (`lease_expires_ms`), not Cluster SCAN. SCAN is optional standalone extra. |
| `packages/store-redis/docs/crash-boundaries.md` | Same WEBHOOKS-2 / recon-fail fence honesty; recovery ZSET vs SCAN. |
| `packages/store-redis/docs/key-design.md` | Terminal `dead_letter` / `failed` / `manual_review` not EXPIRE; recovery ZSET not SCAN. |
| `packages/store-redis/docs/hybrid-examples.md` | Same terminal-TTL / recovery honesty. |
| `packages/store-redis/docs/drivers.md` | Cluster recovery is lease-expiry ZSET, not Cluster SCAN. |
| `packages/store-redis/docs/guarantees.md` | Matching fence / recovery honesty. |
| `packages/store-sqlite/docs/crash-boundaries.md` | Recon / webhook soft-release **restores** (decrements) unfinished attempts — does not preserve. Foundation `@paykernel/sql-foundation`. |
| `packages/store-sqlite/docs/overview.md` | Foundation is `@paykernel/sql-foundation`, not `internal/sql-store`. Manifest type from store-contracts. Single-host only. |
| `packages/store-sqlite/docs/claims.md` | Same foundation / single-host honesty. |
| `packages/store-sqlite/docs/guarantees.md` | Same. |
| `packages/store-sqlite/src/conformance.sqlite.test.ts` | Unavailable node:sqlite / better-sqlite3 use `describe.skip` — never silent `return` that bun reports as a pass. |
| `packages/store-turso/docs/drivers.md` | Remote write tx is `client.transaction("write")`; `BEGIN IMMEDIATE` is local `file:` / `:memory:` only. Embedded replica not multi-host. |
| `packages/store-turso/docs/embedded-replicas.md` | Embedded replica ≠ this adapter’s `multi-host` claim. |
| `packages/store-turso/docs/overview.md` | Remote interactive write vs local BEGIN; replica honesty. |

---

## Verify commands

Run 2026-08-14 from monorepo root after the four streams.

| Command | Result |
| --- | --- |
| `bun run typecheck` | **PASS** — all workspace packages `tsc --noEmit` exit 0 (core, webhooks, reconciliation, opentelemetry, routing, store-contracts, testkit, sql-foundation, internal-sql-store, store-postgres, store-redis, store-sqlite, store-turso, store-d1, store-durable-objects) |
| Targeted `bun test` (below) | **PASS** — **386 pass, 21 skip, 0 fail**, 2641 expects, 42 files |

Targeted test command:

```bash
bun test \
  packages/store-redis \
  packages/store-sqlite \
  packages/store-turso \
  packages/store-contracts \
  packages/sql-foundation
```

21 skips: 16 live Redis without `PAYMENTS_SDK_REDIS_URL` / `REDIS_URL` / `VALKEY_URL` (conformance ×3, multi-connection ×2, integration ×11); 1 better-sqlite3 native ABI (`sqlite conformance (better-sqlite3 skip-clean)`); 4 live Turso without `TURSO_DATABASE_URL` (concurrency live ×2, serverless live ×1, conformance live ×1). Skip pattern is intentional; workflow treats them as OK. node:sqlite conformance **ran and passed** in this environment.

Source invariants re-read after tests:

| Invariant | Evidence |
| --- | --- |
| `RECON_CLAIM_LUA` increments attempts only for `scheduled` | `packages/store-redis/src/scripts/reconciliation.lua.ts` L145–150 |
| `RECON_GET_LUA` restores attempts on expired claimed soft-release | same file L460–472 |
| `IDEMPOTENCY_RESERVE_LUA` completed / indeterminate before fingerprint | `packages/store-redis/src/scripts/idempotency.lua.ts` L73–88 |
| WEBHOOK_FAIL / RECON_FAIL / MARK_MANUAL_REVIEW have no `redis.call EXPIRE` | `webhook-inbox.lua.ts` L338–341; `reconciliation.lua.ts` L353–356, L406–408; `registry.test.ts` L55–73 |
| Claim leaves due/retry ZSET member scored at lease expiry | `reconciliation.lua.ts` L161–164; `webhook-inbox.lua.ts` L68–70, L146–147 |
| `deleteExpired` `before` is canonical Z + numeric ms | `canonicalizeIsoZ` in `shared.ts` L100–102; idempotency L231–233; webhook L283–285; recon L337–339 |
| sqlite `serializeResultJson` throws on oversized JSON | `packages/store-sqlite/src/stores/shared.ts` L196–204 |
| bun driver normalizes bigint changes | `packages/store-sqlite/src/drivers/bun.ts` L58–69, L107 |
| sqlite factories / migrate reject `sqlSchema` | `shared.ts` L55–64, L67; `migrate.ts` L48 |
| libsql does not join concurrent `txDepth` | `packages/store-turso/src/drivers/libsql.ts` L193–196 |
| `preferInteractiveTransaction` true when `transaction()` exists and protocol is not file | `libsql.ts` L77–79 |

Not re-run this pass: `bun run typecheck:types`, full `bun test packages/core …`, `bun test --coverage`, `bash scripts/validate-package.sh`, `bun run check:boundaries`, `bun run check:runtime-portability`.

---

## Gate (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| Blocker | Result | Evidence |
| --- | --- | --- |
| **P1315-REDIS-1** recon expired claimed reclaim does not burn attempts; soft-release restores | **CLOSED** | `reconciliation.lua.ts` L145–150, L460–472; `registry.test.ts` `P1315-REDIS-1`; `stores.mock.test.ts` reclaim + listDue nets to original |
| **P1315-REDIS-2** abandoned claimed rediscovery via keyed ZSET (lease-expiry score) without Cluster SCAN | **CLOSED** | Claim `ZADD` at `leaseExpiresMs` (recon L161–164, webhook L146–147); `shared.ts` L134–137; mock `listDue rediscovers via ZRANGEBYSCORE when SCAN is empty` |
| **P1315-TURSO-1** libsql concurrent `withTransaction` does not silently join | **CLOSED** | `libsql.ts` L193–196; `drivers.unit.test.ts` “overlapping executor.transaction calls do not share a stream” |
| **P1315-REDIS-3** no EXPIRE on dead_letter / recon failed / manual_review | **CLOSED** | Fail / mark paths `PERSIST`; `registry.test.ts` STORES-5 |
| **P1315-REDIS-4** completed / indeterminate before fingerprint_conflict | **CLOSED** | `idempotency.lua.ts` L73–88; `registry.test.ts` index order; mock completed+other / indeterminate+other |
| **P1315-REDIS-5** `deleteExpired` `before` is canonical Z or numeric ms | **CLOSED** | `canonicalizeIsoZ` + `beforeMs` ARGV; mock offset `before` vs later `Z` `updated_at`; invalid `before` fail-closed |
| **P1315-SQLITE-1** `serializeResultJson` fail-closed at `MAX_RESULT_JSON_BYTES` | **CLOSED** | `shared.ts` L196–204; `stores.unit.test.ts` oversized result |
| **P1315-SQLITE-2** bun `changes` bigint normalized | **CLOSED** | `bun.ts` L58–69; `drivers.unit.test.ts` `1n => 1` |
| **P1315-TURSO-2** missing protocol + `transaction()` uses interactive write | **CLOSED** | `libsql.ts` L77–79; driver unit: no `BEGIN IMMEDIATE` when protocol omitted |
| Typecheck / tests red | **CLOSED** | typecheck exit 0; 386 pass / 21 skip / 0 fail |

Non-blocker IDs also addressed: P1315-REDIS-6 (docs WEBHOOKS-2), P1315-SQLITE-3 (`sqlSchema` rejected), P1315-TURSO-3 (replica refuse + `allowEmbeddedReplica` default false), P1315-TEST-1 (describe.skip / skipIf).

**Gate on listed P1315 blockers: PASS.**  
**Independent verify (typecheck + targeted tests): PASS.**

---

## Remaining nits

1. **Docs leftover “claim ZREM” wording.** `packages/store-redis/docs/scripts-atomicity.md` L75 and `crash-boundaries.md` L99 still say claim **removes** the key from the retry/due ZSET. Code now `ZADD`s at `lease_expires_ms`; complete/fail still `ZREM`. Recovery section is otherwise correct (keyed ZSET, SCAN extra). `crash-boundaries.md` L105 also says key-addressed claim “attempts++” — recon expired-claimed reclaim no longer increments.

2. **`retentionIndexKey` remains a public unused helper.** Still exported from `packages/store-redis/src/keys.ts` / `src/index.ts` and listed in `docs/key-design.md`. Workflow allowed this. SCAN `deleteExpired` is still the housekeeping path when no retain index is written.

3. **`retentionTtlMs` is still accepted and still unused on terminal fences.** Scripts `PERSIST`; the option is call-site parity only (`src/types.ts`, `resolveRedisStoreContext`). Documented.

4. **Turso replica refuse is an option flag.** `LibsqlStoreOptions.allowEmbeddedReplica` defaults false; `syncUrl` / replica-like client fields throw. Official `@libsql/client` does not expose `syncUrl` on the instance — operators must pass the constructor value. Workflow allowed this shape.

5. **Turso claim SQL stays inline UPSERT.** Stream C did not rewrite stores. Equivalent single-statement claims remain in `packages/store-turso/src/stores/`. Allowed.

6. **`packages/store-turso/docs/crash-boundaries.md` L85** still says recon soft-release **preserves** attempts. Stream D did not own that file. Webhook line in the same file already says restored. Sqlite crash-boundaries was corrected.

7. **Some turso / sqlite docs still point at `internal/sql-store`.** `packages/store-turso/docs/claims.md`, `drizzle.md`, `migrations.md` keep historical sql-store links. Overview now names `@paykernel/sql-foundation`. Not a listed blocker.

8. **Skip-clean native ABI remains.** better-sqlite3 suite skipped here (Bun ABI). Live Redis (16) and live Turso (4) skip without URLs. `packages/store-sqlite/src/drivers/drivers.unit.test.ts` node-binding still has a module-load `return` (not the conformance suite; P1315-TEST-1 targeted conformance).

9. **Type-narrowing `if (kind !== "acquired") return` after `expect`.** Present in turso concurrency and redis mock tests. Not a silent pass: `expect(kind).toBe("acquired")` runs first.

10. **Historical Phase 13 / 14 / 15 reports** still freeze 2026-08-03 evidence and early package names (`adapter-redis`, `internal/sql-store`). Those are gate-time records, not live inventory.

11. **Working tree uncommitted.** Fix-stream diffs are local vs `4cebf24`. Dist / baseline inventories were **not** regenerated this pass.

12. **Coverage / full core+testkit+webhooks / `validate:package` / `check:boundaries` / `typecheck:types` / portability not re-run** this pass.

13. **Live Redis and live Turso not available in this gate environment.** Unit + mock + registry + sqlite bun/node + turso libsql `:memory:` / `file:` cover the listed blockers.

---

## Checklist

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Four streams recorded with owned files
- [x] Verify commands re-run; typecheck + targeted tests green
- [x] Listed P1315 blockers closed in source
- [x] Canonical report under `packages/store-redis/docs/`
- [x] Pointers in `packages/store-sqlite/docs/` and `packages/store-turso/docs/`
- [ ] `typecheck:types` / full safety net / `validate:package` re-run
- [ ] Docs leftover claim-ZREM / turso recon-attempts wording
- [ ] Working tree committed

---

## Summary

Phase 13–15 critic IDs were present at `HEAD` and addressed across four streams (redis attempts / ZSET recovery / PERSIST / classify / canonicalize; sqlite serialize / bun changes / reject sqlSchema; turso no-join / interactive default / replica refuse / skip honesty; docs WEBHOOKS-2 + recovery + foundation honesty). Listed blockers are closed in source. Typecheck green. Targeted tests **386 pass / 21 skip / 0 fail**. Working tree still uncommitted.

**Canonical report:** `packages/store-redis/docs/phase-13-15-fix-gate-report.md`  
**Adapter pointers:** `packages/store-sqlite/docs/phase-13-15-fix-gate-report.md`, `packages/store-turso/docs/phase-13-15-fix-gate-report.md`
