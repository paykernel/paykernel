# Phase 19 adversarial gate report (baseline)

**Date (UTC):** 2026-08-04  
**Gate kind:** Final adversarial re-gate (fail-closed)  
**Scope:** `@paykernel/reconciliation` — portable reconciliation primitives + durable store-backed scheduling  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> Primary package: [`packages/reconciliation`](../../../reconciliation/)  
> Package report twin: [`packages/reconciliation/docs/phase-19-gate-report.md`](../../../reconciliation/docs/phase-19-gate-report.md)  
> Docs: [overview](../../../reconciliation/docs/overview.md) · [safe-lookup](../../../reconciliation/docs/safe-lookup.md) · [scheduling](../../../reconciliation/docs/scheduling.md) · [batch](../../../reconciliation/docs/batch.md) · [crash-boundaries](../../../reconciliation/docs/crash-boundaries.md)

---

## Verdict summary

Phase 19 **Reconciliation Primitives and Durable Scheduling** is **complete and green**. Independent adversarial re-verification confirms:

| Area | Independent result |
| ---- | ------------------ |
| Package tests (Phase 0–19 safety net) | **1699 pass, 15 skip, 0 fail** (1714 tests / 131 files) |
| Reconciliation package alone | **66 pass, 0 fail** (12 files) |
| typecheck (all workspace packages) | **OK** (exit 0) |
| check:boundaries | **OK** |
| check:runtime-portability | **OK** |
| Core coverage | **99.51% funcs / 98.60% lines** |
| Reconciliation build + dist types | **OK** (`index.js` + `.d.ts` for public modules) |
| `@paykernel/reconciliation` portable + core-only dep | **PASS** (`paymentsSdk.portable: true`; deps = core only) |
| Phase 20 observability package | **absent** (no sneak-in) |
| Blocking issues | **0** |

Implementer summary claims (`ok=true`, failures `[]`, 1699 tests, core 98.6% lines, typecheck/boundaries/portability/build green) match independent re-runs. `validate:package` (core pack/publint/attw smoke) was **not** re-run in this gate session (non-blocking; not in required re-run list).

---

## Acceptance criteria (roadmap Phase 19)

| ID | Criterion | Verdict | Evidence |
| -- | --------- | ------- | -------- |
| **A1** | Indeterminate operations can be checked safely | **PASS** | Ordered lookup never invents paid/failed; `temporarily_unavailable` / `provider_not_found` (retryable) / `ambiguous_match` / `manual_review_required` outcomes; policy maps indeterminate+paid → `update_local_to_paid` only after verified snapshot; indeterminate+definitive failed only for `failed`/`cancelled`; `temporarily_unavailable` → `retry_later` not `update_local_to_failed`. Tests: `lookup.test.ts`, `policy.test.ts`, `no-duplicate-charge.test.ts` |
| **A2** | Differences are machine-readable | **PASS** | `ReconciliationDifference.field` paths (`status`, `amount`, `capturedAmount`, `refundedAmount`, `gatewayPaymentId`); `drift_detected` carries `differences[]`. Tests: `compare.test.ts` (A2), `lookup.test.ts` compare path, `types.test.ts` |
| **A3** | Durable scheduling works through supported stores without a mandatory queue | **PASS** | `createReconciliationScheduler` over `ReconciliationStore` (`schedule` / `listDue` / `claim` / `complete` / `fail` / `markManualReview`); exponential backoff + jitter; `maxAttempts` → manual review; dead-letter via `listDeadLetter`; docs `scheduling.md` / `crash-boundaries.md`. Tests: `scheduler.test.ts` (A3). No Redis/queue package dep |
| **A4** | Reconciliation never creates duplicate charges | **PASS** | No `createPayment` / capture / refund / void on reconciler or package root; `do_not_create_replacement` + `shouldForbidReplacementCharge` for ambiguous / indeterminate; reconciler does not mutate local payment store. Tests: `no-duplicate-charge.test.ts` (A4) |

---

## Roadmap 19.1–19.7 surface

| Item | Required | Evidence | Verdict |
| ---- | -------- | -------- | ------- |
| **19.1** `ReconciliationTarget` | gateway + optional keys + expected | `src/types.ts` exact shape; builders omit undefined optionals | **PASS** |
| **19.2** `ProviderPaymentSnapshot` | gatewayPaymentId, status, amount, providerStatus, optionals | `src/types.ts` | **PASS** |
| **19.3** `ReconciliationResult` discriminants | `consistent` \| `drift_detected` \| `provider_not_found` \| `temporarily_unavailable` \| `ambiguous_match` \| `manual_review_required` | Exact union in `types.ts`; `types.test.ts` | **PASS** |
| **19.4** Safe lookup order | payment id → idempotency → local ref → request id; multi-match never silent | `lookup.ts` step order; multi → `ambiguous_match`; tests | **PASS** |
| **19.5** Policy helpers | decisions only, not mutations | `policy.ts`; no payment APIs; tests | **PASS** |
| **19.6** Durable scheduling | store-backed; backoff; max attempts; manual review; dead-letter; per-gateway concurrency option | `scheduler.ts` + `backoff.ts`; docs | **PASS** |
| **19.7** Batch | `reconcileMany` with concurrency | `reconciler.ts` mapPool; `batch.test.ts` | **PASS** |

