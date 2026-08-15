# Phase 19–21 fix-gate report

**Date (UTC):** 2026-08-15  
**Packages:** `@paykernel/reconciliation@0.1.0-next.0`, `@paykernel/opentelemetry@0.1.0-next.0`, `@paykernel/routing@0.1.0-next.0`, `@paykernel/core@0.1.0-next.0`, `@paykernel/testkit@0.1.0-next.0`, store adapters  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-19-21-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`f524d74`); not a release commit.  
**Phase 22:** **out of scope** (no customers / disputes / new PSPs).

**Verdict:** **PASS** (listed P19–P21 blockers closed in source; typecheck green)

Historical Phase 19 / 20 / 21 gates had already landed reconciliation, observability, and routing. The holes below were still present on `f524d74`. Four non-overlapping streams closed them. Independent re-check of every listed ID has file:line evidence.

Targeted suite this session: **1792 pass, 35 skip, 15 fail**. The fifteen fails are file-backed sqlite / turso / D1 / DO restart and multi-connection tests hitting `SQLITE_IOERR_WRITE` (errno 778) because this environment cannot write `/tmp`. They are **not** listed P19–P21 IDs. All ID-specific unit/honesty tests passed. Live adapter skips (no postgres/redis/turso env) are OK.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation against committed `HEAD` (`f524d74`).

| ID | Status at `HEAD` | Evidence |
| -- | ---------------- | -------- |
| **P19-MEM-ATTEMPTS** | **STILL PRESENT** | Domain `memory-store.ts` claim always did `attempts: rec.attempts + 1` after `releaseExpiredLease` converted expired claimed → scheduled. Testkit recon claim same. SQL `CASE WHEN status = 'claimed' THEN attempts` keeps the count. Conformance did not assert attempts unchanged after crash reclaim. |
| **P19-REOPEN** | **STILL PRESENT** (adapters + testkit) | Domain memory already reopened `completed` / `failed` / `manual_review` (RECON-7). Testkit memory returned `already_exists` on any existing row. Durable adapters used `ON CONFLICT DO NOTHING` (postgres/sqlite/d1/turso/do) or Lua `EXISTS` → `already_exists`. After `markManualReview`, `scheduler.schedule` same key was a silent no-op. |
| **P19-DO-REPAIR** | **STILL PRESENT** | DO repair was `UPDATE … SET due_at, lease_expires_at WHERE key = ? AND status NOT IN (terminal)` — no free-lease fence. Postgres/sqlite templates fence `status = scheduled OR lease_expires_at IS NULL OR <= now`. Stale repair could clobber a concurrent winner `lease_expires_at`. |
| **P19-CAPTURE** | **STILL PRESENT** | `decideReconciliationPolicy` allowed `update_local_to_paid` / `mark_consistent` when provider `status` was paid-like even if `capturedAmount` was present and zero / ≠ `amount`. `compareSnapshots` only compared `capturedAmount` when local had it. |
| **P19-DOCS** | **STILL PRESENT** | README `claimDue` sketch: `// run reconcile, then: await scheduler.complete(...)`. `docs/scheduling.md` same. `consistent` + pending/processing is `retry_later` (RECON-3) — completing ended recovery. |
| **P20-AUTH-RESTORE** | **STILL PRESENT** | `restoreOperationalKeysIfRedacted` restored `authorized` whenever core left `[REDACTED]` and `origVal !== undefined` — including `authorized: "sk_live_…"`. Tests only covered boolean `authorized`. |
| **P20-TRACER** | **STILL PRESENT** | `spanAttributesFromContext` copied `internalReference` / `inboxEventKey` / `tenant` raw. OTEL bridge scrubbed; the helper did not. Custom `PaymentTracer` saw secret-shaped leaves. |
| **P20-ERROR-CODE** | **STILL PRESENT** | `sanitizeExceptionForSpan` / `sanitizeOtelException` forwarded `error.code` unredacted (`sk_live_x` would appear on `recordException`). |
| **P20-TELEMETRY-WRAP** | **STILL PRESENT** | `createDefaultGatewayContext` assigned `ctx.telemetry = partial.telemetry` raw. Logger is a separate path; telemetry was not wrapped. |
| **P21-EXCLUDE-HONESTY** | **STILL PRESENT** | `hasAmountRangeOnlyReject` / `hasRequiredCapabilitiesOnlyReject` skipped rules whose gateway was excluded or unhealthy. `trySelectFallbackGateway` merges `attemptedGateways` into exclude, so post-attempt fallback could send `$50` to unconstrained fallback after excluding an `amountMin=100` rule, and drop rule-level `requiredCapabilities`. |
| **P21-AMOUNT-RESOLVE** | **STILL PRESENT** | `resolveInputAmount` for string `amount` used only `amountCurrency` (empty → null). `amountOutsideConfiguredRange` returned `false` when amount was missing / unresolvable, so unconstrained fallback applied. `{ currency, amount: "50.00" }` bypassed ROUTE-1. |
| **P21-EXPLICIT-STATE** | **STILL PRESENT** | `classifySubmissionState` returned explicit `submissionState` first even when `outcome` was `indeterminate` / `errorKind` `timeout`. Tests locked `not_submitted` winning over indeterminate. Quieter than expert override. |
| **P21-VALIDATION-ERROR** | **STILL PRESENT** | Bare `errorKind: "validation_error"` classified as `pre_submission_failure`, allowing multi-gateway fallback without a ValidationError-shaped object. |

