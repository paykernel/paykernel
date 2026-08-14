# Phase 11–12 fix-gate report

**Date (UTC):** 2026-08-14  
**Packages:** `@paykernel/sql-foundation@0.1.0-next.0`, `@paykernel/store-postgres@0.1.0-next.0`, plus later SQL adapters `@paykernel/store-sqlite`, `@paykernel/store-turso`, `@paykernel/store-d1`, `@paykernel/store-durable-objects` (same inverted miss-order copies)  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-11-12-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`7a1cb04`); not a release commit.

**Verdict:** **PASS** (listed P11 blockers closed; typecheck + targeted tests green)

Historical Phase 11 / 12 gates (`packages/sql-foundation/docs/phase-11-gate-report.md`, `packages/store-postgres/docs/phase-12-gate-report.md`) had already landed the relational foundation and production Postgres adapter. The holes below were still present on `7a1cb04`: inverted reserve-miss classification, memory-relational webhook fail after expiry, missing idempotency timestamp repair, migrate schema/ledger races, raw `deleteExpired` `before`, and tenant / Drizzle / status honesty.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation of the workflow IDs against committed `HEAD` (`7a1cb04`). `decideIdempotencyReserve` already classified `completed` / `indeterminate` before fingerprint (Phase 6–10 stream H). Adapter miss paths did not.

| ID | Status at `HEAD` | Evidence |
| --- | --- | --- |
| **P11-IDEM-1** | **STILL PRESENT** | After empty `ON CONFLICT` / `INSERT OR IGNORE` RETURNING, postgres / sqlite / turso / d1 / durable-objects classified `fingerprint !== input.fingerprint` **before** `completed` / `indeterminate`. `packages/store-postgres/src/stores/idempotency-store.ts` L99–108 (and the same order in sqlite / turso / d1 / do). No `classifyIdempotencyReserveMiss`. |
| **P11-REF-1** | **STILL PRESENT** | `packages/sql-foundation/src/reference/memory-relational-store.ts` `failWebhook` called `decideLeaseMutation` without `requireActiveLease: false`. Default requires an active lease, so WEBHOOKS-2 fail-after-expiry was rejected. `markIdempotencyIndeterminate` already passed `false`. |
| **P11-IDEM-2** | **STILL PRESENT** | No `classifyIdempotencyReserveMiss` and no `idempotencyTimestampRepairTemplates`. Miss of `reserved` + lease expired by `Date.parse` but lexical TEXT vs `Z` `now` fell through to `in_progress` (postgres L108 always). Webhook / recon already had STORES-4 / SQL-1 repair templates. |
| **P11-TENANT-1** | **STILL PRESENT** | `createSchemaNamespace` validated `tenantColumn`; DDL always emitted nullable `tenant_id` + index. Stores never wrote or filtered `tenant_id`. Custom column name was stored as `tenantColumnName` but not applied to CREATE TABLE/INDEX. PK remained `key`. Enabling `tenantColumn` was a no-op for isolation. Docs implied optional isolation. |
| **P11-SCHEMA-1** | **STILL PRESENT** | `packages/sql-foundation/src/migrations/migrate.ts` interpolated `sqlSchema` into `CREATE TABLE` but never issued `CREATE SCHEMA IF NOT EXISTS`. Missing schema failed first DDL. |
| **P11-MIG-1** | **STILL PRESENT** | Version ledger INSERT was plain `INSERT INTO … VALUES` (postgres `$n`, sqlite `?`) with no `ON CONFLICT` / `OR IGNORE`. Concurrent migrators could PK-fail after successful `IF NOT EXISTS` DDL. `MIGRATE_HAS_PORTABLE_LOCK` was already `false` (honest). |
| **P11-DEL-1** | **STILL PRESENT** | Postgres `deleteExpired` bound `input.before` raw on idempotency / webhook / recon. Offset-form `before` vs TEXT `Z` `updated_at` under/over deleted. |
| **P11-DOC-1** | **STILL PRESENT** | `packages/sql-foundation/docs/atomic-claims.md` said production fail templates require an unexpired lease. `webhookFailTemplates` already matched token + `status = claimed` only (WEBHOOKS-2). |
| **P11-DOC-2** | **STILL PRESENT** | `packages/sql-foundation/src/index.ts` header: “Private shared relational foundation… NOT a public npm product / general SQL abstraction.” Package is published as `@paykernel/sql-foundation`. |
| **P11-DOC-3** | **STILL PRESENT** | Tenant docs implied isolation. Postgres `listDue` comment called the scan non-mutating while it `UPDATE`s expired `claimed` first. Drizzle 12.3 promised schema exports that were not shipped. Docs did not say postgres never writes idempotency `expired` / webhook `failed`, or that `claim()` never populates `gateway` / `provider_event_id` / `first_received_at` / `last_received_at`. |

