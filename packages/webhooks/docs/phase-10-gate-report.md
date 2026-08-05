# Phase 10 adversarial gate report

**Date (UTC):** 2026-08-03  
**Package:** `@paykernel/webhooks@0.1.0`  
**Workspace packages also reviewed:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

Independent re-verification. No implementer assertion accepted without source, test, or command evidence from this review session.

---

## Verdict summary

| Area | Result |
| --- | --- |
| Tests (core + testkit + webhooks) | **1186 pass, 0 fail** (`bun test packages/core packages/testkit packages/webhooks`) — breakdown: core **1000**, testkit **126**, webhooks **60** |
| Focused webhooks | **60 pass, 0 fail** across 8 files |
| Coverage (core) | **99.51% funcs / 98.60% lines** (`bun test --coverage packages/core`) |
| typecheck / typecheck:types | exit 0 (all three packages + core type-tests) |
| build + dist entrypoints | `bun run --filter @paykernel/webhooks build` OK; `dist/index.js`, `index.d.ts`, engine/store/types d.ts present |
| boundaries | **OK** (`bun run check:boundaries`) |
| runtime portability | **OK** (Deno binary smoke SKIP — non-blocking; static node: scan green) |
| validate:package | **OK** (pack, publint, attw, Bun+Node consumer smoke) |
| A1–A6 | **PASS** (see below) |
| 10.1–10.6 deliverables | **PASS** |
| Package portability / deps | webhooks → core only (`@paykernel/core` workspace:\*); `paymentsSdk.portable: true`; no webhooks→testkit; no core→webhooks/testkit |
| Phase 11 adapter-\* packages | **absent** (workspace packages = core, testkit, webhooks only) |
| Logical anti-bug probes | **PASS** |
| Blocking issues | **none** |

---

## Acceptance criteria (roadmap Phase 10)

### A1) concurrent duplicate deliveries do not execute the same handler concurrently — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `packages/webhooks/src/engine.concurrency.test.ts` — `A1: concurrent processVerified same key — only one handler runs` |
| Assertions | `runs === 1`, `maxConcurrent === 1`, exactly one `processed`, peer is `already_processing` or `duplicate_completed` |
| Variant | `Promise.all` double delivery → same guarantees |
| Code | Engine maps claim `in_progress` → `already_processing` without handler (`engine.ts` claim switch); store `claim` is single Map read/branch/write with no intermediate await (`memory-store.ts`) |

### A2) completed events do not execute again — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `engine.test.ts` — `A2 completed events do not re-run handler` |
| Assertions | first → `processed` (`runs === 1`); second → `duplicate_completed` (`runs` still `1`) |
| Crash twin | `engine.crash.test.ts` 10.6.5 after completion → `duplicate_completed`, handler not run |
| Code | claim kind `already_completed` → `outcomeDuplicateCompleted()` before handler |

### A3) expired leases can be reclaimed — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `engine.test.ts` — `A3 expired lease reclaim re-runs handler` |
| Setup | store-level claim, `clock.advance` past lease, `processVerified` → `processed`, `runs === 1` |
| Crash twin | 10.6.2 abandon then reclaim after expiry |
| Code | memory-store `releaseExpiredLease` + re-claim increments `generation` and issues new `leaseToken` |

### A4) stale workers cannot complete reclaimed work — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `engine.test.ts` — `A4 stale worker completion rejected` |
| Assertions | after reclaim, `store.complete({ leaseToken: staleToken })` throws `StoreLeaseLostError`; row remains completed only by new token path |
| Mid-reclaim | `A4 mid-reclaim fencing` + crash twin: stale complete while new lease active → lease_lost; new owner completes |
| Contract | `CompleteWebhookInput.leaseToken` required; wrong/stale/expired → `StoreLeaseLostError` |

### A5) conflicting payloads are reported — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `engine.test.ts` — `A5 payload_conflict` |
| Assertions | second process with different `payloadHash` → `payload_conflict`; handler call count unchanged |
| Code | claim `payload_hash_conflict` → `outcomePayloadConflict()`; no handler |

### A6) inline and durable retry modes are explicit — **PASS**

