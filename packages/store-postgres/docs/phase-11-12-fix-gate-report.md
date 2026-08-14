# Phase 11–12 fix-gate report (pointer)

**Package:** `@paykernel/store-postgres`  
**Date (UTC):** 2026-08-14  
**Verdict:** **PASS** (see canonical report)

This adapter docs dir is the Phase 12 home. The Phase 11–12 fix-gate spans `@paykernel/sql-foundation` plus later SQL adapters, so the full critic / four-stream / verify / gate write-up lives once under the foundation:

**Canonical report:** [`packages/sql-foundation/docs/phase-11-12-fix-gate-report.md`](../../sql-foundation/docs/phase-11-12-fix-gate-report.md)

Adapter-owned stream B files: `src/stores/idempotency-store.ts`, `webhook-inbox-store.ts`, `reconciliation-store.ts`, `stores.unit.test.ts`. Honesty edits: `docs/overview.md`, `migrations.md`, `drivers.md`, `guarantees.md`, `README.md`.