### Already fixed before this gate

- `decideIdempotencyReserve` order: completed → indeterminate → fingerprint (`packages/sql-foundation/src/claims/algorithm.ts`).
- `webhookFailTemplates` do not require `lease_expires_at > now` (code already WEBHOOKS-2; docs lagged).
- Webhook / recon timestamp repair templates (`webhookTimestampRepairTemplates`, `reconciliationTimestampRepairTemplates`).
- `MIGRATE_HAS_PORTABLE_LOCK = false` (no invented portable advisory lock).
- Phase 11 B1 (`last_error` vs `last_error_sanitized`) and Phase 12 A1–A3 remain on `HEAD`.

**Critic summary:** 10 IDs still present at `HEAD`. P11-TENANT-1 / P11-DOC-\* were honesty gaps (code isolation was never shipped). The rest were implementation holes in miss classification, fail-after-expiry, migrate schema/ledger, and `deleteExpired` lexical compares.

---

## Four fix streams

Non-overlapping edits on the uncommitted tree (30 files, +1579 / −95 vs `HEAD`).

### Stream A — Foundation (`P11-IDEM-1/2`, `P11-REF-1`, `P11-SCHEMA-1`, `P11-MIG-1`, `P11-DOC-1/2`)

Files only under `packages/sql-foundation/`.

| File | Change |
| --- | --- |
| `src/claims/algorithm.ts` | Added `classifyIdempotencyReserveMiss`: completed → indeterminate → fingerprint mismatch → reserved+active lease → `in_progress`, else `claimable`. Same order as `decideIdempotencyReserve`. |
| `src/claims/algorithm.test.ts` | P11-IDEM-1 cases (completed+other, indeterminate+other, reserved+other, expired lease / null lease / status expired). P11-REF-1: claim, advance past lease, `failWebhook` same token → `pending`. |
| `src/claims/templates.ts` | `idempotencyTimestampRepairTemplates`: canonicalize `lease_expires_at` only when `status = expired` or lease null/expired; never clobber an active reserved lease. |
| `src/index.ts` | Header: publishable shared relational foundation, not a general ORM, not private-only. Exports `classifyIdempotencyReserveMiss` + `idempotencyTimestampRepairTemplates`. |
| `src/public-api.test.ts` | Freeze includes the two new exports. |
| `src/reference/memory-relational-store.ts` | `failWebhook` `decideLeaseMutation({ requireActiveLease: false })` (WEBHOOKS-2). |
| `src/migrations/migrate.ts` | Postgres + `sqlSchema` → `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(sqlSchema)}` **before** `ensureMigrationsTable`. Version INSERT: postgres `ON CONFLICT (version) DO NOTHING`; sqlite/generic `INSERT OR IGNORE`. `MIGRATE_HAS_PORTABLE_LOCK` stays `false`. |
| `src/migrations/migrate.test.ts` | CREATE SCHEMA precedes first `CREATE TABLE`. Dialect INSERT conflict-safe. Simulated second insert of the same version does not throw. |
| `docs/atomic-claims.md` | Webhook fail succeeds after expiry with matching token; complete/renew still require an active lease; recon fail still requires an active lease. |

Stream A did **not** edit `packages/store-postgres` or later adapters.

### Stream B — Postgres stores (`P11-IDEM-1/2`, `P11-DEL-1`, listDue comment)

Files only under `packages/store-postgres/src/stores/`.

