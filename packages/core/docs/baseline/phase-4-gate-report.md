# Phase 4 adversarial gate report

**Date (UTC):** 2026-08-02  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck (core + testkit) | **PASS** — `bun run typecheck` exit 0 (both workspace filters) |
| typecheck:types | **PASS** — `bun run typecheck:types` exit 0 |
| 745 core+testkit tests | **PASS** — `bun test packages/core packages/testkit` → **745 pass, 0 fail**, 2884 expects, 25 files |
| core coverage 99.43%/99.05% | **PASS** — measured **99.43% funcs / 99.05% lines** (`bun test --coverage packages/core`) |
| build emits core+testkit dist | **PASS** — `bun run build` exit 0; `packages/core/dist/index.js` + `packages/testkit/dist/index.js` + `.d.ts` |
| boundaries OK | **PASS** — `bun run check:boundaries` → workspace boundaries OK |
| validate:package | **PASS** — pack + publint + attw + consumer smoke **OK** |
| package name `@paykernel/testkit` | **PASS** — `packages/testkit/package.json` `"name": "@paykernel/testkit"` |
| public API exports complete | **PASS** — `public-api.test.ts` freezes runtime symbols; root `src/index.ts` re-exports mock, suites, stores, fixtures |
| mock full conformance + three storage harnesses on memory | **PASS** — ad-hoc full suite 18/18; storage suites 11+9+11 all `ok` |
| fixture safety + builtin applicable offline suites green | **PASS** — fixture-safety tests; all four builtins `ok` applicable + structural |
| memory stores NON-PRODUCTION marked | **PASS** — constants + per-store flags + README banner |
| core has no testkit dependency | **PASS** — core deps = `{ zod }` only; testkit → core workspace; no testkit import under `packages/core/src` |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **745 pass, 0 fail** (25 files, 2884 expects) |
| `bun test packages/testkit` | **78 pass, 0 fail** (7 files) |
| `bun test --coverage packages/core` | **667 pass**; **99.43% funcs / 99.05% lines**; thresholds met |
| `bun run typecheck` | exit 0 (core + testkit) |
| `bun run typecheck:types` | exit 0 |
| `bun run build` | exit 0 — core `index.js` ~240 KB; testkit `index.js` ~127 KB + declarations |
| `bun run check:boundaries` | exit 0 |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** |

### Ad-hoc semantic smoke (gate script, source imports)

| Check | Result |
| --- | --- |
| `provider_ok_client_timeout` | client: `NetworkError`, `paid=false`; provider side `success=true` via `getLastProviderSideSuccess` |
| plain `timeout` | `NetworkError`, `paid=false`; no provider-side success |
| full mock suite (stripe caps) | `ok=true`, **18 passed**, 0 failed, 0 skipped |
| builtin applicable (stripe/moyasar/paypal/paymob) | all `ok=true`, `failed=0`; each passes `capabilities_parity`, `claim_method_presence`, `malformed_webhook_rejection`, `logging_redaction`; network cases skipped offline |
| storage harnesses on memory (correct clock wiring) | idempotency **11 passed**; webhook inbox **9 passed**; reconciliation **11 passed**; all `ok` |
| fixture safety | `assertFixtureSafe` rejects `sk_live_*`; `sanitizeFixture` + `FIXTURE_SCHEMA_VERSION=1` |

---

## Acceptance criteria

### A1) Custom gateways and stores can be validated through shared suites — **PASS**

| Evidence | Detail |
| --- | --- |
| Gateway suite export | `runGatewayConformanceSuite`, `GATEWAY_CONFORMANCE_CASES` from `@paykernel/testkit` |
| Storage suite exports | `runIdempotencyStoreConformanceSuite`, `runWebhookInboxStoreConformanceSuite`, `runReconciliationStoreConformanceSuite` |
| Documented | `packages/testkit/README.md` shows custom gateway + store harness usage |
| Tested | `gateway-conformance.test.ts`, `builtin-conformance.test.ts` (mock full), `storage-conformance.test.ts` (memory self-proof) |
| Public API freeze | `public-api.test.ts` asserts all three store runners + gateway suite present |

