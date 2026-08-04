# Phase 18 adversarial gate report (baseline)

**Date (UTC):** 2026-08-04  
**Gate kind:** Adversarial re-gate (fail-closed; independent evidence only)  
**Scope:** Adapter capability matrix + selection guide (monorepo docs + testkit matrix + live honesty)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> Primary artifacts: [`docs/adapter-selection.md`](../../../../docs/adapter-selection.md),  
> [`docs/adapter-capability-matrix.json`](../../../../docs/adapter-capability-matrix.json),  
> [`packages/testkit/src/storage/adapter-selection-matrix.ts`](../../../testkit/src/storage/adapter-selection-matrix.ts),  
> [`scripts/check-adapter-selection-honesty.test.ts`](../../../../scripts/check-adapter-selection-honesty.test.ts).

---

## Verdict summary

Phase 18 **Adapter Capability Matrix and Selection Guide** is **complete and green**. Independent adversarial re-verification (this session) confirms:

| Area | Independent result |
| ---- | ------------------ |
| Package tests (Phase 0–17 adapters + core + webhooks + sql-store + testkit) | **1631 pass, 15 skip, 0 fail** |
| Same suite + honesty script | **1656 pass, 15 skip, 0 fail** |
| typecheck (all workspace packages) | **OK** (exit 0) |
| typecheck:types (core) | **OK** (exit 0) |
| check:boundaries | **OK** |
| check:runtime-portability | **OK** |
| build (all packages) | **OK** |
| validate:package (pack · publint · attw · consumer smoke) | **OK** |
| Core coverage | **99.51% funcs / 98.60% lines** |
| Live + frozen honesty tests | **42 pass, 0 fail** (15 matrix + 27 live/prose) |
| A1 decision tree + capability matrix | **PASS** |
| A2 no marketing beyond tested guarantees | **PASS** |
| Blocking issues | **0** |

Implementer summary (typecheck, 1631 adapter+core tests, 98.60% lines, build, boundaries, runtime-portability, validate:package, full matrix+tree+defaults+honesty, 42 honesty tests, monorepo/testkit links, Phase 19 recon legal) **matches independent re-runs**. Failures JSON `[]` and `ok: true` **confirmed**.

---

## Acceptance criteria (roadmap Phase 18)

| ID | Criterion | Verdict | Evidence |
| -- | --------- | ------- | -------- |
| **A1** | Documentation includes a **decision tree** and a **capability matrix** | **PASS** | [`docs/adapter-selection.md`](../../../../docs/adapter-selection.md) §2 capability matrix (11 rows: 10 production + memory), §3.1 mermaid flowchart, §3.2 numbered Q&A decision tree |
| **A2** | No adapter marketed beyond tested deployment guarantees | **PASS** | §5 honesty/anti-marketing bans; matrix cells match live `*STORAGE_ADAPTER_MANIFEST` via honesty tests; no `multi-region` coordinationScope on any production manifest; Redis optional; SQLite single-host; DO partitioned; D1 ≠ DO ≠ Turso ≠ local SQLite |

---

## Roadmap Initial Matrix coverage (10 production rows)

All roadmap Initial Matrix adapter rows are present with package names (matrix + guide + JSON twin):

| Roadmap adapter | Matrix `rowId` | Package |
| --------------- | -------------- | ------- |
| PostgreSQL | `postgres` | `@paykernel/store-postgres` |
| Redis/Valkey (Bun, ioredis, node-redis) | `redis-native` | `@paykernel/store-redis` |
| Upstash Redis | `redis-upstash` | `@paykernel/store-redis` |
| Bun SQLite | `sqlite-bun` | `@paykernel/store-sqlite` |
| Node SQLite | `sqlite-node` | `@paykernel/store-sqlite` |
| better-sqlite3 | `sqlite-better-sqlite3` | `@paykernel/store-sqlite` |
| Turso serverless | `turso-serverless` | `@paykernel/store-turso` |
| libSQL | `turso-libsql` | `@paykernel/store-turso` |
| Cloudflare D1 | `cloudflare-d1` | `@paykernel/store-d1` |
| Cloudflare Durable Objects | `cloudflare-do` | `@paykernel/store-durable-objects` |

Plus honesty row: **Memory (testkit)** — `single-process` + `ephemeral` + `productionRecommended: false`.

**Recommended defaults** present in `docs/adapter-selection.md` §4 and match roadmap wording (Postgres default; D1 when on D1; DO for per-key; Bun SQLite single-server; Turso remote SQLite; matching Redis optional/hybrid; avoid adding Redis solely for the SDK).