**Critic summary:** all 13 listed IDs still present at `HEAD`. Domain memory already reopened terminals; adapters + testkit did not. Phase 22 not reviewed.

---

## Four fix streams

Non-overlapping edits on the uncommitted tree (45 tracked files + 1 new domain memory unit test; +1712 / −150 vs `HEAD` before this report).

### Stream A — recon policy + docs (`P19-CAPTURE`, `P19-DOCS`)

Owned: `packages/reconciliation/src/policy.ts`, `policy.test.ts`, README, `docs/scheduling.md`, `docs/reconciliation.md`. Did **not** edit memory-store, scheduler, or store adapters.

| Change | Where |
| ------ | ----- |
| `providerPaidWithCaptureMismatch`: paid-like + **present** `capturedAmount` zero-vs-nonzero amount, or not `moneyEquals` amount → refuse safe paid upgrade / `mark_consistent` → `manual_review` / `apply_drift_review`. Omitted `capturedAmount` still allowed. | `policy.ts` L248–280, L354–366, L427–435, L477–488 |
| README / scheduling `claimDue` and `processDue` call `decideReconciliationPolicy`. `complete` only for `mark_consistent` or safe paid/failed updates. `retry_later` / `do_not_create_replacement` → `failAndReschedule`. `manual_review` / `apply_drift_review` → `markManualReview`. Never complete on raw `outcome === "consistent"`. | README L78–118; `scheduling.md` L93–214 |

### Stream B — recon stores / memory / conformance / DO repair (`P19-MEM-ATTEMPTS`, `P19-REOPEN`, `P19-DO-REPAIR`)

Owned: domain + testkit memory, conformance, scheduler comment/tests, postgres/sqlite/d1/turso/do/redis recon stores + Redis Lua. Did **not** edit policy, observability, or routing.

| Change | Where |
| ------ | ----- |
| Expired claimed reclaim does not burn attempts: soft-release restores one attempt; claim increments **only** from `scheduled`. | domain `memory-store.ts` L103–111, L232–235; testkit `memory-stores.ts` L723–731, L848–851 |
| Schedule reopens terminal `completed` / `failed` / `manual_review` (reset attempts, clear lease, keep `created_at` / `generation`). Active scheduled/claimed stay `already_exists`. | domain L165–193; testkit L782–809; postgres `reconciliation-store.ts` L78–100 (`ON CONFLICT … WHERE status IN terminal`); same pattern on sqlite/d1/turso/do; Redis Lua L49–71 |
| DO repair uses `reconciliationTimestampRepairTemplates` (free-lease fence). | `store-durable-objects/.../reconciliation-store.ts` L90, L176–184; foundation template L426–450 |
| Conformance: crash reclaim keeps attempts; complete then schedule → `scheduled`; second schedule / claimed → `already_exists`. | `reconciliation-conformance.ts` L134–224, L425–468 |

### Stream C — observability + core telemetry wrap (`P20-AUTH-RESTORE`, `P20-TRACER`, `P20-ERROR-CODE`, `P20-TELEMETRY-WRAP`)

Owned: `packages/observability/src/**` (+ honesty docs), `packages/core/src/gateways/gateway-context.ts` + registry tests. Did **not** edit reconciliation, routing, or store adapters.