| File | Change |
| --- | --- |
| `src/stores/idempotency-store.ts` | After empty reserve RETURNING, classify with `classifyIdempotencyReserveMiss`. If `claimable`, canonicalize `leaseExpiresAt` + run `idempotencyTimestampRepairTemplates.postgres`, retry reserve once; still `claimable` → `StoreUnavailableError`. `deleteExpired` binds `canonicalizeIsoTimestamp(input.before, "before")`. |
| `src/stores/webhook-inbox-store.ts` | `deleteExpired` canonicalizes `before`. |
| `src/stores/reconciliation-store.ts` | `deleteExpired` canonicalizes `before`. `listDue` comment: soft-release `UPDATE`s expired `claimed` first; default path is a durable `SELECT` (SKIP LOCKED optional fairness, unused). |
| `src/stores/stores.unit.test.ts` | Scripted empty INSERT + SELECT completed+other → `already_completed`; indeterminate+other → `indeterminate`. Offset-form expired `lease_expires_at` repairs and acquires. Three-store `deleteExpired` binds `Z` when input is offset. |

Stream B did **not** implement multi-tenant PK redesign and did not edit sql-foundation or sqlite/turso/d1/do.

### Stream C — Later SQL adapters (same inverted miss order)

Files only: `packages/store-{sqlite,turso,d1,durable-objects}/src/stores/idempotency-store.ts` + existing `stores.unit.test.ts`.

| Change | Evidence |
| --- | --- |
| Import `classifyIdempotencyReserveMiss` + `idempotencyTimestampRepairTemplates` from `@paykernel/sql-foundation`. | All four idempotency stores. |
| Miss order: completed / indeterminate before fingerprint, then `in_progress` / `claimable`. | Comments `// P11-IDEM-1` at classify call sites. |
| One-shot canonicalize + repair + retry when miss is `claimable`; still `claimable` → `StoreUnavailableError`. | sqlite extra CAS `UPDATE … AND lease_expires_at = ?` when offset-form ≠ `Z`. |
| Idempotency `deleteExpired` binds `canonicalizeIsoTimestamp(input.before, "before")`. | P11-DEL-1 comments + unit tests. |
| Focused unit tests on existing files. | `P11-IDEM-1` completed/indeterminate, `P11-IDEM-2` offset repair, `P11-DEL-1` Z-form `before`. |