| Evidence | Detail |
| --- | --- |
| Test | `engine.modes.test.ts` (A6 suite) |
| Construction | `mode: "inline" \| "durable_retry"` required; invalid mode throws at runtime; `ackAfterClaim` only valid with `durable_retry` |
| Outcomes | inline throw → `handler_failed { retryable: true }`; durable throw → `scheduled_for_retry { reason: "handler_retry" }` |
| No mix | `processRetryable` throws on inline engines; per-engine mode fixed; same store, different engines keep distinct failure outcomes |
| Docs | `webhook-inbox.md`, `inbox-engine.md`, README document explicit modes |

---

## Deliverables 10.1–10.6

### 10.1 Processing model engine steps — **PASS**

Documented in `engine.ts` header and `docs/webhook-inbox.md` §2 mapping roadmap steps 1–10:

1–3 outside / `processWithVerifier` → 4 hash → 5 `deriveWebhookEventKey` → 6 atomic `store.claim` → 7 conflict mapping → 8 handler under lease → 9 `complete` → 10 sanitized `fail` + mode outcome.

### 10.2 Inbox record / no raw secrets storage — **PASS**

| Evidence | Detail |
| --- | --- |
| Record | `WebhookInboxRecord` in `store.ts` (lean shape + documented 10.2 field mapping in module header) |
| Secrets | `sanitizeWebhookError` strips sk_live/whsec/Bearer/signature patterns; engine always sanitizes before `store.fail` |
| Tests | `sanitize.test.ts` + `engine.test.ts` “handler errors are sanitized before store.fail” — `lastError` has `[REDACTED]`, not raw secret |
| Docs | store header + webhook-inbox forbid raw signatures/auth/secrets/unredacted payloads |

### 10.3 Modes explicit — **PASS**

See A6. Modes fixed at construction; never switched inside `process*`. Runtime guard rejects unknown mode and inline+ackAfterClaim.

### 10.4 `WebhookProcessingOutcome` exact set — **PASS**

```ts
type ScheduledForRetryReason = "parked" | "handler_retry" | "not_available";

type WebhookProcessingOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate_completed" }
  | { outcome: "already_processing"; retryAfterMs?: number }
  | { outcome: "scheduled_for_retry"; reason: ScheduledForRetryReason }
  | { outcome: "handler_failed"; retryable: boolean }
  | { outcome: "payload_conflict" }
  | { outcome: "invalid_webhook"; reason?: string };
```

Matches roadmap §10.4 discriminant set with additive `scheduled_for_retry.reason` so adapters can avoid silent 200 when no worker will process. Optional `reason` on `invalid_webhook` is additive (does not hardcode HTTP). No Express/Hono status codes in package.

### 10.5 Lease renewal fails when stale — **PASS**

| Evidence | Detail |
| --- | --- |
| Tests | renew rotates token; wrong token → `{ ok: false, reason: "lease_lost" }`; expired-then-renew during handler → `handler_failed` retryable |
| Code | `ctx.renew` / `engine.renewLease` → `store.renew`; on failure throws `StoreLeaseLostError` mapped to retryable handler_failed |

### 10.6 Crash boundaries documented AND tested — **PASS**

| Boundary | Doc | Test |
| --- | --- | --- |
| Before claim | `crash-boundaries.md` §1 | `10.6 crash before claim` — size 0, safe retry → `processed` |
| After claim, before handler | §2 | abandon + `already_processing` then reclaim → handler once |
| During handler | §3 | reclaim re-runs (`runs === 2`) — documents idempotency requirement |
| After side effect, before complete | §4 | lease expire before complete → not `processed`; mid-reclaim fencing |
| After completion | §5 | redelivery → `duplicate_completed`, handler not run |

Docs present and API-aligned: `packages/webhooks/docs/crash-boundaries.md`, `webhook-inbox.md`.

---

## Package / monorepo constraints

| Check | Evidence | Verdict |
| --- | --- | --- |
| `@paykernel/webhooks` portable | `package.json` `paymentsSdk.portable: true`; no `node:` imports in src/dist | **PASS** |
| Depends on core only | `dependencies: { "@paykernel/core": "workspace:*" }` only | **PASS** |
| No core → webhooks | core package.json has no webhooks dep; no imports in `packages/core/src` | **PASS** |
| No webhooks → testkit | no package dep; only docs/examples mention testkit memory store | **PASS** |
| No Phase 11 adapter packages | workspace `packages/*` = core, testkit, webhooks | **PASS** |
| Memory store not public | `index.ts` does not export it; `public-api.test.ts` asserts absence | **PASS** |
| Phase 0–9 safety net | 1000 core + 126 testkit green; coverage thresholds met | **PASS** |