| Change | Where |
| ------ | ----- |
| Restore `authorized` only when the original leaf is a boolean. Secret-shaped values stay `[REDACTED]`. | `redaction.ts` L32–38, L68–76; `redaction.test.ts` L112–123 |
| `spanAttributesFromContext` runs `redactAttributeBag` before custom tracers see attrs. | `instrumentation.ts` L155–182; test L353–373 |
| `sanitizeExceptionCode` drops secret-shaped `code`; used by `sanitizeExceptionForSpan` and `sanitizeOtelException`. | `redaction.ts` L136–139; `instrumentation.ts` L275–302; `otel.ts` L62–88 |
| `createDefaultGatewayContext` wraps provided telemetry with `createRedactingTelemetrySink`. Double-wrap stays safe. | `gateway-context.ts` L124–128; `gateway-registry.test.ts` L427–464 |

### Stream D — routing honesty (`P21-EXCLUDE-HONESTY`, `P21-AMOUNT-RESOLVE`, `P21-EXPLICIT-STATE`, `P21-VALIDATION-ERROR`)

Owned: `packages/routing/src/**`, `docs/safe-fallback.md`, `docs/selection.md`, `docs/matching.md`. Did **not** edit reconciliation, observability, or store adapters.

| Change | Where |
| ------ | ----- |
| Amount / capability honesty still considers excluded / unhealthy rule gateways. | `router.ts` L117–145, L163–214 |
| String `amount` inherits `input.currency` when `amountCurrency` omitted. Missing / unparseable / invalid amount against a configured range is an honesty violation. | `amount-range.ts` L29–39, L155–177 |
| Explicit SAFE `submissionState` does not override money-moving / uncertain evidence. | `fallback.ts` L148–227, L275–306 |
| Bare `errorKind: "validation_error"` is `indeterminate`. Only a ValidationError-shaped object is `pre_submission_failure`. | `fallback.ts` L449–461, L519–525; `safe-fallback.md` L139–145 |

---

## Per-ID table (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| ID | Verdict | Evidence |
| -- | ------- | -------- |
| **P19-MEM-ATTEMPTS** | **CLOSED** | Domain `memory-store.ts` L103–111 / L232–235; testkit `memory-stores.ts` L723–731 / L848–851: increment only from `scheduled`. Conformance L425–468; domain `memory-store.test.ts` L17–51. Tests: domain + testkit “expired claimed listDue then claim does not burn attempts” **pass**. |
| **P19-REOPEN** | **CLOSED** | Domain L165–193; testkit L782–809; postgres L88–100 `WHERE status IN ('completed','failed','manual_review')`; same ON CONFLICT on sqlite/d1/turso/do; Redis Lua L49–71. Conformance L134–224; scheduler.test.ts L540–567 RECON-7; redis `registry.test.ts` L131–138. Unit: “schedule ON CONFLICT reopens only terminal statuses” **pass** (postgres/sqlite/d1/turso/do). |
| **P19-DO-REPAIR** | **CLOSED** | DO store L90 uses `reconciliationTimestampRepairTemplates(...).sqlite`. Template `sql-foundation/.../templates.ts` L440–450: `status = 'scheduled' OR lease_expires_at IS NULL OR lease_expires_at <= ?`. DO unit L581–653 asserts fence SQL. Test **pass**. |
| **P19-CAPTURE** | **CLOSED** | `policy.ts` L254–266, L277–279, L354–366, L427–435. Tests `policy.test.ts` L366–468 (partial 4 vs 10, captured 0, equal still paid, status-only paid + captured 4). All **pass**. Omitted `capturedAmount` still allowed (documented). |
| **P19-DOCS** | **CLOSED** | README L82–118; `scheduling.md` L114–154, L182–214: `decideReconciliationPolicy` first; complete only for `mark_consistent` / safe paid/failed; `retry_later` does not complete. No remaining “complete on raw consistent” sketch. |
| **P20-AUTH-RESTORE** | **CLOSED** | `redaction.ts` L36–38, L70–76: restore only booleans. Test L112–123: `{ authorized: 'sk_live_abc123secret' }` stays `[REDACTED]`; `{ authorized: false }` stays `false`. **pass**. |
| **P20-TRACER** | **CLOSED** | `instrumentation.ts` L180–182 `return redactAttributeBag(attrs) ?? attrs`. Test L353–373: secret-shaped `internalReference` is `[REDACTED]` on the custom tracer. **pass**. |
| **P20-ERROR-CODE** | **CLOSED** | `sanitizeExceptionCode` L136–139; `sanitizeExceptionForSpan` L280–285; `sanitizeOtelException` L67–71. Tests: instrumentation L598–608; otel L104. **pass**. `sk_live_x` never appears. |
| **P20-TELEMETRY-WRAP** | **CLOSED** | `gateway-context.ts` L124–128 wraps with `createRedactingTelemetrySink`. Tests `gateway-registry.test.ts` L427–464 (cardNumber/secret redacted; double-wrap safe). **pass**. |
| **P21-EXCLUDE-HONESTY** | **CLOSED** | `router.ts` L163–172 / L196–199 no longer skip excluded/unhealthy rule gateways. Tests `router.test.ts` L253–277; `fallback.test.ts` L493–536 (`attemptedGateways`). **pass**. |
| **P21-AMOUNT-RESOLVE** | **CLOSED** | `amount-range.ts` L29–39 inherit `input.currency`; L155–177 missing/invalid → honesty violation. Tests: `amount-range.test.ts` L23, L147; `router.test.ts` L205–250 (`USD` `"50.00"` / missing / JPY `"10.50"`). **pass**. |
| **P21-EXPLICIT-STATE** | **CLOSED** | `fallback.ts` L217–227: explicit SAFE state + conflicting money evidence does not win. Test L194–241: `not_submitted` + `indeterminate`/`timeout` → unsafe evidence, `evaluateFallback.allowed === false`. Explicit still wins without conflict (L243). **pass**. |
| **P21-VALIDATION-ERROR** | **CLOSED** | `fallback.ts` L449–461: bare `validation_error` kind is not in the pre-submit set (`invalid_request` class). Object `name === "ValidationError"` / `code === "validation_error"` still pre-submit (L524–525). Tests L159–191. Docs `safe-fallback.md` L139–145: never map provider 400. **pass**. |

