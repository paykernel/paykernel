# Phase 9 adversarial gate report

**Date (UTC):** 2026-08-03  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**  
**Primary report path:** `packages/testkit/docs/phase-9-gate-report.md`  
**Baseline copy:** `packages/core/docs/baseline/phase-9-gate-report.md`

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck / types OK | **PASS** — `bun run typecheck` exit 0 (core + testkit + webhooks); `bun run typecheck:types` exit 0 |
| 1125 core+testkit tests pass | **PASS** — `bun test packages/core packages/testkit` → **1125 pass, 0 fail**, 4704 expects, 39 files |
| core coverage 99.51% funcs / 98.60% lines | **PASS** — measured **99.51% funcs / 98.60% lines** (`bun test --coverage packages/core`; 1000 pass) |
| build + dist OK | **PASS** — `bun run build` exit 0; core + testkit + webhooks ESM + `.d.ts`; testkit dist exports `MEMORY_STORAGE_ADAPTER_MANIFEST`, `createMemoryStores` |
| boundaries / portability / validate:package OK | **PASS** — `check:boundaries` OK; `check:runtime-portability` OK (Deno smoke SKIP); full `validate-package.sh` OK |
| Lease-aware triple contracts, dual fencing, StoreErrorCode taxonomy | **PASS** — `contracts.ts` + docs + unit/conformance evidence |
| `MEMORY_STORAGE_ADAPTER_MANIFEST` (src+dist), `createMemoryStores().manifest` | **PASS** — same reference; JSON round-trip; dist Node import |
| Conformance 14/12/14 memory suites | **PASS** — idempotency **14**, webhook-inbox **12**, reconciliation **14** (all ok, 0 failed) |
| A4 indeterminate block | **PASS** — reserve returns `kind: "indeterminate"`; no lease; deleteExpired skips; unit + conformance + adversarial probe |
| A5 renew + stale rejection | **PASS** — renew rotates token + generation; pre-renew complete/renew fail; all three stores |
| store-contracts.md + README / CHANGELOG evidenced | **PASS** — present and aligned with roadmap §9 |
| Core 0.x `IdempotencyStore` unchanged and distinct | **PASS** — still get/set/delete/optional reserve; no lease fields |
| No core→testkit dep | **PASS** — core deps = `{ zod }` only; zero imports of testkit under `packages/core/src` |
| No adapter-\* packages (webhooks is Phase 10 post-gate) | **PASS** — workspace packages = `core`, `testkit`, `webhooks`; no durable DB adapters |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **1125 pass, 0 fail** (39 files, 4704 expects) |
| `bun test --coverage packages/core` | **1000 pass**; **99.51% funcs / 98.60% lines** |
| `bun test packages/testkit/src/storage packages/testkit/src/memory` | **50 pass, 0 fail** (focused storage + memory) |
| Memory conformance counters | idempotency **14** / webhook **12** / recon **14** passed, 0 failed |
| Adversarial logical probes (stale complete, indeterminate re-reserve, renew fencing, concurrent reserve, manifest honesty) | **PASS** — failures `[]`, ok `true` |
| `bun run typecheck` | exit 0 (core + testkit + webhooks) |
| `bun run typecheck:types` | exit 0 |
| `bun run build` | exit 0 (core + testkit + webhooks; ESM + `.d.ts`) |
| `bun run check:boundaries` | exit 0 — workspace boundaries OK |
| `bun run check:runtime-portability` | exit 0 (src + dist clean; Deno SKIP) |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → portability → pack → publint → attw → Bun+Node consumer-smoke **OK** |
| core → testkit dep | **none** — core `dependencies` = `{ zod }` only; `rg` under `packages/core/src` finds no testkit imports |
| adapter-\* packages | **absent** — `packages/` = core, testkit, webhooks only |
| Dist manifest discoverability | Node import of `packages/testkit/dist/index.js`: `createMemoryStores().manifest === MEMORY_STORAGE_ADAPTER_MANIFEST`, JSON-serializable, `isProductionSafeCoordination` = false, `coordinationScope` = `single-process` |

### Static / source audits