### A2) Applications can test complex payment behavior without real providers — **PASS**

| Evidence | Detail |
| --- | --- |
| Scripted outcomes | FIFO queues + `defaultOutcome` (`mock-gateway.ts` / `outcomes.ts`) |
| Latency / timeout | `latencyMs` / `delayMs`; FakeClock virtual advance; `timeout` → `NetworkError` (not paid) |
| Dual outcome | `provider_ok_client_timeout` / `provider_success_client_timeout` — provider ledger + client `NetworkError` |
| Webhooks | HMAC sign/verify, `buildWebhook`, duplicate + out-of-order helpers |
| History | redacted `history` / `assertHistory` |
| Partials | partial capture/refund with remaining ledger |
| Indeterminate | `indeterminate` result (`success:false`, processing + reconcile flag); dual-timeout path |
| Never live network | mock header comment + suite offline-first design |

### A3) All built-in gateways pass applicable conformance tests — **PASS**

| Gateway | applicable `ok` | structural `ok` | Notes |
| --- | --- | --- | --- |
| stripe | true | true | network create paths skipped offline |
| moyasar | true | true | same |
| paypal | true | true | same |
| paymob | true | true | same |

Evidence: `builtin-conformance.test.ts` + ad-hoc `runBuiltinGatewayConformance` for all four names.  
Stripe-shaped **mock** passes **full** suite (stands in for offline behavioral coverage).

---

## Phase 4 tasks 4.1–4.5

### 4.1 Gateway conformance suite — **PASS**

All roadmap-listed cases exist as named suite cases (plus structural helpers):

| Roadmap topic | Case id(s) |
| --- | --- |
| amount conversion | `amount_conversion` |
| status normalization | `status_normalization` |
| decline / provider-error mapping | `decline_mapping`, `provider_error_mapping` |
| network failure / timeout | `network_failure`, `timeout_behavior` |
| safe retry / idempotency | `safe_retry`, `idempotency_behavior` |
| webhook verify / malformed | `webhook_verification`, `malformed_webhook_rejection` |
| event normalization | `event_normalization` |
| partial capture / refund | `partial_capture`, `partial_refund` |
| logging redaction | `logging_redaction` |
| cancellation | `request_cancellation` |
| indeterminate | `indeterminate_outcomes` |
| (extra) | `capabilities_parity`, `claim_method_presence` |

Source: `packages/testkit/src/conformance/gateway-conformance.ts` (`GATEWAY_CONFORMANCE_CASES`).

### 4.2 Scriptable mock gateway — **PASS**

Supports: deterministic scripted outcomes; latency/timeout; duplicate/out-of-order webhooks; provider-success + client-timeout dual outcome; partial capture/refund; request history assertions; webhook signature helpers. Covered by `mock-gateway.test.ts` and full conformance golden path.

### 4.3 Storage conformance harness — **PASS**

Harness supports and exercises on memory stores:

| Topic | Evidence (case names / design) |
| --- | --- |
| Real concurrency (where driver supports) | same-isolate concurrent reserve/claim cases; `concurrency: false` skips |
| Fake-clock lease expiry | `fake-clock lease expiry allows re-reserve` + reclaim cases |
| Process-crash boundary | `crash abandon lease then reclaim after expiry` |
| Duplicate key / payload hash conflicts | fingerprint / payload hash conflict cases |
| Cleanup / retention | `deleteExpired` / cleanup removes terminal rows |
| Transaction rollback | `withTransaction rollback leaves no partial …` (passed, not skipped on memory) |

### 4.4 Fixture safety utilities — **PASS**