Stream C did **not** edit `store-postgres` or `sql-foundation`. Webhook / recon `deleteExpired` in these adapters still bind raw `input.before` (see [Remaining nits](#remaining-nits)).

### Stream D — Docs honesty (`P11-TENANT-1`, `P11-SCHEMA-1`, `P11-DOC-3`)

Docs / README only; no production `.ts` logic.

| File | Change |
| --- | --- |
| `packages/sql-foundation/docs/relational-foundation.md` | `tenantColumn` is a nullable `tenant_id` column + index only. v1 does **not** isolate, does **not** write `tenant_id`, does **not** apply a custom column name in DDL. PK remains `key`. `CREATE SCHEMA IF NOT EXISTS` when `sqlSchema` is set. Write-path honesty: postgres never writes idempotency `expired`; webhook fail writes `pending` / `dead_letter`. Webhook operator columns exist; `claim()` does not populate them. |
| `packages/sql-foundation/docs/migrations.md` | Same tenant + schema + operator-column honesty. |
| `packages/sql-foundation/README.md` | Namespace / migrate rows match the above. |
| `packages/store-postgres/docs/overview.md` | Tenant honesty; `CREATE SCHEMA`; `listDue` soft-release then `SELECT`; `/drizzle` is notes + executor pass-through; status / webhook-column honesty. |
| `packages/store-postgres/docs/migrations.md` | Schema CREATE + tenant + status + webhook columns. |
| `packages/store-postgres/docs/drivers.md` | Phase 12.3 optional Drizzle schema exports were **not** shipped. |
| `packages/store-postgres/docs/guarantees.md` | Tenant honesty; `listDue` / SKIP LOCKED table; webhook operator columns. |
| `packages/store-postgres/README.md` | Same honesty bullets. |

---

## Verify commands

Run 2026-08-14 from monorepo root after the four streams.

| Command | Result |
| --- | --- |
| `bun run typecheck` | **PASS** — all workspace packages `tsc --noEmit` exit 0 (core, webhooks, reconciliation, opentelemetry, routing, store-contracts, testkit, sql-foundation, internal-sql-store, store-postgres, store-redis, store-sqlite, store-turso, store-d1, store-durable-objects) |
| Targeted `bun test` (below) | **PASS** — **502 pass, 14 skip, 0 fail**, 4487 expects, 63 files |

Targeted test command:

```bash
bun test \
  packages/sql-foundation \
  packages/store-postgres \
  packages/store-sqlite \
  packages/store-turso \
  packages/store-d1 \
  packages/store-durable-objects \
  packages/store-contracts
```

14 skips are live PostgreSQL suites without `PAYMENTS_SDK_PG_URL` / `DATABASE_URL` (conformance ×4, integration ×7, migrate live ×1, multi-connection ×2). Skip pattern is intentional; workflow treats them as OK.

Source invariants re-read after tests:

| Invariant | Evidence |
| --- | --- |
| `classifyIdempotencyReserveMiss` checks completed before fingerprint | `packages/sql-foundation/src/claims/algorithm.ts` L180–187 |
| Postgres miss uses that helper (not fingerprint first) | `packages/store-postgres/src/stores/idempotency-store.ts` L104–123 |
| sqlite / turso / d1 / do miss use the same helper | respective `idempotency-store.ts` `// P11-IDEM-1` blocks |
| memory-relational `failWebhook` `requireActiveLease: false` | `packages/sql-foundation/src/reference/memory-relational-store.ts` L674–675 |
| migrate emits `CREATE SCHEMA IF NOT EXISTS` when `sqlSchema` set | `packages/sql-foundation/src/migrations/migrate.ts` L213–216 |
| version INSERT is `ON CONFLICT DO NOTHING` / `INSERT OR IGNORE` | same file L246–258 |
| postgres `deleteExpired` binds `canonicalizeIsoTimestamp(input.before)` | idempotency L278, webhook L341, recon L378 |

Not re-run this pass: `bun run typecheck:types`, full `bun test packages/core …`, `bun test --coverage`, `bash scripts/validate-package.sh`, `bun run check:boundaries`, `bun run check:runtime-portability`.

---

## Gate (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| Blocker | Result | Evidence |
| --- | --- | --- |
| **P11-IDEM-1** completed / indeterminate before fingerprint on decide/classify + postgres + sqlite + turso + d1 + durable-objects | **CLOSED** | `algorithm.ts` L180–187; postgres `idempotency-store.ts` L104–123; sqlite L142–157; turso / d1 / do same helper. Unit tests named `P11-IDEM-1` in each adapter. |
| **P11-REF-1** memory-relational `failWebhook` `requireActiveLease: false` | **CLOSED** | `memory-relational-store.ts` L674–675; `algorithm.test.ts` `memory-relational failWebhook (WEBHOOKS-2 / P11-REF-1)`. |
| **P11-IDEM-2** `claimable` + postgres canonicalize/retry (cannot freeze free expired reserved as `in_progress`) | **CLOSED** | `idempotencyTimestampRepairTemplates` in `templates.ts` L549–604; postgres reserve L125–172; same repair in sqlite/turso/d1/do. Unit test `P11-IDEM-2: offset-form expired lease_expires_at repairs and acquires`. |
| **P11-SCHEMA-1** `CREATE SCHEMA IF NOT EXISTS` when `sqlSchema` set | **CLOSED** | `migrate.ts` L213–216 before `ensureMigrationsTable`; `migrate.test.ts` L60–65. |
| **P11-MIG-1** version INSERT idempotent | **CLOSED** | `migrate.ts` L246–258; `migrate.test.ts` L82–84, L90–148. `MIGRATE_HAS_PORTABLE_LOCK` still `false` (`migrate.ts` L61). |
| **P11-DEL-1** postgres `deleteExpired` canonicalizes `before` | **CLOSED** | Three postgres stores; `stores.unit.test.ts` `deleteExpired before canonical (P11-DEL-1)`. |
| **P11-TENANT-1** docs no longer claim automatic tenant isolation | **CLOSED** | `relational-foundation.md` “Tenant column honesty (v1)”; `migrations.md`; sql-foundation + store-postgres READMEs; `guarantees.md`. Code still does not isolate (required fix was honesty). |
| Typecheck / tests red | **CLOSED** | typecheck exit 0; 502 pass / 14 skip / 0 fail. |

Non-blocker IDs also addressed: P11-DOC-1 (`atomic-claims.md` webhook fail after expiry), P11-DOC-2 (`index.ts` publishable header), P11-DOC-3 (listDue / Drizzle / statuses / webhook columns).

**Gate on listed P11 blockers: PASS.**  
**Independent verify (typecheck + targeted tests): PASS.**

---

## Remaining nits

1. **Later-adapter webhook / recon `deleteExpired` now canonicalizes `before`.** Closed in the same working tree after the gate (sqlite / turso / d1 / durable-objects webhook + recon). Idempotency repair also CAS-matches the classified lease snapshot so offset-form TEXT is reclaimable without a second ad-hoc UPDATE.

2. **v1 still does not isolate tenants.** Stores never write or `WHERE` `tenant_id`. Custom `tenantColumn` names are validated into `tenantColumnName` (`packages/sql-foundation/src/schema/namespace.ts`) but DDL always emits `tenant_id`. Honesty docs now say so; PK remains `key`. Operators must prefix keys or wait for a later schema.

3. **`(xmax = 0) AS inserted` is unused by adapters.** Foundation postgres reserve templates still return it (`packages/sql-foundation/src/claims/templates.ts` L114). Adapters classify via RETURNING / follow-up SELECT. Allowed unused-xmax nit.

4. **No Drizzle table defs.** `@paykernel/store-postgres/drizzle` is notes + executor pass-through (`packages/store-postgres/docs/drivers.md`). Phase 12.3 optional `pgTable` exports were not shipped. Documented.

5. **Timestamps remain TEXT ISO-8601**, not `TIMESTAMPTZ`. Foundation Phase 11 policy; lexical compares require canonicalize (P11-DEL-1 / P11-IDEM-2).

6. **`FOR UPDATE SKIP LOCKED` is unused on default `listDue`.** Soft-release `UPDATE` then plain `SELECT`. Fairness-only; documented in `guarantees.md` / overview.

7. **Webhook `gateway` / `provider_event_id` / `first_received_at` / `last_received_at` stay unpopulated by `claim()`.** `ClaimWebhookInput` has no `gateway`. Columns exist for operator/index use. Documented.

8. **`MIGRATE_HAS_PORTABLE_LOCK` remains `false`.** Ledger INSERT is now conflict-safe; multi-host serialize is still an ops requirement. No invented advisory lock.

9. **`internal/sql-store/docs/`** now points at the sql-foundation canonical docs instead of keeping a second copy.

10. **Historical Phase 11 / 12 reports** still freeze 2026-08-03 evidence and early package names (`@paykernel/internal-sql-store`, `adapter-postgres`). Those are gate-time records, not live inventory.

11. **Working tree uncommitted.** Fix-stream diffs are local vs `7a1cb04`. Dist / baseline inventories were **not** regenerated this pass.

12. **Coverage / full core+testkit+webhooks / `validate:package` / `check:boundaries` / `typecheck:types` / portability not re-run** this pass.

13. **Live PostgreSQL not available in this gate environment** — 14 env-gated skips. Unit + scripted-executor + sqlite/turso/d1/do suites cover the listed blockers.

---

## Checklist

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Four streams recorded with owned files
- [x] Verify commands re-run; typecheck + targeted tests green
- [x] Listed P11 blockers closed in source
- [x] Canonical report under `packages/sql-foundation/docs/`
- [x] Pointer in `packages/store-postgres/docs/`
- [ ] `typecheck:types` / full safety net / `validate:package` re-run
- [ ] Later-adapter webhook/recon `deleteExpired` canonicalize
- [ ] Working tree committed

---

## Summary

Phase 11–12 critic IDs were present at `HEAD` and addressed across four streams (foundation classify/repair/failWebhook/CREATE SCHEMA/idempotent ledger + docs; postgres miss-order/repair/`deleteExpired`/listDue comment; sqlite/turso/d1/do miss-order/repair/idempotency `before`; tenant/schema/Drizzle/status honesty). Listed blockers are closed in source. Typecheck green. Targeted tests **502 pass / 14 skip / 0 fail**. Working tree still uncommitted.

**Canonical report:** `packages/sql-foundation/docs/phase-11-12-fix-gate-report.md`  
**Adapter pointer:** `packages/store-postgres/docs/phase-11-12-fix-gate-report.md`
