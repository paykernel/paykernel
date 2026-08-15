# Phase 16–18 fix-gate report

**Date (UTC):** 2026-08-15  
**Packages:** `@paykernel/store-d1@0.1.0-next.0`, `@paykernel/store-durable-objects@0.1.0-next.0`, `@paykernel/testkit@0.1.0-next.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-16-18-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`4c4df82`); not a release commit.

**Verdict:** **PASS** (listed P16–P18 blockers closed in source; typecheck green)

Historical Phase 16 / 17 / 18 gates had already landed D1, Durable Objects, and the adapter-selection guide. The holes below were still present on `4c4df82`. Three non-overlapping streams closed them. Independent re-check of every listed ID has file:line evidence.

Targeted suite this session: **238 pass, 4 fail**. The four fails are file-backed restart tests (`restart.d1.test.ts`, `restart.do.test.ts`) hitting `SQLITE_IOERR_WRITE` because this environment cannot write `/tmp` (plain `writeFileSync` → errno `-122`). They are **not** listed P16–P18 IDs. All ID-specific unit/honesty tests passed.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation against committed `HEAD` (`4c4df82`).

| ID | Status at `HEAD` | Evidence |
| -- | ---------------- | -------- |
| **P16-TX** | **STILL PRESENT** | `createD1Executor` always attached `transaction()` that issued `BEGIN IMMEDIATE` (`packages/store-d1/src/executor.ts` ~L130–133). Live D1 rejects interactive BEGIN; `withTransaction` then mapped to retryable `StoreUnavailableError`. |
| **P16-ALS** | **STILL PRESENT** | `shared.ts` static-imports `node:async_hooks`. `examples/wrangler.toml` / `smoke/wrangler.toml` used `compatibility_date = "2024-09-23"` with **no** `nodejs_compat` / `nodejs_als`. |
| **P16-SUCCESS** | **STILL PRESENT** | `query()` returned `result.results ?? []` with no `success`/`error` check. A failed UPSERT that resolved empty looked like a claim miss. |
| **P16-SESSION** | **STILL PRESENT** | `createD1PaymentStores` defaulted first-primary; `createD1Executor` only wrapped when `options.session` was an explicit string. README executor path could skip sessions under replication. |
| **P17-RPC** | **STILL PRESENT** | Hash client always RPCs `bindHashPartitionLayout`. `smoke/worker.ts` and `examples/wrangler.toml` sketch did **not** forward it. Mock `Proxy` hid the hole. |
| **P17-ERR** | **STILL PRESENT** | `withMappedErrors` used `instanceof StoreError`. CF RPC clones `{ name, message }` only. `mapDriverError` defaulted to retryable `StoreUnavailableError`. |
| **P17-CLEAN** | **STILL PRESENT** | Bounded `deleteExpired` walked hash partitions `0..N-1` and stopped when `remaining==0`. Partition 0 with `>=limit` rows starved later partitions. |
| **P17-NS** | **STILL PRESENT** | `tableNamespace` comment claimed in-DO apply. Worker client did not pass the prefix on RPC. Mock namespaces auto-injected it. |
| **P17-TENANT** | **STILL PRESENT** | Client `shard()` was `shard(input.key)` only. Tenant isolation test used **two** mock namespaces so a broken router still passed. |
| **P17-CURSOR** | **STILL PRESENT** | `bindHashPartitionLayout` issued `sql.exec` without `.toArray()` before the next exec / return. |
| **P18-TREE** | **STILL PRESENT** | Mermaid Q2 was “already on D1?” → D1, then local file. Workers could be sent to `store-sqlite`. Existing D1 never reached DO. Greenfield Workers jumped toward Turso. |
| **P18-LIBSQL** | **STILL PRESENT** | Frozen `turso-libsql` row claimed flat `distributed: "yes"` while `/libsql` also opens `file:`. |
| **P18-STALE** | **STILL PRESENT** | `turso-serverless` limitation still said `adapter-sqlite`. D1/DO comparison tables still used `adapter-cloudflare-*` labels. |

**Critic summary:** all 13 IDs still present at `HEAD`. None were already fixed.

---

## Three fix streams

Non-overlapping edits on the uncommitted tree (53 tracked files + 3 new DO files; +1606 / −447 vs `HEAD` before this report).

### Stream A — D1 (`P16-TX`, `P16-ALS`, `P16-SUCCESS`, `P16-SESSION`, package-local `P18-STALE`)

Files only under `packages/store-d1/`. Did **not** edit DO production src or `docs/adapter-selection.md`.

| Change | Where |
| ------ | ----- |
| Live `createD1Executor` omits `transaction()`. `BEGIN IMMEDIATE` only via mock `D1_SAME_CONNECTION_SQLITE` hook. `withTransaction` throws `StoreUnsupportedFeatureError` when TX is missing. | `src/executor.ts`, `src/stores/shared.ts`, `src/stores/stores.unit.test.ts` |
| `nodejs_compat` + date comment on example/smoke Wrangler and docs. ALS import kept (documented). | `examples/wrangler.toml`, `smoke/wrangler.toml`, `docs/wrangler.md`, `README.md` |
| `query()` / `execute()` / `batch()` throw on `success === false` or `error`. Failed UPSERT is not an acquired/in_progress miss. | `src/executor.ts` `assertD1Success`; `stores.unit.test.ts` P16-SUCCESS |
| `createD1Executor` / `migrateD1Adapter` default `first-primary` when `withSession` exists; `session: false` stays unbound. | `src/executor.ts` `resolveExecutorSession`; `src/migrate.ts`; `sessions.d1.test.ts` |
| Comparison tables use `@paykernel/store-*` names; sessions default documented. | `docs/overview.md` and sibling D1 docs |

### Stream B — DO (`P17-RPC`, `P17-ERR`, `P17-CLEAN`, `P17-NS`, `P17-TENANT`, `P17-CURSOR`)

Files only under `packages/store-durable-objects/`. Did **not** edit D1 or the selection guide.

| Change | Where |
| ------ | ----- |
| Smoke Worker + wrangler sketch forward `bindHashPartitionLayout`. `REQUIRED_DO_RPC_METHODS` lists the stub surface. Thin (non-Proxy) wrapper test fails hash reserve when the method is missing. | `src/rpc.ts`, `smoke/worker.ts`, `examples/wrangler.toml`, `src/client.rpc.test.ts` |
| Reconstruct `StoreError` from `err.name` / `{ __pkStoreError, code }` before `mapDriverError`. Cloned `StoreLeaseLostError` stays non-retryable. | `src/errors.ts` `reconstructStoreError`; `src/errors.test.ts` |
| Bounded `deleteExpired`: per-partition budget + rotating start. | `src/client.ts` `fanOutDeleteExpired`; `partitions.do.test.ts` P17-CLEAN |
| Worker client passes `tableNamespace` on every store RPC; `PaymentsStoreObject` applies it. Mock no longer auto-injects a prefix. | `src/client.ts` `rpcTail`; `src/object/payments-store-object.ts` `readyStores`; `src/test-utils/mock-namespace.ts` |
| Tenant strategy is static `tenantId` or `f(key)`. Isolation test uses **one** namespace; shard names `tenant:acme` vs `tenant:globex`. | `src/sharding.ts`; `partitions.do.test.ts` |
| Every `sql.exec` in `bindHashPartitionLayout` is `.toArray()` inside `transactionSync`. | `src/object/payments-store-object.ts`; `src/object/bind-hash-layout.test.ts` |

### Stream C — Phase 18 honesty (`P18-TREE`, `P18-LIBSQL`, matrix `P18-STALE`)

Files only: `docs/adapter-selection.md`, `docs/adapter-capability-matrix.json`, `packages/testkit/src/storage/adapter-selection-matrix.ts` (+ test), `scripts/check-adapter-selection-honesty.test.ts`.

| Change | Where |
| ------ | ----- |
| After Q1 no-postgres: Workers → D1 (shared / greenfield) **or** DO (per-key, including already on D1). Never `store-sqlite`. Ephemeral FS refuse. Fail-closed STOP covers multi-isolate + only local file. Mermaid and numbered Q&A match. | `docs/adapter-selection.md` §3.1–3.2; honesty tests |
| `turso-libsql` `distributed` is `yes-remote-local-file-single-host`; limitation: remote multi-host; local `file:` is single-host testing only. | matrix TS + JSON + frozen + live honesty tests |
| `turso-serverless` limitation names `@paykernel/store-sqlite`, not `adapter-sqlite`. | matrix TS + JSON + honesty lock |

---

## Per-ID table (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| ID | Verdict | Evidence |
| -- | ------- | -------- |
| **P16-TX** | **CLOSED** | `packages/store-d1/src/executor.ts` L172–176, L232–248: no `transaction()` on live D1; mock-only same-connection hook. `shared.ts` L84–89 throws `StoreUnsupportedFeatureError`. Unit: `stores.unit.test.ts` L714–736 (no `BEGIN` on structural binding). |
| **P16-ALS** | **CLOSED** | `examples/wrangler.toml` L18–19, `smoke/wrangler.toml` L14–15, `docs/wrangler.md` L16 / L77: `compatibility_flags = ["nodejs_compat"]`. ALS import remains (`shared.ts` L5–6) and is documented. |
| **P16-SUCCESS** | **CLOSED** | `executor.ts` L85–109, L195–196: `assertD1Success` before `results ?? []`. `stores.unit.test.ts` L822–869: `success:false` `all()` is `StoreUnavailableError`, not acquired/in_progress. `batch.d1.test.ts` also rejects `success:false` without throw. |
| **P16-SESSION** | **CLOSED** | `executor.ts` L130–139, L182–186: omitted session → `"first-primary"` when `withSession` exists. `migrate.ts` L50–54 wraps raw bindings the same way. `sessions.d1.test.ts` L167–226: PaymentStores / executor / migrate defaults + `session: false` opt-out. |
| **P17-RPC** | **CLOSED** | `smoke/worker.ts` L75–77; `examples/wrangler.toml` L85–87; `src/rpc.ts` L40–48. `client.rpc.test.ts` L47–88: thin stub with only `reserveIdempotency` → `TypeError` / `missing RPC method: bindHashPartitionLayout`. |
| **P17-ERR** | **CLOSED** | `errors.ts` L124–162 reconstructs from `name` / `__pkStoreError`; L300–306 `withMappedErrors` reconstructs **before** `mapDriverError`. `errors.test.ts` L66–83: cloned `{ name: StoreLeaseLostError }` is `StoreLeaseLostError`, not `StoreUnavailableError`; `retryable: false`. |
| **P17-CLEAN** | **CLOSED** | `client.ts` L270–322: rotating `cleanupCursor` + per-partition budget. `partitions.do.test.ts` L499–528: two hash partitions, part 0 has more than `limit` eligible rows, later partitions are not starved. |
| **P17-NS** | **CLOSED** | `client.ts` L146–148, L330–336 `rpcTail`; `payments-store-object.ts` L185–196 applies Worker-sent namespace. `mock-namespace.ts` L17–20 / L62: no auto-inject. `client.rpc.test.ts` L92–110. |
| **P17-TENANT** | **CLOSED** | `sharding.ts` L11–13, L59–64, L73–77: static string or `f(key)`; Worker path never sets `input.tenantId`. `client.ts` L333–335 `shard(key)` only. `partitions.do.test.ts` L109–154: **one** namespace, `tenant:acme` vs `tenant:globex`, same key isolated. |
| **P17-CURSOR** | **CLOSED** | `payments-store-object.ts` L219–239: `transactionSync` + `.toArray()` on CREATE / SELECT / INSERT. `bind-hash-layout.test.ts` L45–51. |
| **P18-TREE** | **CLOSED** | `docs/adapter-selection.md` L84–87, L120–127, L147: Workers → D1 or DO (already-on-D1 can still reach DO); never `store-sqlite`; ephemeral FS refuse; fail-closed STOP. Honesty: `scripts/check-adapter-selection-honesty.test.ts` L386–481. |
| **P18-LIBSQL** | **CLOSED** | `adapter-selection-matrix.ts` L31–35, L256–274: `distributed: "yes-remote-local-file-single-host"`. JSON twin `docs/adapter-capability-matrix.json` L148–165. Frozen test L150–161. Guide table L55. |
| **P18-STALE** | **CLOSED** (matrix + D1/DO comparison docs) | Serverless limitation `@paykernel/store-sqlite` (`adapter-selection-matrix.ts` L252–253; honesty L280–287). D1 overview comparison uses `@paykernel/store-*` (`packages/store-d1/docs/overview.md` L30–34). Historical gate reports still say `adapter-*` — non-blocking. |

**Gate on listed blockers: PASS** (source + ID tests).  
**Independent typecheck: PASS.**  
**Independent targeted tests: 238 pass / 4 fail** — restart file-DB I/O only (see remaining nits).

---

## Independent command re-runs (this gate)

```text
# Tooling
bun run typecheck
→ exit 0 (all workspace packages, including store-d1 + store-durable-objects)