- `sanitizeFixture` / `redactSecretsFromFixture` / `assertFixtureSafe` / `findSecretLeaks`
- Rejects live keys (`sk_live_`, `pk_live_`, `rk_live_`, live `whsec_`), PANs, non-test Bearer tokens
- Allows `sk_test_`, `pk_test_`, `whsec_test…`, `test_secret` placeholders
- Versioned schema: `FIXTURE_SCHEMA_VERSION = 1`, `FixtureEnvelope`, `assertFixtureSchemaVersion`

### 4.5 Test-only in-memory store — **PASS**

- `createMemoryIdempotencyStore` / `WebhookInbox` / `Reconciliation` + `createMemoryStores`
- Fake clock (`createFakeClock`), lease tokens, conflicts, `simulateCrash`
- Marked: `NON_PRODUCTION`, `NON_DISTRIBUTED`, `MEMORY_STORE_WARNING` on exports and store instances
- Documented non-production in README and module banner

---

## Safety net / isolation

| Check | Result |
| --- | --- |
| Phase 0–3 core suite still green | **PASS** — full monorepo core+testkit 745 green; core coverage unchanged at 99.43/99.05 |
| Core isolation (no testkit dep) | **PASS** — package graph + boundaries + no `src` import of testkit |
| Boundaries | **PASS** |
| Package name | **PASS** — `@paykernel/testkit` |

---

## Logical bug hunt (skeptical)

| Risk | Finding |
| --- | --- |
| False paid on timeout | **Not found** — plain timeout throws `NetworkError`; dual-timeout throws client error while retaining provider side separately; suite asserts `!paid` |
| Non-atomic memory claims | **Acceptable for isolate** — critical sections have no `await` between read/write; concurrent same-isolate suite cases pass; explicitly **not** multi-process (NON_DISTRIBUTED) |
| Secret fixtures | **Not found** — live patterns hard-fail; history uses `redact()`; tests cover sk_live / PAN / Authorization |
| Double-charge on dual-timeout retry | **Mitigated** — mock caches provider success for idempotency key; test `provider_ok_client_timeout caches so idempotent retry is not a double charge` |
| Decline / network mapped as paid | **Guarded** in suite (`isPaidSuccess` asserts) and mock throws typed errors |

---

## Non-blocking notes (not gate failures)

1. Built-in **full** behavioral HTTP conformance remains offline-skipped until injectable `fetch` / fixture HTTP runners exist; design uses `applicable`/`structural` for real gateways and mock for full suite — matches roadmap offline safety.
2. Memory concurrency is **single-isolate only** (documented); multi-process drivers must re-prove harness with `concurrency: true` against real engines.
3. Lease-aware testkit store contracts are **distinct** from core 0.x `IdempotencyStore` (get/set/reserve without fencing) — intentional Phase 4/9 scaffolding.
4. Prior implementer report at `packages/testkit/docs/phase-4-gate-report.md` is informal; this baseline report is the adversarial record of record.

---

## Checklist

- [x] A1 custom gateway suite exported, documented, tested
- [x] A1 three storage suites exported, documented, tested on memory
- [x] A2 mock scripted outcomes / latency / timeout / webhooks / history / partials / indeterminate
- [x] A3 stripe/moyasar/paypal/paymob applicable reports `ok`
- [x] 4.1 all listed conformance cases present
- [x] 4.2 mock features complete
- [x] 4.3 harness: concurrency, fake-clock leases, crash, conflicts, cleanup, tx rollback
- [x] 4.4 fixture safety + versioned schemas
- [x] 4.5 memory NON-PRODUCTION + fake time + leases + conflicts + crash sim
- [x] Phase 0–3 safety net green (745 tests; core coverage floors exceeded)
- [x] Core no testkit dependency; boundaries pass
- [x] No blocking logical bugs found on timeout-paid, atomicity, secret fixtures
- [x] typecheck / typecheck:types / build / validate:package independent green

---

## Verdict

**PASS** — Phase 4 deliverables and acceptance criteria are independently evidenced. No blocking findings.
