# Phase 13 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Gate kind:** Final adversarial re-gate  
**Package:** `@paykernel/store-redis` (`packages/store-redis`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/store-redis/docs/phase-13-gate-report.md`](../../../store-redis/docs/phase-13-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 13 optional Redis/Valkey/Upstash adapter is **complete and green**. Independent adversarial re-verification: typecheck, **1401 tests pass** (14 skips without PG/Redis URLs), core coverage **99.51% funcs / 98.60% lines**, build, boundaries, portability, and package validation all pass. A1–A6 and 13.1–13.7 satisfied; no core/webhooks/adapter-postgres dependency on adapter-redis; no Phase 14 adapter packages; Redis not mandatory.

| Area | Result |
| --- | --- |
| Tests | **1401 pass, 14 skip, 0 fail** (safety net + adapter-postgres + adapter-redis) |
| Adapter-redis focused | **87 pass, 11 skip, 0 fail** |
| Coverage (core) | **99.51% funcs / 98.60% lines** |
| typecheck / typecheck:types | exit 0 |
| build + dist | OK; redis adapter 5 entry bundles |
| boundaries / portability / validate:package | all OK |
| A1 Bun first-class | **PASS** |
| A2 Shared driver contracts | **PASS** |
| A3 Lua atomicity | **PASS** |
| A4 Persistence/topology honesty | **PASS** |
| A5 Redis optional | **PASS** |
| A6 Root has no drivers | **PASS** |
| 13.1–13.7 deliverables | **PASS** |
| core/webhooks → adapter-redis | **none** |
| Phase 14 packages | **absent** |
| Blocking issues | **0** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Bun native Redis/Valkey first-class | **PASS** |
| A2 | Upstash / ioredis / node-redis share contract via RedisCommandPort | **PASS** |
| A3 | Atomicity via Lua, not client get-then-set | **PASS** |
| A4 | Persistence + topology limitations explicit | **PASS** |
| A5 | SDK usable without Redis | **PASS** |
| A6 | No Redis driver imported from package root | **PASS** |

## Non-blocking

- Live Redis suites skip without `PAYMENTS_SDK_REDIS_URL` / `REDIS_URL` / `VALKEY_URL` (11 skips; suites present)
- Live PG suites skip without PG URL (3 skips in this combined run)
- Multi-binding live parity not re-run without a Redis server in this environment
- Deno smoke SKIP when binary absent
- TLS / dedicated Valkey live matrix not exercised here

## Independent re-run evidence (high level)

```text
bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis
  → 1401 pass, 14 skip, 0 fail

bun test packages/store-redis
  → 87 pass, 11 skip, 0 fail

bun test --coverage packages/core
  → 99.51% funcs / 98.60% lines

bun run typecheck                     → exit 0
bun run typecheck:types               → exit 0
bun run check:boundaries              → OK
bun run check:runtime-portability     → OK
bun run --filter @paykernel/store-redis build → OK
bash scripts/validate-package.sh      → OK
```

## Final verdict

**PASS** — Phase 13 complete. See primary report for full evidence matrix and anti-bug checklist.