# Targeted Phase 16–18
bun test packages/store-d1 packages/store-durable-objects \
  packages/testkit/src/storage/adapter-selection-matrix.test.ts \
  scripts/check-adapter-selection-honesty.test.ts
→ 238 pass, 4 fail, 2677 expects, 242 tests / 27 files

# The 4 fails (not listed IDs)
packages/store-d1/src/restart.d1.test.ts
  (fail) lease survives process-like reopen …
  (fail) store B completes with lease token from store A …
packages/store-durable-objects/src/restart.do.test.ts
  (fail) completed idempotency record survives reopen
  (fail) FakeClock reclaim after simulated restart
→ SQLITE_IOERR_WRITE (errno 778) during migrate on file: $TMPDIR/*.db
→ same host cannot writeFileSync(/tmp/…): Unknown system error -122

# ID-specific tests inside the same run (all pass)
P16-TX / withTransaction honesty, P16-SUCCESS, P16-SESSION,
P17-RPC thin wrapper, P17-ERR clone reconstruct, P17-CLEAN,
P17-NS, P17-TENANT one-namespace, P17-CURSOR,
honesty P18-TREE / P18-LIBSQL / P18-STALE
```

Not re-run this pass: `bun run typecheck:types`, full `bun test packages/core packages/testkit …`, coverage, `validate:package`, `check:boundaries`, `check:runtime-portability`.

---

## Remaining nits

1. **Verify residual — file-backed restart tests vs `/tmp`.** Four tests use `mkdtempSync(tmpdir())` + bun:sqlite file DBs. This environment rejects writes to `/tmp` (errno `-122`); SQLite surfaces `SQLITE_IOERR_WRITE`. Isolated re-run of the two files is 0/4. In-memory mock D1/DO suites (concurrency, conformance, claims) passed. Not a listed P16–P18 hole.

2. **ALS still imported.** `node:async_hooks` remains for `withTransaction` isolation. Wrangler examples now set `nodejs_compat`. A Worker that copies only `compatibility_date` and omits the flag still fails at module load.

3. **`DoShardInput.tenantId` still exists** for standalone `resolveDoShardName`. Worker `createDoPaymentStores` never sets it (`shard(key)`). Documented; not a silent router.

4. **`hash partitions = 1`** is a single partition (hot-key risk), not a silent global DO. Documented in `sharding.ts`; no `kind: "global"`.

5. **Optional alarms are not auto-wired to `failWebhook`.** Pull-only recovery (`listRetryable`). Wrangler sketch comment: do not auto-wire alarms. Workflow-allowed non-blocker.

6. **Historical `adapter-*` labels** remain in Phase 12–18 gate reports, some sibling adapter overviews, `docs/monorepo.md` test script names (`test:adapter-cloudflare-d1`), and `packages/store-d1/smoke/worker.ts` header (`payments-adapter-cloudflare-d1`). Workflow-allowed leftover.

7. **`store-d1` CHANGELOG** was not given a P16-* Unreleased bullet (DO CHANGELOG was). Docs/manifest carry the honesty.

8. **libSQL `coordinationScope` stays `multi-host`** on the shared Turso manifest. Honesty is the matrix `distributed` cell + limitation phrase, not a second live manifest.

9. **Working tree uncommitted** vs `4c4df82`. Baseline `public-api.md` / `package-contents.md` were **not** regenerated this pass.

10. **Deno smoke / live D1/DO bindings** not exercised (env-gated skips remain OK).

---

## Checklist (gate)

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Three streams recorded with owned files
- [x] P16-TX / ALS / SUCCESS / SESSION closed in source
- [x] P17-RPC / ERR / CLEAN / NS / TENANT / CURSOR closed in source
- [x] P18-TREE / LIBSQL / STALE closed in matrix + guide (+ D1/DO comparison docs)
- [x] `bun run typecheck` green
- [x] ID-specific + honesty tests green
- [ ] Targeted suite 0-fail (4 `/tmp` restart I/O fails remain in this environment)
- [ ] `typecheck:types` / full safety net / `validate:package` re-run
- [ ] Working tree committed

---

## Verdict

**PASS** — listed Phase 16–18 blockers are gone with file:line evidence. Production D1 no longer issues live `BEGIN IMMEDIATE`; examples enable `nodejs_compat`; failed D1 statements are not claim misses; executor/migrate default first-primary. Official DO smoke/example forward `bindHashPartitionLayout`; cloned `StoreLeaseLostError` is reconstructed; bounded cleanup rotates; namespace and tenant honesty hold; layout cursors are consumed. Decision tree refuses Workers → `store-sqlite`; libSQL is not a flat multi-host yes; stale `adapter-sqlite` matrix wording is gone.

Typecheck green. Targeted tests 238/4 — the four fails are `/tmp` file-DB I/O, not the blocker list. No further source fix required for the listed IDs.

```json
{
  "pass": true,
  "blocking": [],
  "non_blocking": [
    "4 file-backed restart tests fail with SQLITE_IOERR_WRITE because this environment cannot write /tmp (errno -122); not listed P16-P18 IDs",
    "ALS import remains; examples now set nodejs_compat",
    "DoShardInput.tenantId still exists for standalone resolveDoShardName; Worker path never sets it",
    "Optional alarms not auto-wired to failWebhook (pull-only)",
    "Historical adapter-* labels remain in old gate reports and some monorepo script names",
    "store-d1 CHANGELOG has no P16-* Unreleased bullets",
    "Working tree uncommitted vs 4c4df82; typecheck:types / full suite / validate:package not re-run"
  ],
  "checklist": [
    "P16-TX CLOSED",
    "P16-ALS CLOSED",
    "P16-SUCCESS CLOSED",
    "P16-SESSION CLOSED",
    "P17-RPC CLOSED",
    "P17-ERR CLOSED",
    "P17-CLEAN CLOSED",
    "P17-NS CLOSED",
    "P17-TENANT CLOSED",
    "P17-CURSOR CLOSED",
    "P18-TREE CLOSED",
    "P18-LIBSQL CLOSED",
    "P18-STALE CLOSED",
    "typecheck PASS",
    "ID + honesty tests PASS",
    "targeted suite 238 pass / 4 env fail (restart file DBs)"
  ],
  "summary": "Phase 16-18 fix-gate PASS on listed blockers: typecheck green; D1 live TX omitted (StoreUnsupportedFeatureError), nodejs_compat on examples, query throws on success:false, executor/migrate default first-primary; DO smoke+example forward bindHashPartitionLayout, cloned StoreLeaseLostError reconstructed, rotating deleteExpired, tableNamespace sent, one-namespace tenant isolation, cursors consumed; Workers tree never store-sqlite, libSQL not flat yes, adapter-sqlite matrix wording gone. Targeted 238 pass / 4 fail (tmpdir write denied). Working tree uncommitted.",
  "report_path": "packages/core/docs/baseline/phase-16-18-fix-gate-report.md"
}
```