---

## Honesty checklist (anti-marketing)

| Rule | Evidence | Verdict |
| ---- | -------- | ------- |
| Redis optional (never required) | Guide preamble + defaults; matrix `redisOptional: true` on redis rows; JSON `redisRequired: false`; honesty tests | **PASS** |
| Local SQLite single-host only | Manifests `coordinationScope: "single-host"`; matrix `distributed: "no"` + `isLocalSqlite: true`; fail-closed tree branch | **PASS** |
| D1 ≠ DO ≠ Turso ≠ local SQLite | Explicit limitations + monorepo banners + store-contracts pointer; separate packages/APIs | **PASS** |
| DO partitioned, never global singleton | Matrix `yes-partitioned` + `partitioned: true`; decision tree “never global singleton”; §5 ban; DO manifest notes | **PASS** |
| No multi-region strong consistency claimed | No live production manifest uses `multi-region`; matrix `noMultiRegionAdapters: true`; §5 ban; multi-region prose is **anti-claim only** | **PASS** |
| Memory NON-PRODUCTION | Matrix + guide + testkit memory row | **PASS** |
| Matrix cells match live manifests | `scripts/check-adapter-selection-honesty.test.ts` (27) + frozen matrix tests (15) = **42 pass** | **PASS** |
| Turso no `/sync` | Package exports only `.` + `./serverless` + `./libsql`; guide + matrix limitations | **PASS** |
| Bun Redis no Cluster/Sentinel | Matrix `yes-except-bun-cluster-sentinel`; guide + redis topology asserts | **PASS** |

### Live manifest field spot-check (source packages)

| Manifest | `coordinationScope` | `durability` | RAW / stale |
| -------- | ------------------- | ------------ | ----------- |
| postgres | `multi-host` | `durable` | strong / false |
| redis | `multi-host` | `configuration-dependent` | strong / false |
| sqlite | `single-host` | `durable` | strong / false |
| turso | `multi-host` | `durable` | strong / false |
| cloudflare-d1 | `multi-host` | `durable` | **session / true** |
| cloudflare-do | `multi-host` | `durable` | strong / false (per partition in docs/matrix) |
| memory | `single-process` | `ephemeral` | strong / false |

---

## Links and navigation

| Source | Link target | Exists |
| ------ | ----------- | ------ |
| [`docs/monorepo.md`](../../../../docs/monorepo.md) § “Choosing a storage adapter (Phase 18)” | `./adapter-selection.md` | **yes** |
| [`packages/testkit/docs/store-contracts.md`](../../../testkit/docs/store-contracts.md) | `../../../docs/adapter-selection.md` | **yes** |
| Root README / workspace-boundaries / core storage-adapters / adapter READMEs | `docs/adapter-selection.md` | **yes** |
| Relative links inside `docs/adapter-selection.md` + monorepo + store-contracts + README + workspace-boundaries | adapter packages, matrix, honesty script, store-contracts | **0 broken** (292 checked) |

---

## Independent command re-runs (this gate)

```text
# Honesty (Phase 18)
bun test packages/testkit/src/storage/adapter-selection-matrix.test.ts \
  scripts/check-adapter-selection-honesty.test.ts
→ 42 pass, 0 fail  (15 frozen matrix + 27 live/prose guards)

# Safety net (Phase 0–17 adapters; no recon)
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite \
  packages/store-turso packages/store-d1 packages/store-durable-objects
→ 1631 pass, 15 skip, 0 fail  (1646 tests / 119 files)

# Safety net + honesty
bun test packages/core packages/testkit packages/webhooks internal/sql-store \
  packages/store-postgres packages/store-redis packages/store-sqlite \
  packages/store-turso packages/store-d1 packages/store-durable-objects \
  scripts/check-adapter-selection-honesty.test.ts
→ 1656 pass, 15 skip, 0 fail  (1671 tests / 120 files)

# Tooling gates
bun run typecheck                 → exit 0 (all workspace packages)
bun run typecheck:types           → exit 0
bun run check:boundaries          → workspace boundaries OK
bun run check:runtime-portability → runtime portability OK
bun run build                     → exit 0
bun test --coverage packages/core → 99.51% funcs / 98.60% lines
bun run validate:package          → pack + publint + attw + consumer smoke OK
```

---

## Phase boundary note

| Check | Result |
| ----- | ------ |
| Phase 18 deliverables (matrix + tree + defaults + honesty) | **complete** — independent of Phase 19 |
| `packages/reconciliation` | **exists** as **Phase 19** per `roadmap.md` (`@paykernel/reconciliation`); **not** a Phase 18 requirement or invention |
| Phase 18 did not invent new adapters or overclaim guarantees | **confirmed** |

