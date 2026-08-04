# Phase 10 adversarial gate report (baseline copy)

**Date (UTC):** 2026-08-03  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/webhooks@0.1.0`, `@paykernel/testkit@0.1.0`  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

> **Primary detailed report:** [`packages/webhooks/docs/phase-10-gate-report.md`](../../../webhooks/docs/phase-10-gate-report.md)  
> This baseline copy mirrors the gate outcome for monorepo convention under `packages/core/docs/baseline/`.

## Verdict summary

Phase 10 webhook inbox engine is **complete and green**. Independent adversarial review re-ran tests, typecheck, coverage, boundaries, portability, package validation, focused webhooks suites, build, and logical anti-bug probes.

| Area | Result |
| --- | --- |
| Tests | **1186 pass, 0 fail** (`bun test packages/core packages/testkit packages/webhooks`) = core 1000 + testkit 126 + webhooks 60 |
| Focused webhooks | **60 pass, 0 fail** |
| Coverage (core) | **99.51% funcs / 98.60% lines** |
| typecheck / typecheck:types | exit 0 |
| build + dist | webhooks/core/testkit entrypoints present; webhooks rebuild OK |
| boundaries / portability / validate:package | all OK (Deno smoke SKIP, non-blocking) |
| A1–A6 | **PASS** (see primary report) |
| 10.1–10.6 deliverables | **PASS** |
| webhooks → core only; portable | **yes** (`paymentsSdk.portable: true`) |
| core → webhooks / webhooks → testkit | **none** |
| Phase 11 adapter-\* packages | **absent** |
| Blocking issues | **none** |

## Acceptance criteria (short)

| ID | Criterion | Verdict |
| --- | --- | --- |
| A1 | Concurrent deliveries: handler runs once | **PASS** |
| A2 | Completed: no re-run (`duplicate_completed`) | **PASS** |
| A3 | Expired leases reclaimable | **PASS** |
| A4 | Stale workers cannot complete reclaimed work | **PASS** |
| A5 | Conflicting payloads → `payload_conflict` | **PASS** |
| A6 | `inline` / `durable_retry` explicit | **PASS** |

## Deliverables (short)

| ID | Item | Verdict |
| --- | --- | --- |
| 10.1 | Processing model engine steps | **PASS** |
| 10.2 | Inbox record / no raw secrets | **PASS** |
| 10.3 | Modes explicit | **PASS** |
| 10.4 | `WebhookProcessingOutcome` exact set | **PASS** |
| 10.5 | Lease renewal fails when stale | **PASS** |
| 10.6 | Crash boundaries documented + tested | **PASS** |

## Key paths

| Artifact | Path |
| --- | --- |
| Engine | `packages/webhooks/src/engine.ts` |
| Types | `packages/webhooks/src/types.ts` |
| Store contract | `packages/webhooks/src/store.ts` |
| Event key | `packages/webhooks/src/event-key.ts` |
| Sanitize | `packages/webhooks/src/sanitize.ts` |
| Docs | `packages/webhooks/docs/webhook-inbox.md`, `crash-boundaries.md` |
| Primary gate report | `packages/webhooks/docs/phase-10-gate-report.md` |

## Blocking

_None._

## Non-blocking

- Deno binary smoke SKIP (static portability scan required and green).
- Lean 10.2 field mapping (key / payloadRef / timestamps) documented honestly.
- `ackAfterClaim` uses `store.fail` sentinel to schedule worker pickup (tested).
- Additive `invalid_webhook.reason?` vs strict roadmap literal.
- CHANGELOG Unreleased for 0.x webhooks (release not required by gate).
- “1186 + 60 webhooks” narrative double-counts if 1186 already includes webhooks (this review: 1186 = 1000+126+60).

## Summary

Phase 10 **PASS**. Portable `@paykernel/webhooks` inbox engine with claim, lease fencing, explicit modes, outcomes, sanitization, A1–A6, crash-boundary docs+tests, and Phase 0–9 safety net independently evidenced. No illegal dependency edges; no adapter packages.