---

## Logical anti-bug probes

| Risk | Evidence | Verdict |
| --- | --- | --- |
| Silent ACK of failures | never returns `processed`/`duplicate_completed` on handler throw; complete lease_lost → `handler_failed` retryable; docs forbid silent ACK | **PASS** |
| get/set claim race in engine | engine only calls `store.claim` (single atomic op); no get-then-set path | **PASS** |
| Secrets in lastError | sanitize before fail; tests assert redaction | **PASS** |
| Modes mixed implicitly | construction-fixed mode; processRetryable throws on inline; ackAfterClaim constrained | **PASS** |
| Complete without lease token | `CompleteWebhookInput.leaseToken` required; engine always passes current token | **PASS** |
| Handler re-run on completed | A2 + crash after completion | **PASS** |
| Stale complete succeeds | A4 + store fencing + mid-reclaim probe | **PASS** |

---

## Independent command log (this session)

```text
bun test packages/core packages/testkit packages/webhooks  → 1186 pass, 0 fail
bun test packages/webhooks                                 → 60 pass, 0 fail
bun test packages/core                                     → 1000 pass
bun test packages/testkit                                  → 126 pass
bun test --coverage packages/core                          → 99.51% funcs / 98.60% lines
bun run typecheck                                          → exit 0 (sdk + webhooks + testkit)
bun run typecheck:types                                    → exit 0
bun run check:boundaries                                   → workspace boundaries OK
bun run check:runtime-portability                          → OK (Deno smoke SKIP)
bun run validate:package                                   → package validation OK
bun run --filter @paykernel/webhooks build         → exit 0
```

---

## Non-blocking notes

1. **Deno smoke SKIP** — binary not installed; static portability scan required and green.
2. **Lean 10.2 mapping** — gateway / provider event type / schema version / first-class completion timestamp are encoded in `key` / optional `payloadRef` / `updatedAt` rather than first-class columns. Documented honestly in store header and docs; not a gate failure.
3. **`ackAfterClaim` uses `store.fail`** with sentinel message + `retryAfterMs: 0` to park for workers (no dedicated “release to pending” store op). Tested and documented.
4. **`invalid_webhook.reason?`** additive vs strict roadmap type literal — useful, non-breaking.
5. **CHANGELOG** still under Unreleased for 0.x webhooks package (release not required by Phase 10 gate).
6. Implementer phrase “1186 monorepo + 60 webhooks” is slightly misleading: **1186 already includes** the 60 webhooks tests (1000+126+60). Focused webhooks suite is the same 60.

---

## Checklist

- [x] A1 concurrent handler singleton + peer outcome
- [x] A2 duplicate_completed no re-run
- [x] A3 expired lease reclaim
- [x] A4 stale complete rejected after reclaim
- [x] A5 payload_conflict
- [x] A6 explicit inline vs durable_retry
- [x] 10.1 processing pipeline
- [x] 10.2 lean record + no raw secrets
- [x] 10.3 modes explicit
- [x] 10.4 outcome discriminant exact set
- [x] 10.5 renew rotates; stale renew fails
- [x] 10.6 five crash boundaries documented + tested
- [x] Package portable, core-only deps
- [x] No core→webhooks; no webhooks→testkit
- [x] No Phase 11 adapter packages
- [x] Safety net typecheck/tests/boundaries/portability/validate:package green
- [x] Anti-bug: silent ACK, claim race, secrets, mode mix, lease-less complete, completed re-run, stale complete

---

## Summary

Phase 10 **PASS**. `@paykernel/webhooks` delivers a portable, core-only inbox engine with atomic claim, lease fencing, explicit `inline` | `durable_retry` modes, roadmap `WebhookProcessingOutcome` set, sanitized errors, documented and tested crash boundaries (10.6), and A1–A6 acceptance coverage. Monorepo safety net remains green; workspace boundaries clean; no Phase 11 adapter packages.
