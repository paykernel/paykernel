# Phase 19 gate report (`@paykernel/reconciliation`)

**Verdict:** **PASS** (adversarial, fail-closed)  
**Date (UTC):** 2026-08-04

Full adversarial baseline report:

→ **[`packages/core/docs/baseline/phase-19-gate-report.md`](../../core/docs/baseline/phase-19-gate-report.md)**

## Package-local evidence summary

| Claim | Evidence in this package |
| ----- | ------------------------ |
| Portable + core-only | `package.json` `paymentsSdk.portable: true`; deps = `@paykernel/core` only |
| Types 19.1–19.3 | `src/types.ts` + `src/types.test.ts` |
| Safe lookup 19.4 | `src/lookup.ts` + `src/lookup.test.ts` (order, multi-match, unavailable) |
| Policy 19.5 | `src/policy.ts` + `src/policy.test.ts` (decision-only) |
| Scheduler 19.6 | `src/scheduler.ts` + `src/scheduler.test.ts` (schedule/claim/complete/backoff/maxAttempts) |
| Batch 19.7 | `src/reconciler.ts` + `src/batch.test.ts` |
| A4 no duplicate charges | `src/no-duplicate-charge.test.ts` |
| Dual store ownership | `src/store.ts` + `src/store.assignability.test.ts` (no testkit import) |
| Secrets sanitized | `src/sanitize.ts` + `src/sanitize.test.ts` |
| Docs | `docs/overview.md`, `safe-lookup.md`, `scheduling.md`, `batch.md`, `crash-boundaries.md`, `reconciliation.md` |
| Dist | `dist/index.js` + declaration files |

Independent recon tests this gate: **66 pass, 0 fail**.

Monorepo safety net this gate: **1699 pass, 15 skip, 0 fail**.