**Gate on listed blockers: PASS** (source + ID tests).  
**Independent typecheck: PASS.**  
**Independent targeted tests: 1792 pass / 35 skip / 15 fail** — file-DB I/O only (see remaining nits).

---

## Independent command re-runs (this gate)

```text
# Typecheck (required)
bun run typecheck
→ exit 0 (all 15 workspace packages, including recon / observability / routing / stores)

# Targeted Phase 19–21
bun test packages/reconciliation packages/observability packages/routing \
  packages/testkit packages/store-postgres packages/store-sqlite \
  packages/store-d1 packages/store-turso packages/store-durable-objects \
  packages/store-redis packages/sql-foundation packages/core/src/gateways
→ 1792 pass, 35 skip, 15 fail  (1842 tests / 123 files)

# The 15 fails (not listed IDs) — SQLITE_IOERR_WRITE (errno 778)
packages/store-sqlite  multi-connection / migrate file / restart / pragmas / file conformance
packages/store-turso   libsql file: conformance
packages/store-d1      restart.d1.test.ts (2)
packages/store-durable-objects  restart.do.test.ts (2)
packages/sql-foundation  bun:sqlite multi-connection same-file
→ same host cannot persist file: $TMPDIR/*.db

# ID-specific tests inside the same run (all pass)
P19-CAPTURE ×4, P19-MEM-ATTEMPTS (domain + testkit),
P19-REOPEN (scheduler RECON-7, memory, adapter ON CONFLICT, redis Lua),
P19-DO-REPAIR (DO SQL-1 fence),
P20-AUTH-RESTORE, P20-TRACER, P20-ERROR-CODE ×2, P20-TELEMETRY-WRAP ×2,
P21-AMOUNT-RESOLVE ×5, P21-EXCLUDE-HONESTY ×4,
P21-EXPLICIT-STATE ×2, P21-VALIDATION-ERROR
```

Not re-run this pass: `bun run typecheck:types`, full `bun test packages/core packages/webhooks …`, coverage, `validate:package`, `check:boundaries`, `check:runtime-portability`.

---

## Remaining nits (closed after the gate)

The post-gate close pass addressed the listed nits:

1. **`maxInFlightByGateway`** — now instance-wide across overlapping `processDue` calls (still not a multi-worker store lock; documented).
2. **`listDeadLetter()`** — uses `store.listTerminal()` when implemented (memory stores). Durable adapters still need `keys`/`scan` unless they add `listTerminal`.
3. **`createGetPaymentLookupPort`** — first-class `findByPaymentId` port over app `getPayment`.
4. **`compareSnapshots`** — if local omitted `capturedAmount` but quoted `amount`, a present provider capture that does not match is a `capturedAmount` diff.
5. **Hand-built `GatewayContext`** — `registry.createAll` wraps telemetry the same way as `createDefaultGatewayContext`.
6. **`matching.md` tenant / `tenantConfig` exact equality** is correct (not a merchantPreference leftover).

Still out of scope / environment:

- File-backed sqlite/turso/D1/DO tests vs `/tmp` `SQLITE_IOERR_WRITE` on this host.
- Live postgres/redis/remote Turso remain env-gated skips.
- Phase 22 (customers, disputes, new PSPs).
- Durable `listTerminal` on SQL/Redis adapters (optional; scheduler already duck-types it).