The selection guide may *link* reconciliation for domain recovery primitives without making Redis/queues mandatory. Phase 19 is legal later-phase work; its presence does not block or invent Phase 18 scope.

---

## Logical-bug probes (fail-closed)

| Probe | Result |
| ----- | ------ |
| Incomplete matrix (missing Initial Matrix row) | **none** — 10/10 production rows + memory |
| Missing decision tree | **none** — mermaid + numbered Q&A both present |
| Overclaim multi-region | **none** — only anti-claim language; no manifest `multi-region` |
| Redis required | **none** — optional throughout |
| Global DO marketing | **none** — partitioned + “never global” |
| Broken relative links | **none** — selection guide / monorepo / store-contracts / related docs |
| Matrix/JSON/TS desync | **none** — honesty test asserts rowIds + honesty fields equal |
| Marketing local SQLite as multi-host | **none** — single-host + fail-closed tree |

---

## Non-blocking notes

1. **Honesty suite size:** frozen matrix suite (15) + root live cross-check (27, including guide-phrase locks) = **42**. Both green.
2. **D1 README TOC / limits** may mention “multi-region” only as limits-doc anti-claim content, not multi-region marketing.
3. **Env-gated skips (15):** postgres/redis live integration tests without URLs — expected; not regressions.
4. **libSQL dual shape:** remote multi-host is the production model; local `file:` is single-host testing only — documented in limitations (not an overclaim).
5. **`packages/reconciliation`** exists as Phase 19 (roadmap-legal); this Phase 18 gate did not expand Phase 19 scope.

---

## Checklist (gate)

- [x] A1: decision tree present (mermaid + Q&A)
- [x] A1: capability matrix present (10 production + memory)
- [x] A2: no overclaim beyond manifests / guarantees
- [x] All Initial Matrix rows with package names
- [x] Recommended defaults present and match roadmap
- [x] Redis optional; SQLite single-host; D1 ≠ DO ≠ Turso ≠ local SQLite
- [x] Links from monorepo.md and testkit store-contracts.md
- [x] Phase 0–17 adapter safety net green (1631 pass / 0 fail; 1656 with honesty)
- [x] typecheck + typecheck:types green
- [x] boundaries green
- [x] runtime-portability green
- [x] build + validate:package green
- [x] core coverage ≥ 98.6% lines (measured 98.60%)
- [x] Honesty suite green (42)
- [x] No Phase 19 reconciliation package sneak-in as Phase 18 invention
- [x] No blocking logical bugs

---

## Verdict

**PASS** — Phase 18 complete and green. Acceptance A1 and A2 satisfied with independent evidence. Matrix/tree/defaults/honesty/manifest alignment re-verified; safety net and tooling gates green; no blocking findings. No fixes required.

```json
{
  "pass": true,
  "blocking": [],
  "non_blocking": [
    "Honesty suite is matrix(15)+live(27 including guide-phrase locks)=42; both green",
    "D1 README TOC may mention multi-region only as limits-doc topic (anti-claim content)",
    "packages/reconciliation exists as Phase 19 (roadmap-legal); not a Phase 18 invention"
  ],
  "checklist": [
    "A1 decision tree PASS",
    "A1 capability matrix PASS",
    "A2 honesty/no overclaim PASS",
    "10 Initial Matrix rows + packages PASS",
    "recommended defaults PASS",
    "redis optional / sqlite single-host / D1≠DO≠Turso≠sqlite PASS",
    "monorepo + store-contracts links PASS",
    "1631 adapter safety / 1656 with honesty 0 fail PASS",
    "typecheck + typecheck:types + boundaries PASS",
    "runtime-portability + build + validate:package PASS",
    "core coverage 98.60% lines PASS",
    "honesty 42 PASS"
  ],
  "summary": "Phase 18 PASS: typecheck/types, 1631 adapter+core tests (0 fail), core coverage 98.60% lines, build, boundaries, runtime-portability, validate:package all green; docs/adapter-selection.md has full 10-row matrix + mermaid/Q&A decision tree + recommended defaults + anti-marketing honesty; 42 honesty tests match manifests (sqlite single-host, redis optional, DO partitioned, D1 session/stale, no multi-region); monorepo+testkit links present; packages/reconciliation is Phase 19 (legal), not a Phase 18 invention. No fixes required.",
  "report_path": "packages/core/docs/baseline/phase-18-gate-report.md"
}
```