---

## Package / monorepo constraints

| Constraint | Evidence | Verdict |
| ---------- | -------- | ------- |
| Package name `@paykernel/reconciliation` | `packages/reconciliation/package.json` | **PASS** |
| Portable (`paymentsSdk.portable: true`) | package.json + no `node:` / driver imports in `src` | **PASS** |
| Production dep = core only | `dependencies: { "@paykernel/core": "workspace:*" }` | **PASS** |
| No reconciliation → testkit production dep | package.json + boundaries rules `a/reconciliation-no-testkit` | **PASS** |
| Dual ownership `ReconciliationStore` | Domain `store.ts` + testkit memory/conformance; `store.assignability.test.ts` + `testkit/src/reconciliation-memory-integration.test.ts` | **PASS** |
| Memory store not public export | `public-api.test.ts`; `index.ts` comment | **PASS** |
| Core / webhooks must not depend on reconciliation | boundaries matrix + green `check:boundaries` | **PASS** |
| Testkit may depend on reconciliation | testkit `package.json` lists recon | **PASS** (allowed direction) |
| Root scripts include recon | root `build` / `typecheck` / `test` workspaces | **PASS** |
| Dist + types present | `dist/index.js`, `dist/index.d.ts`, module `.d.ts` | **PASS** |
| Docs present | overview, safe-lookup, scheduling, batch, crash-boundaries, reconciliation | **PASS** |
| No Phase 20 observability package | no `packages/observability` / diagnostics / otel | **PASS** |

---

## Logical anti-bug checklist

| Risk | Evidence it does **not** happen | Verdict |
| ---- | -------------------------------- | ------- |
| Silent multi-match (pick first) | `snapshots.length > 1` → `ambiguous_match` immediately | **PASS** |
| Auto-mutate local payments | Policy returns decisions; reconciler only lookup/compare | **PASS** |
| Require Redis / mandatory queue | Store interface + memory tests; no queue client deps | **PASS** |
| Convert indeterminate → failed without definitive data | Unavailable/error → `temporarily_unavailable`; policy → `retry_later`; failed only for definitive provider statuses | **PASS** |
| Secrets in errors / notes | `sanitizeReconciliationError` on fail/manual review notes; `sanitize.test.ts` | **PASS** |
| createPayment replacement while indeterminate | A4 tests + `do_not_create_replacement` | **PASS** |

---

## Independent command re-runs (this gate)

```text
# Safety net (required)
bun test packages/core packages/testkit packages/webhooks packages/reconciliation \
  internal/sql-store packages/store-postgres packages/store-redis \
  packages/store-sqlite packages/store-turso packages/store-d1 \
  packages/store-durable-objects
→ 1699 pass, 15 skip, 0 fail  (1714 tests / 131 files)

# Reconciliation only
bun test packages/reconciliation
→ 66 pass, 0 fail

# Typecheck + boundaries (required)
bun run typecheck
→ exit 0 (all 11 workspace packages)

bun run check:boundaries
→ workspace boundaries OK

# Portability
bun run check:runtime-portability
→ runtime portability OK

# Coverage (core)
bun test --coverage packages/core
→ All files | 99.51% funcs | 98.60% lines | 1000 pass

# Build recon
bun run --filter @paykernel/reconciliation build
→ exit 0 (index.js + declaration emit)
```

Skipped this session (non-blocking): full monorepo `bun run build` for every adapter, `validate:package` (core pack/publint/attw/consumer smoke).

---

## Blocking / non-blocking

**Blocking:** none.

**Non-blocking:**

1. `validate:package` not independently re-run in this gate session (implementer claimed green; core typecheck/tests/dist verified separately).
2. Full multi-package `bun run build` not re-run for every adapter (reconciliation build + existing dist trees verified).

---

## Checklist (adversarial)

- [x] A1 indeterminate safe check
- [x] A2 machine-readable differences
- [x] A3 store-backed scheduling without mandatory queue
- [x] A4 never create duplicate charges
- [x] Types 19.1–19.3 exact discriminants
- [x] Safe lookup order 19.4; multi-match not silent
- [x] Policy 19.5 decisions only
- [x] Scheduler 19.6 backoff / maxAttempts / manual review
- [x] Batch 19.7 `reconcileMany` concurrency
- [x] Portable package; core-only production dep
- [x] Dual store ownership; no recon→testkit prod dep
- [x] Phase 0–18 safety net still green (1699)
- [x] No Phase 20 observability sneak-in
- [x] No silent multi-match / auto-mutate / Redis-required / indeterminate→failed / secrets-in-errors
- [x] Independent tests + typecheck + boundaries green
- [x] Gate reports written (baseline + package + root pointer)

---

## Report paths

| Path | Role |
| ---- | ---- |
| `packages/core/docs/baseline/phase-19-gate-report.md` | **Canonical baseline** (this file) |
| `packages/reconciliation/docs/phase-19-gate-report.md` | Package-local twin / pointer |
| `docs/phase-19-gate-report.md` | Root pointer |