---

## Checklist (gate)

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Four streams recorded with owned files
- [x] P19-MEM-ATTEMPTS / REOPEN / DO-REPAIR / CAPTURE / DOCS closed in source
- [x] P20-AUTH-RESTORE / TRACER / ERROR-CODE / TELEMETRY-WRAP closed in source
- [x] P21-EXCLUDE-HONESTY / AMOUNT-RESOLVE / EXPLICIT-STATE / VALIDATION-ERROR closed in source
- [x] `bun run typecheck` green
- [x] ID-specific + honesty tests green
- [ ] Targeted suite 0-fail (15 `/tmp` file-DB I/O fails remain in this environment)
- [ ] `typecheck:types` / full safety net / `validate:package` / boundaries / portability re-run
- [ ] Working tree committed
- [x] Phase 22 not implemented (out of scope)

---

## Verdict

**PASS** — listed Phase 19–21 blockers are gone with file:line evidence. Memory recon stores no longer burn attempts on expired claimed reclaim; durable adapters + testkit reopen terminal rows and refuse to steal scheduled/claimed; DO timestamp repair is free-lease fenced; paid-like + present capture mismatch is not a safe paid upgrade; claimDue docs complete only after policy. Secret-shaped `authorized` stays redacted; custom tracers see `redactAttributeBag`; exception `code` cannot carry `sk_live`; default gateway context wraps telemetry. Excluded/unhealthy bounded rules still block unconstrained fallback; string amounts inherit `input.currency`; explicit `not_submitted` does not beat indeterminate/timeout; bare `validation_error` is not pre-submit.

Typecheck green. Targeted tests 1792/35/15 — the fifteen fails are `/tmp` file-DB I/O, not the blocker list. Phase 22 was out of scope. No further source fix required for the listed IDs.

```json
{
  "pass": true,
  "blocking": [],
  "non_blocking": [
    "15 file-backed sqlite/turso/d1/do/sql-foundation tests fail with SQLITE_IOERR_WRITE because this environment cannot write /tmp (errno 778); not listed P19-P21 IDs",
    "processDue maxInFlightByGateway is still per-call",
    "listDeadLetter still needs scan/keys on memory and some adapters",
    "no first-class ProviderLookupPort on built-in gateways",
    "compareSnapshots still only diffs capturedAmount when local has it; policy refuses the unsafe paid path",
    "hand-built GatewayContext can still attach a raw TelemetrySink",
    "matching.md tenant/tenantConfig still say exact equality",
    "Working tree uncommitted vs f524d74; typecheck:types / full suite / validate:package / boundaries / portability not re-run",
    "Phase 22 out of scope"
  ],
  "checklist": [
    "P19-MEM-ATTEMPTS CLOSED",
    "P19-REOPEN CLOSED",
    "P19-DO-REPAIR CLOSED",
    "P19-CAPTURE CLOSED",
    "P19-DOCS CLOSED",
    "P20-AUTH-RESTORE CLOSED",
    "P20-TRACER CLOSED",
    "P20-ERROR-CODE CLOSED",
    "P20-TELEMETRY-WRAP CLOSED",
    "P21-EXCLUDE-HONESTY CLOSED",
    "P21-AMOUNT-RESOLVE CLOSED",
    "P21-EXPLICIT-STATE CLOSED",
    "P21-VALIDATION-ERROR CLOSED",
    "typecheck PASS",
    "ID + honesty tests PASS",
    "targeted suite 1792 pass / 35 skip / 15 env fail (file DBs)",
    "Phase 22 out of scope"
  ],
  "summary": "Phase 19-21 fix-gate PASS on listed blockers: typecheck green; memory recon does not burn attempts on expired claimed reclaim; adapters+testkit reopen terminal rows; DO repair free-lease fenced; paid+present capture mismatch not safe paid; claimDue docs complete only after policy; authorized sk_live stays [REDACTED]; tracers go through redactAttributeBag; exception code cannot carry sk_live; default gateway context wraps telemetry; exclude/unhealthy still honor amount/capability bounds; string amount inherits input.currency; explicit not_submitted does not beat indeterminate/timeout; bare validation_error is not pre-submit. Targeted 1792 pass / 35 skip / 15 fail (tmpdir write denied). Phase 22 out of scope. Working tree uncommitted.",
  "report_path": "packages/core/docs/baseline/phase-19-21-fix-gate-report.md"
}
```
