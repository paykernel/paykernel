# Phase 9 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/testkit/docs/phase-9-gate-report.md`](../../../testkit/docs/phase-9-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 9 store contracts and adapter manifests are **complete and green**. Independent adversarial review re-ran tests, typecheck, coverage, build, boundaries, portability, package validation, focused storage conformance, and logical anti-bug probes.

| Area | Result |
| --- | --- |
| Tests | **1125 pass, 0 fail** (`bun test packages/core packages/testkit`) |
| Coverage (core) | **99.51% funcs / 98.60% lines** |
| Conformance (memory) | **14 / 12 / 14** (idempotency / webhook / recon) |
| typecheck / typecheck:types | exit 0 |
| build + dist | exit 0; testkit dist exports manifest + memory stores |
| boundaries / portability / validate:package | all OK (Deno smoke SKIP, non-blocking) |
| A1–A5 | **PASS** (see primary report) |
| 9.1–9.5 deliverables | **PASS** |
| Core 0.x `IdempotencyStore` | Unchanged (get/set/delete/optional reserve); distinct from testkit lease-aware API |
| core → testkit dep | **none** |
| adapter-\* packages | **absent** (Phase 10 webhooks present as domain engine, not an adapter) |
| Blocking issues | **none** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Atomicity + stale-worker behavior precise | **PASS** |
| A2 | Non-atomic get/set cannot claim correctness | **PASS** |
| A3 | Machine-readable adapter guarantees + docs | **PASS** |
| A4 | Indeterminate blocks mutation replay | **PASS** |
| A5 | Renew without allowing stale completion | **PASS** |

## Deliverables (short)

| ID | Item | Verdict |
| --- | --- | --- |
| 9.1 | Three store interfaces | **PASS** |
| 9.2 | Lease fields | **PASS** |
| 9.3 | Dual fencing (generation + leaseToken) | **PASS** |
| 9.4 | StoreErrorCode taxonomy | **PASS** |
| 9.5 | StorageAdapterManifest + MEMORY\_\* | **PASS** |

## Key paths

- Contracts: `packages/testkit/src/storage/contracts.ts`
- Manifest: `packages/testkit/src/storage/adapter-manifest.ts`
- Memory stores: `packages/testkit/src/memory/memory-stores.ts`
- Docs: `packages/testkit/docs/store-contracts.md`
- Core 0.x idempotency: `packages/core/src/utils/idempotency.ts`

## Summary

Phase 9 **PASS**. See primary report for full command evidence, anti-bug probes, and checklist.
