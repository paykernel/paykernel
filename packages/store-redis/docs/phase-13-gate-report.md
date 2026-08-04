# Phase 13 adversarial gate report

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Package:** `@paykernel/store-redis` (`packages/store-redis`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Verdict summary

Phase 13 Redis / Valkey / Upstash optional adapter is **complete and green**. Independent re-run confirms typecheck (all packages + core type tests), full safety-net tests (**1401 pass / 14 skip / 0 fail**), core coverage **99.51% funcs / 98.60% lines**, adapter-redis build (5 entry bundles), boundaries, runtime portability, and `validate:package`. Acceptance criteria **A1–A6** and deliverables **13.1–13.7** are satisfied by code, docs, unit/mock/policy tests, env-gated live suites (skip cleanly without Redis URL), and monorepo wiring. No illegal deps; no Phase 14 adapters; Redis is optional.

| Area | Result |
| --- | --- |
| Tests (safety net + redis) | **1401 pass, 14 skip, 0 fail** (`bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis`) |
| Adapter-redis focused | **87 pass, 11 skip, 0 fail** (skips = live Redis without URL) |
| Coverage (core) | **99.51% funcs / 98.60% lines** |
| typecheck / typecheck:types | exit 0 (all packages + core types) |
| build + dist | adapter-redis OK: `index.js`, `bun.js`, `upstash.js`, `ioredis.js`, `node-redis.js` |
| boundaries / portability / validate:package | all OK (Deno smoke SKIP when binary absent — non-blocking) |
| A1 Bun first-class binding | **PASS** |
| A2 Shared contract across drivers | **PASS** |
| A3 Atomicity not client-sequenced | **PASS** |
| A4 Persistence / topology honesty | **PASS** |
| A5 SDK usable without Redis | **PASS** |
| A6 Root imports no Redis drivers | **PASS** |
| 13.1–13.7 deliverables | **PASS** |
| core/webhooks/adapter-postgres → adapter-redis | **none** |
| Phase 14 packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria

| ID | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| **A1** | Bun native Redis/Valkey is a first-class supported binding | **PASS** | Subpath `./bun` in `package.json` exports; `src/drivers/bun.ts` — injected `BunRedisClientLike`, `createBunRedisCommandPort` via `client.send()`, URL/`fromEnv` convenience (`PAYMENTS_SDK_REDIS_URL` / `REDIS_URL` / `VALKEY_URL`), `assertBunTopologyAllowed` rejects Cluster/Sentinel/`clusterKeys`; offline-queue / Pub/Sub / MULTI caveats documented in source + `docs/drivers.md`; `bun-cluster-reject.test.ts` + driver unit tests; `docs/testing.md` notes Redis 7.2+ / Valkey matrix; docker-compose `redis:7.2-alpine` |
| **A2** | Upstash and standard Redis clients share equivalent contract behavior | **PASS** | Subpaths `/upstash`, `/ioredis`, `/node-redis`; all adapt to `RedisCommandPort` and shared `createRedis*Store` factories; `drivers.unit.test.ts` binding parity (same tagged EVAL → same `parseTaggedResult`); live conformance uses shared stores when URL set (`conformance.redis.test.ts`) |
| **A3** | Atomicity does not depend on client-side sequencing | **PASS** | Lua scripts for reserve/claim/renew/complete/fail/mark* (`src/scripts/*.lua.ts`, `REDIS_SCRIPT_REGISTRY`); stores call `ctx.eval.eval(...)` only for ownership transitions; tagged results (`parseTaggedResult`); policy test forbids `HGETALL`/`SETNX` claim paths in JS store sources; `docs/scripts-atomicity.md` |
| **A4** | Persistence and topology limitations are explicit | **PASS** | Manifest `durability: "configuration-dependent"`, `coordinationScope: "multi-host"` (`src/manifest.ts`); `docs/persistence.md` four distinctions (coordination / process restart / Redis restart / only-audit); Bun rejects cluster; hybrid docs warn Redis-only |
| **A5** | Applications can use the SDK without installing or operating Redis | **PASS** | core/webhooks/adapter-postgres package.json have **no** redis deps; adapter-postgres standalone path documented in `docs/hybrid-examples.md` §4; overview/README: Redis optional; monorepo tests/build green without Redis server (11 adapter-redis + 3 PG live skips) |
| **A6** | No Redis driver is imported from the package root | **PASS** | Root `src/index.ts` exports stores/manifest/port/keys only — zero static driver imports; `public-api.test.ts` walks production graph forbidding `ioredis` / `redis` / `@upstash/redis` / `bun:redis`; dist `index.js` has no driver bare imports; boundaries check OK |

## Deliverables 13.1–13.7

| Section | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| **13.1** | Bun binding complete | **PASS** | Isolated `/bun`; inject preferred; URL/env convenience; `send()` for scripts; offline queue control documented + ioredis/node-redis defaults; Cluster/Sentinel unsupported + rejected; Pub/Sub not correctness path |
| **13.2** | Atomic Lua for listed transitions | **PASS** | Idempotency: reserve/renew/complete/markIndeterminate/get/deleteIfExpired; Webhook: claim/renew/complete/fail/get/deleteIfExpired; Recon: schedule/claim/renew/complete/fail/markManualReview/get/deleteIfExpired; tagged outcomes; generation++ fencing |
| **13.3** | Shared `RedisCommandPort` only (narrow) | **PASS** | `interface RedisCommandPort { send(command, args): Promise<unknown> }` in `src/port.ts` + `createEvalHelper`; not a large generic Redis client abstraction |
| **13.4** | Key design complete; Bun rejects cluster | **PASS** | `src/keys.ts`: prefix, version, tenant, `clusterKeys` hash tags, retention TTL opts on stores, schema version, max lengths (`limits.ts`); Bun rejects `clusterKeys`/cluster/sentinel |
| **13.5** | Persistence caveats + manifest honesty | **PASS** | Manifest notes + `docs/persistence.md` / `guarantees.md`; not advertised as sole durable audit store |
| **13.6** | Hybrid examples docs | **PASS** | `docs/hybrid-examples.md`: Bun Redis+Postgres; Upstash+D1/Turso; Redis-only with warnings; no-Redis Postgres-only |
| **13.7** | Full test matrix as practical | **PASS** | Unit/mock/policy/driver parity without Redis; live conformance/multi-connection/integration skip without URL; docker-compose for Redis 7.2; FakeClock via injectable clock ARGV |

## Cross-cutting requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Injectable clock for conformance | **PASS** | `StoreClock` / FakeClock-compatible; scripts take `nowMs` ARGV; conformance + integration inject `createFakeClock()` |
| Phase 0–12 safety net green | **PASS** | 1401 pass across core/testkit/webhooks/sql-store/adapter-postgres/adapter-redis |
| Boundaries; no core/webhooks/adapter-postgres → adapter-redis | **PASS** | `check:boundaries` OK; package.json deps audited |
| Redis adapter must not depend on sql-store | **PASS** | adapter-redis depends only on `@paykernel/testkit` (+ optional peer drivers) |
| No Phase 14 packages | **PASS** | Only `adapter-postgres` + `adapter-redis` under `packages/`; no adapter-sqlite/d1/turso packages |
| Docs complete | **PASS** | overview, drivers, guarantees, crash-boundaries, persistence, scripts-atomicity, key-design, hybrid-examples, testing + README |

## Anti-bug matrix (logical risks)

| Risk | Status | Evidence |
| --- | --- | --- |
| get/set claim race | **OK** | Single Lua EVAL per transition; store sources policy test forbids HGETALL/SETNX claim sequencing |
| Secrets unbounded | **OK** | `mapDriverError` sanitizes redis/postgres URLs + secret patterns (`MAX_MESSAGE=256`); `enforceMaxSanitizedError` (512) on store error fields; result JSON capped (`MAX_RESULT_JSON_BYTES`) |
| Root importing drivers | **OK** | public-api walk + dist/index.js clean; optional peers on subpaths only |
| FakeClock ignored | **OK** | Stores pass `clockNowMsString` / ISO into ARGV; scripts compare `lease_expires_ms` vs ARGV nowMs (not sole `TIME`) |
| Dishonest durable-only audit claim | **OK** | Manifest `configuration-dependent`; persistence four-level table; hybrid recommends SQL for audit |
| Pub/Sub correctness | **OK** | Not used in production store paths; documented anti-pattern |
| Offline queue replay ambiguity | **OK** | `IOREDIS_STORE_CLIENT_DEFAULTS.enableOfflineQueue: false`; `NODE_REDIS_STORE_CLIENT_DEFAULTS.disableOfflineQueue: true`; Bun docs prefer fail-fast |
| Bun accepting cluster | **OK** | `assertBunTopologyAllowed` + factory rejects; unit tests |
| Redis mandatory | **OK** | Optional package; live suites skip; core has no redis; hybrid §4 no-Redis path |

## Independent re-run evidence

```text
bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis
  → 1401 pass, 14 skip, 0 fail
  → skips: 3 PG without URL + 11 Redis without URL

bun test packages/store-redis
  → 87 pass, 11 skip, 0 fail

bun test --coverage packages/core
  → 1000 pass; All files 99.51% funcs / 98.60% lines

bun run typecheck
  → all workspace packages exit 0 (includes adapter-redis)

bun run typecheck:types
  → exit 0

bun run --filter @paykernel/store-redis build
  → exit 0
  → dist: index.js, bun.js, upstash.js, ioredis.js, node-redis.js

bun run check:boundaries
  → workspace boundaries OK

bun run check:runtime-portability
  → runtime portability OK (Deno smoke SKIP — binary absent)

bash scripts/validate-package.sh
  → package validation OK (typecheck, core tests, build, publint, attw, consumer smoke)
```

## Non-blocking notes

1. Live Redis conformance / multi-connection / integration suites **skip** without `PAYMENTS_SDK_REDIS_URL` | `REDIS_URL` | `VALKEY_URL` (by design; Redis optional).
2. Full multi-binding **live** parity (Bun + Upstash + ioredis + node-redis against a real server) was not exercised in this gate environment (no Redis URL); unit binding parity + shared store path remain proven offline.
3. TLS-enabled Redis live path not run here (documented as CI-when-available).
4. Separate Valkey process not required for this gate; protocol-compatible path documented; env accepts `VALKEY_URL`.
5. Deno smoke SKIP when `deno` binary absent (portability static scan still required and green).
6. Local docker-compose uses ephemeral Redis (`--save "" --appendonly no`) for tests only — does not contradict production persistence honesty in docs/manifest.

## Blocking issues

None.

## Final verdict

**PASS** — Phase 13 may be considered complete. Phase 14 (local SQLite adapter family) is not started.