| Audit | Result |
| --- | --- |
| Three separate store interfaces (9.1) | `IdempotencyStore`, `WebhookInboxStore`, `ReconciliationStore` in `packages/testkit/src/storage/contracts.ts` — methods match roadmap §9.1 |
| Lease fields (9.2) | Claimable records: `leaseOwner`, `leaseToken`, `leaseExpiresAt`, `attempts`, timestamps, `generation` |
| Dual fencing (9.3) | Monotonic `generation` + unguessable `leaseToken`; both rotate on renew/reclaim (memory + conformance) |
| Error taxonomy (9.4) | `StoreErrorCode` + subclasses + `STORE_ERROR_CODES` (+ extension `payload_hash_conflict`) |
| Manifest (9.5) | `StorageAdapterManifest` + `MEMORY_STORAGE_ADAPTER_MANIFEST` + assert/helpers |
| Memory NON-PRODUCTION + crash docs | File banner, `NON_PRODUCTION` / `NON_DISTRIBUTED`, README, store-contracts §10–§11, manifest notes |
| Conformance self-proof | `storage-conformance.test.ts` runs all three suites against memory |
| Core 0.x idempotency | `packages/core/src/utils/idempotency.ts` unchanged shape (get/set/delete/optional reserve) |
| get-then-set forbidden | JSDoc + store-contracts.md §3; memory declares single-process only |
| No mega-store | Three interfaces; docs forbid one universal bag |
| Secrets policy | `StoreError` JSDoc + store-contracts §6/§15: no secrets/payloads in messages |

---

## Acceptance criteria (roadmap Phase 9)

### A1) contracts specify atomicity and stale-worker behavior precisely — **PASS**

| Evidence | Detail |
| --- | --- |
| JSDoc on interfaces | `contracts.ts` file header + per-interface blocks: engine-level atomic `reserve`/`claim`; every post-claim mutator requires active `leaseToken`; renew rotates token + generation |
| store-contracts.md | §3 atomicity, §4 lease semantics, §5 dual fencing, §9 renew (A5) |
| complete/renew require token | Input types require `leaseToken`; memory throws `StoreLeaseLostError` or renew `{ ok: false, reason: "lease_lost" }` |

### A2) implementations cannot claim correctness with non-atomic get/set logic — **PASS**

| Evidence | Detail |
| --- | --- |
| Docs forbid get/set claim | store-contracts.md §3 explicitly forbids get-then-set; advertising it is an acceptance failure |
| Memory single-process only | `coordinationScope: "single-process"`, `NON_DISTRIBUTED`, notes scope “strong” claims to one isolate |
| Conformance atomic claim | Concurrent same-isolate double reserve → one acquired + one in_progress; reclaim after expiry rotates token |

### A3) adapter guarantees are machine-readable and documented — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | `StorageAdapterManifest` with all roadmap §9.5 fields required |
| Constant | `MEMORY_STORAGE_ADAPTER_MANIFEST` in src + dist |
| JSON-serializable | Unit test `JSON.stringify` round-trip without functions; dist Node smoke |
| createMemoryStores().manifest | Same reference as constant |
| Docs section | store-contracts.md §7; testkit README store-contracts section |

### A4) indeterminate idempotency record blocks mutation replay — **PASS**

| Evidence | Detail |
| --- | --- |
| reserve kind | `{ kind: "indeterminate" }` — no new lease |
| Implementation | memory `reserve` branch for `status === "indeterminate"` (lines ~266–268) |
| Conformance / unit | suite case `indeterminate blocks reserve permanently; deleteExpired skips indeterminate` + memory-stores A4 test |
| Adversarial probe | re-reserve after markIndeterminate → kind indeterminate; deleteExpired deleted=0 |
| Docs | store-contracts.md §8 |

### A5) long-running work can renew leases without allowing stale completion — **PASS**

| Evidence | Detail |
| --- | --- |
| renew success | Valid token → new token, generation++ |
| renew fail stale | `{ ok: false, reason: "lease_lost" }` |
| complete fail stale | Pre-renew / pre-reclaim token → `StoreLeaseLostError` |
| Tests | All three conformance suites (renew + generation fencing cases) + memory unit tests + adversarial probe across idempotency/webhook/recon |

---

## Deliverables 9.1–9.5

| ID | Deliverable | Verdict | Evidence |
| --- | --- | --- | --- |
| 9.1 | Three separate store interfaces with roadmap methods | **PASS** | `contracts.ts` method lists match roadmap §9.1 |
| 9.2 | Lease fields on claimable records | **PASS** | Idempotency / webhook / reconciliation records |
| 9.3 | Fencing tokens / generations | **PASS** | Dual fencing; increments on acquire/renew/reclaim |
| 9.4 | Full error taxonomy | **PASS** | All roadmap codes + `payload_hash_conflict` extension |
| 9.5 | StorageAdapterManifest | **PASS** | Type, memory constant, assert helpers, docs |
| — | Memory NON-PRODUCTION + crash boundary docs | **PASS** | Code banners, README, store-contracts §10–§11, manifest notes |
| — | Conformance self-proof for memory | **PASS** | 14/12/14 suites green via storage-conformance.test.ts |
| — | Phase 0–8 safety net green; boundaries; no core→testkit | **PASS** | 1125 tests, boundaries OK, core deps zod only |
| — | Core 0.x IdempotencyStore distinct and intact | **PASS** | get/set/delete/optional reserve; LeaseAware alias in testkit |
| — | No real DB adapter packages | **PASS** | packages/ = core + testkit + webhooks (Phase 10); no adapter-\* |

---

## Logical anti-bugs (fail-closed probes)

| Anti-pattern (must NOT hold) | Result |
| --- | --- |
| Stale complete succeeds after reclaim or renew | **Absent** — throws `StoreLeaseLostError`; status not completed by stale token |
| Indeterminate re-reserves / issues lease | **Absent** — `kind: "indeterminate"`, no leaseToken |
| Memory claims multi-process / production-safe | **Absent** — single-process + ephemeral; `isProductionSafeCoordination` false |
| Secrets required/leaked in store error messages | **Absent** — generic messages; docs forbid secrets/payloads |
| Universal mega-store interface | **Absent** — three separate interfaces |
| get/set advertised as atomic multi-process claim | **Absent** — forbidden in contracts/docs; memory scoped single-isolate |

---

## Non-blocking notes

| Item | Severity | Note |
| --- | --- | --- |
| Deno binary smoke SKIP | non_blocking | Same as Phase 8: static zero-`node:` scan is the required Workers/Deno gate; Deno not on PATH |
| `payload_hash_conflict` extra vs roadmap list | non_blocking | Intentional webhook extension; documented in taxonomy |
| Core/testkit version still 0.8.0 / 0.1.0 Unreleased | non_blocking | Changelog under Unreleased; release not part of Phase 9 gate |
| Phase 10 webhooks package present on disk | non_blocking | Expected post-Phase-9 integration; dual-owns structurally compatible `WebhookInboxStore` without importing testkit; not an adapter-\* package |

---

## Blocking issues

_None._

---

## Checklist (gate)

- [x] A1 atomicity + stale-worker contracts precise
- [x] A2 non-atomic get/set cannot claim correctness
- [x] A3 machine-readable StorageAdapterManifest + docs
- [x] A4 indeterminate blocks mutation replay
- [x] A5 renew without stale completion
- [x] 9.1 three store interfaces
- [x] 9.2 lease fields
- [x] 9.3 dual fencing
- [x] 9.4 error taxonomy
- [x] 9.5 StorageAdapterManifest
- [x] Memory NON-PRODUCTION + crash docs
- [x] Three memory conformance suites self-proof (14/12/14)
- [x] 1125 core+testkit tests green
- [x] Core coverage 99.51% / 98.60%
- [x] typecheck + typecheck:types
- [x] build + dist (src+dist manifest)
- [x] boundaries + portability + validate:package
- [x] Core 0.x IdempotencyStore distinct/intact
- [x] No core→testkit dependency
- [x] No real DB adapter packages (webhooks is Phase 10 domain engine, not adapter-\*)
- [x] Logical anti-bugs probed clean

---

## Summary

Phase 9 **PASS**. Independent re-runs confirm implementer claims: **1125** core+testkit tests, typecheck/types, core coverage **99.51% funcs / 98.60% lines**, build/dist, boundaries, portability, and full package validation. Lease-aware triple store contracts, dual fencing, StoreErrorCode taxonomy, memory manifest (src+dist) with `createMemoryStores().manifest`, A4/A5 behavior, conformance self-proof **14/12/14**, and docs (store-contracts.md, README, CHANGELOG) are evidenced. Core 0.x `IdempotencyStore` remains distinct; no core→testkit dependency; no durable adapter packages. Phase 10 webhooks (post-gate) dual-owns a structurally compatible inbox store without importing testkit. No logical anti-bugs found under adversarial probes.
