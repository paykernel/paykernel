# Phase 6–10 fix-gate report

**Date (UTC):** 2026-08-14  
**Packages:** `@paykernel/core@0.1.0-next.0`, `@paykernel/webhooks@0.1.0-next.0`, `@paykernel/testkit@0.1.0-next.0`, `@paykernel/store-contracts@0.1.0-next.0`, `@paykernel/sql-foundation@0.1.0-next.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Workflow:** `.grok/workflows/phase-6-10-fix-gate.rhai`  
**Working tree:** uncommitted fix-stream diffs vs `HEAD` (`2c41ad4`); not a release commit.

**Verdict:** **PASS** (listed P610 blockers closed; remaining AC fixture updated)

Listed workflow blockers are closed (see [Gate](#gate-adversarial-re-check)). Typecheck and runtime portability are green. Targeted tests had **1179 pass / 1 fail** after the nine streams: Phase 7 AC `handleWebhook attaches PaymentEvent…` expected Moyasar `payment_paid` without `captured` to stay `paid`. Post-gate, the fixture now supplies finite `captured: 1000` (P610-MOY-2). Re-run: `webhook-events.acceptance.test.ts` **30 pass / 0 fail**.

---

## Critic (pre-fix, vs `HEAD`)

Read-only confirmation of the workflow IDs against committed `HEAD` (`2c41ad4`). Phase 6–10 historical gates (`phase-6-gate-report.md` … `phase-10-gate-report.md`) had already landed outcomes, webhook mapping, runtime, stores, and inbox ACK; the holes below were still present on that commit.

| ID | Status at `HEAD` | Evidence |
| --- | --- | --- |
| **P610-MAP-1** | **STILL PRESENT** | `packages/core/src/types/webhook-event-map.ts` `mapMoyasarEventType` status-fallback: unknown type + `paid` → `payment.succeeded`. |
| **P610-MAP-2** | **STILL PRESENT** | Same file `mapPaymobEventType`: unknown type ran `mapPaymobTransactionSignals` and could return `payment.succeeded` when `flags.success`. |
| **P610-IND-1** | **STILL PRESENT** | Built-in gateways call `applyOutcomeToGatewayResult` but never with `'indeterminate'`. Post-submit timeout/5xx throw `NetworkError`. No stream owned gateway outcome arms for this ID. |
| **P610-ACK-1** | **STILL PRESENT** | `packages/webhooks/src/engine.ts` mapped claim `not_available` to `scheduled_for_retry` in every mode, including `inline`. |
| **P610-ACK-2** | **STILL PRESENT** | `ackAfterClaim` `store.fail(restoreAttempt)` `lease_lost` still returned `scheduled_for_retry { reason: "parked" }` (park not persisted). |
| **P610-ACK-3** | **STILL PRESENT** | `bestEffortRecordFailAfterLeaseLost` catch could treat force-dead-letter as terminal without a successful `fail`/`dead_letter`. |
| **P610-PP-1** | **STILL PRESENT** | `packages/core/src/gateways/paypal/paypal.gateway.ts` `mapPayPalOutcome`: `reversed` fell through to `succeeded`. |
| **P610-PP-2** | **STILL PRESENT** | Same mapper: `partially_captured` fell through to `succeeded`. |
| **P610-INF-1** | **STILL PRESENT** | `packages/core/src/types/operation-result.ts` `isSettledSuccessStatus` included `partially_captured`, so bare `{success:true,status:partially_captured}` inferred `succeeded`. |
| **P610-INF-2** | **STILL PRESENT** | `inferOperationOutcome`: `success:false` + `pending`/`processing`/`approved` returned `failed`. |
| **P610-MOY-1** | **STILL PRESENT** | `moyasar.gateway.ts` `createPayment` JSDoc: “fulfill only on `paid` (or `authorized` for auth-only holds)”. |
| **P610-MOY-2** | **STILL PRESENT** | Missing/NaN `captured` coerced to `0`; provider `paid` stayed `paid`. |
| **P610-MOY-3** | **STILL PRESENT** | Moyasar stripped `secret_token` then hashed (`attachPaymentEvent` + `computePayloadHash`) so digest matched key-absence, not redacted-with-key. |
| **P610-HASH-1** | **STILL PRESENT** | `packages/core/src/types/payment-event.ts` `redactDeep` / `hashWebhookPayload` did not JSON-parse strings (unlike `prepareEncryptPlaintext`). |
| **P610-HASH-2** | **STILL PRESENT** | Nested `Uint8Array`/`Buffer` hashed as `[Buffer:len]` / `[Uint8Array:len]` markers. |
| **P610-SAFE-1** | **STILL PRESENT** | `packages/core/src/client.ts` `handleWebhook` attached only when `event.event === undefined`; no `isPaymentEvent` / `schemaVersion` / incomplete-money demotes. |
| **P610-PP-3** | **STILL PRESENT** | PayPal `PAYMENT.REFUND.COMPLETED` / domain `refund_completed` dual-wrote `refund.completed`. |
| **P610-DOC-1** | **STILL PRESENT** | `packages/core/docs/webhook-events.md` said Paymob HMAC refunds dual-write `refund.completed`; code was `refund.pending`. |
| **P610-RED-1** | **STILL PRESENT** | `WEBHOOK_PAYLOAD_SECRET_KEYS` omitted camelCase `clientSecret` / `secretToken` / `webhookSecret` / `accessToken`. `stripPayment` did not strip `nextAction.clientSecret`. |
| **P610-CLK-1** | **STILL PRESENT** | PayPal `getAccessToken` compared `this.tokenExpiry > new Date()`. |
| **P610-ABT-1** | **STILL PRESENT** | `packages/core/src/runtime/abort.ts` `createTimeoutSignal` preferred `AbortSignal.timeout`; `clear()` was a no-op on that path. |
| **P610-ABT-2** | **STILL PRESENT** | `combineAbortSignals` polyfill attached listeners with `{ once: true }` but did not track/remove remaining listeners when any input aborted. |
| **P610-ABT-3** | **STILL PRESENT** | `extractAbortSignal` used `instanceof AbortSignal` only. |
| **P610-ABT-4** | **STILL PRESENT** | PayPal / Moyasar / Paymob cleared the timeout after headers; body read was unarmed. |
| **P610-CLK-2** | **STILL PRESENT** | Moyasar idempotency `createdAt` used `Date.now()`. Paymob cache TTL / prune / token-cache comparisons used `Date.now()`. |
| **P610-STO-1** | **STILL PRESENT** | `packages/testkit/src/memory/memory-stores.ts` webhook `fail()` called `releaseExpiredLease` before the token check. |
| **P610-STO-2** | **STILL PRESENT** | `packages/store-contracts/src/contracts.ts` `FailWebhookInput` said expired fail is `lease_lost` (vs WEBHOOKS-2). |
| **P610-STO-3** | **STILL PRESENT** | `isStoreLeaseLostError` comments/matchers differed across store-contracts / webhooks / reconciliation. Testkit docs still pointed at `packages/testkit/src/storage/contracts.ts` as source of truth. |
| **P610-SNAP-1** | **STILL PRESENT** | Durable inbox snapshot of `input.event` via redact only; `WebhookEvent.rawPayload` / `headers` could persist in `payloadRef`. |
| **P610-CLK-3** | **STILL PRESENT** | Paymob `pruneExpiredIdempotencyEntries` deleted aged `in_progress` / `unknown` fences. |

### Already fixed before this gate

- `isPaidOutcome` / `PAID_LIKE_PAYMENT_STATUSES` already paid-only (`packages/core/src/types/domain-status.ts`).
- Stripe incomplete-settled / incomplete-refund demotes existed as **private** methods on `StripeGateway`.
- Paymob FIFO already refused evicting `in_progress` / `unknown` fences (`PAYMOB-3` comment in `paymob.gateway.ts`).
- Engine already treated HTTP 408 / 409 / 425 / 429 as retryable (`packages/webhooks/src/engine.ts` `isPermanentClientHttpStatus`).
- Phase 0–5 money / capability / release-on-`main` work is on `HEAD` (`2c41ad4`).

**Critic summary:** 30 IDs still present at `HEAD`. P610-IND-1 is a gateway-outcome policy gap (no stream owned it). P610-DOC-1 was a docs/honesty gap. The rest were implementation holes in mapping, infer, PayPal/Moyasar/Paymob/Stripe+client, inbox ACK, stores, hash/redact, and abort/clock.

---

## Nine fix streams

Non-overlapping edits on the uncommitted tree (40 files, +3293 / −452 vs `HEAD`). Allowed-but-untouched: `packages/webhooks/src/sanitize.ts`, `packages/webhooks/src/engine.concurrency.test.ts`.

### Stream A — Outcomes (`P610-INF-1`, `P610-INF-2`)

| File | Change |
| --- | --- |
| `packages/core/src/types/operation-result.ts` | Removed `partially_captured` from `isSettledSuccessStatus`. Bare `{success:true,status:partially_captured}` infers `requires_action`. `success:false` + pending/processing/approved infers `indeterminate` (not `failed`). `applyOutcomeToGatewayResult` / refund apply attach `reconciliationRequired` **only** when outcome is `indeterminate`. |
| `packages/core/src/types/domain-status.ts` | Docs: `partially_captured` is not paid-like. |
| `packages/core/src/types/operation-result.test.ts` | Infer / apply cases for open money and `success:false`+pending. |
| `packages/core/src/types/operation-results.acceptance.test.ts` | AC table: partial ≠ succeeded; false+pending ≠ failed. |
| `packages/core/docs/operation-results.md` | Infer table; recon flag only on indeterminate. |

Stream A did **not** edit gateway files (P610-IND-1 left to remaining nits).

### Stream B — PayPal (`P610-PP-1`, `P610-PP-2`, `P610-PP-3`, `P610-CLK-1`, `P610-ABT-4`)

| File | Change |
| --- | --- |
| `packages/core/src/gateways/paypal/paypal.gateway.ts` | `mapPayPalOutcome`: `reversed` → `failed`; `partially_captured` → `requires_action`. `demoteIncompleteRefundWebhookDualWrite` turns incomplete `refund_completed` dual-write into `refund.pending` (native `event.type` / `provider.eventType` unchanged). Token cache: `this.tokenExpiry.getTime() > this.clock.nowMs()`. `getAccessToken` / `fetchAccessToken` take caller `AbortSignal`. `performFetch` buffers body before `clear()`. |
| `packages/core/src/gateways/paypal/paypal.gateway.test.ts` | Outcome ≠ succeeded for reversed / partial; incomplete refund dual-write; clock + abort-until-body. |

### Stream C — Moyasar (`P610-MOY-1`, `P610-MOY-2`, `P610-MOY-3`, `P610-CLK-2`, `P610-ABT-4`)

| File | Change |
| --- | --- |
| `packages/core/src/gateways/moyasar/moyasar.gateway.ts` | JSDoc: fulfill only on `status === 'paid'` / `isPaidOutcome`; `authorized` is not fulfillment. Paid/captured family without finite `captured` → `processing`. Hash via `hashWebhookPayload(raw)` **before** stripping `secret_token`; `rawPayload` omits the secret after hash. Idempotency `createdAt` uses `this.clock.nowMs()`. HTTP timeout stays armed until JSON body is parsed. |
| `packages/core/src/gateways/moyasar/moyasar.gateway.test.ts` | Missing `captured` fail-close; hash digest matches redacted-with-key; clock + abort-until-body. |

### Stream D — Events / hash (`P610-MAP-1`, `P610-MAP-2`, `P610-HASH-1`, `P610-HASH-2`, `P610-RED-1`, `P610-DOC-1`)

| File | Change |
| --- | --- |
| `packages/core/src/types/webhook-event-map.ts` | `mapMoyasarEventType`: only `MOYASAR_EVENT_TYPE_MAP` keys; unknown → `provider.unmapped` (no status fallback). `mapPaymobEventType`: only `TOKEN` / `TRANSACTION` / `TRANSACTION_RESPONSE`; unknown stays unmapped even when `flags.success`. |
| `packages/core/src/types/payment-event.ts` | `redactDeep` JSON-parses strings then redacts. Top-level / nested binary hashed as bytes, not length markers. CamelCase aliases on `WEBHOOK_PAYLOAD_SECRET_KEYS`. `stripPayment` also strips `nextAction.clientSecret`. |
| `packages/core/src/types/payment-event.test.ts` | MAP-1 unknown+paid; hash / redact cases. |
| `packages/core/src/webhook-events.acceptance.test.ts` | P610-MAP-1/2, HASH-1/2, RED-1. **Did not** add `captured` to the older Moyasar `handleWebhook` AC fixture (verify residual). |
| `packages/core/docs/webhook-events.md` | Paymob HMAC refunds dual-write **`refund.pending`**. Hash docs: JSON-string redact, binary bytes, WEBHOOKS-2 shape honesty. |

Stream D did **not** edit gateway or client files.

### Stream E — Stripe + client (`P610-SAFE-1`, $0 checkout)

| File | Change |
| --- | --- |
| `packages/core/src/client.ts` | Safety-net rebuilds dual-write when `event.event` is missing **or** fails `isPaymentEvent` / `schemaVersion !== '1'`. After rebuild, applies exported Stripe demotes. |
| `packages/core/src/gateways/stripe/stripe.gateway.ts` | Exported `demoteIncompleteSettledWebhookDualWrite` / `demoteIncompleteRefundWebhookDualWrite`. Payment-mode Checkout `no_payment_required` stays `paid` only when `amount_total` is `0` / unset; `amount_total > 0` → `pending`. |
| `packages/core/src/client.test.ts` | P610-SAFE-1 rebuild + incomplete-money / incomplete-refund demotes. |
| `packages/core/src/gateways/stripe/stripe.gateway.test.ts` | $0 vs positive `amount_total` checkout. |

### Stream F — Paymob (`P610-CLK-2`, `P610-CLK-3`, `P610-ABT-4`)

| File | Change |
| --- | --- |
| `packages/core/src/gateways/paymob/paymob.gateway.ts` | Cache TTL / prune / legacy token-cache use `this.clock.nowMs()`. JWT `exp` comparison still uses wall `Date.now()` (comment: epoch seconds, not cache TTL). `pruneExpiredIdempotencyEntries` never deletes `in_progress` / `unknown`. Timeout stays armed until body is consumed (`readResponseText`). Missing webhook `type` defaults to `""` (unmapped), not `TRANSACTION`. FIFO still refuses evicting in-flight/unknown fences. |
| `packages/core/src/gateways/paymob/paymob.gateway.test.ts` | Prune / clock / abort-until-body / missing type. |

### Stream G — Inbox engine (`P610-ACK-1`, `P610-ACK-2`, `P610-ACK-3`, `P610-SNAP-1`)

| File | Change |
| --- | --- |
| `packages/webhooks/src/engine.ts` | Inline `not_available` → `handler_failed { retryable: true }` (never `scheduled_for_retry`). Inline handler `fail` uses `retryAfterMs: 0`. Parked only after `store.fail({ restoreAttempt: true })` succeeds; park `lease_lost` → `already_processing` or retryable `handler_failed`. `bestEffortRecordFailAfterLeaseLost` sets `terminal` only when fail/dead_letter applied or reclaim kind is `already_completed` / `duplicate_failed`. Durable `payloadRef` via `resolveDurablePayloadRef` / `toPersistedPaymentEventEnvelope`; refuse `rawPayload`/`headers`. Sanitize `{ok:false}.reason`. |
| `packages/webhooks/src/types.ts` | Mode / parked / `not_available` / 408–425 comments. |
| `packages/webhooks/src/engine.test.ts` | P610-ACK-1 inline redelivery; P610-SNAP-1 refuse raw + sanitize reason. |
| `packages/webhooks/src/engine.modes.test.ts` | P610-ACK-2 park `lease_lost` is not parked. |
| `packages/webhooks/src/engine.crash.test.ts` | ACK-3 / crash reclaim aligned with non-fake terminal. |
| `packages/webhooks/README.md`, `packages/webhooks/docs/webhook-inbox.md` | Inline never `scheduled_for_retry`; parked only after persist; SNAP-1 honesty. |

### Stream H — Stores (`P610-STO-1`, `P610-STO-2`, `P610-STO-3`)

| File | Change |
| --- | --- |
| `packages/store-contracts/src/contracts.ts` | `FailWebhookInput` / inbox docs: matching token + `claimed` succeeds after expiry; `complete`/`renew` still need an active lease. `isStoreLeaseLostError`: adapters must throw `name === "StoreLeaseLostError"`; engine does **not** treat bare `{code:lease_lost}` as fencing (WEBHOOKS-6). Idempotency comment: classify completed/indeterminate **before** fingerprint_conflict. |
| `packages/testkit/src/memory/memory-stores.ts` | Webhook `fail()` does **not** `releaseExpiredLease` first. `maxEntries` skips / refuses `claimed`/`reserved` with an active lease. Idempotency reserve: completed/indeterminate before fingerprint. |
| `packages/testkit/src/memory/memory-stores.test.ts` | Fail-after-expiry; cap does not evict active leases. |
| `packages/testkit/src/storage/webhook-inbox-conformance.ts` | Claim → advance past lease → `fail` records pending/dead_letter. |
| `packages/testkit/docs/store-contracts.md` | Source of truth → `@paykernel/store-contracts`. |
| `packages/webhooks/src/store.ts` | Same WEBHOOKS-2 fail comments; `isStoreLeaseLostError` name-based, not bare code. |
| `packages/webhooks/src/memory-store.ts` | `maxEntries` will not evict active `claimed` rows. |
| `packages/sql-foundation/src/claims/algorithm.ts` | `decideIdempotencyReserve`: completed/indeterminate before fingerprint. `decideLeaseMutation` comments: `requireActiveLease: false` for webhook `fail` / A4. |

Stream H did **not** edit `packages/webhooks/src/engine.ts` or `packages/reconciliation/src/store.ts`.

### Stream I — Runtime (`P610-ABT-1`, `P610-ABT-2`, `P610-ABT-3`)

| File | Change |
| --- | --- |
| `packages/core/src/runtime/abort.ts` | Never `AbortSignal.timeout`; always `AbortController`+`setTimeout` so `clear()` cancels; `unref` when present. Duck-type `aborted` boolean + `addEventListener`. Polyfill tracks listeners and removes them when any input aborts. |
| `packages/core/src/runtime/abort.test.ts` | clear-cancels; duck-type extract; polyfill cleanup. |
| `packages/core/docs/runtime.md` | Deleted `Math.random` UUID fallback; CORE-3 throw + inject. Documents `createTimeoutSignal` (no `AbortSignal.timeout`). Scanner scope includes webhooks + store-contracts. |
| `scripts/check-runtime-portability.ts` | Scans `packages/core`, `packages/webhooks`, `packages/store-contracts` src+dist for `node:` / `bun:` / `cloudflare:`. |
| `scripts/check-runtime-portability.test.ts` | Multi-package scan cases. |

Stream I did **not** edit gateway HTTP helpers (B/C/F own P610-ABT-4).

---

## Verify commands

Run 2026-08-14 from monorepo root after the nine streams.

| Command | Result |
| --- | --- |
| `bun run typecheck` | **PASS** — all workspace packages `tsc --noEmit` exit 0 |
| Targeted `bun test` (below) | **FAIL** — **1179 pass, 1 fail**, 4399 expects, 31 files |
| `bun run check:runtime-portability` | **PASS** — core / webhooks / store-contracts src+dist clean; Deno smoke SKIP (binary not on PATH) |

Targeted test command:

```bash
bun test \
  packages/core/src/types/operation-result.test.ts \
  packages/core/src/types/operation-results.acceptance.test.ts \
  packages/core/src/types/payment-event.test.ts \
  packages/core/src/webhook-events.acceptance.test.ts \
  packages/core/src/runtime/abort.test.ts \
  packages/core/src/gateways/paypal/paypal.gateway.test.ts \
  packages/core/src/gateways/moyasar/moyasar.gateway.test.ts \
  packages/core/src/gateways/stripe/stripe.gateway.test.ts \
  packages/core/src/gateways/paymob/paymob.gateway.test.ts \
  packages/core/src/client.test.ts \
  packages/webhooks \
  packages/testkit/src/memory \
  packages/store-contracts \
  packages/sql-foundation
```

Failing test:

```
(fail) Phase 7 AC — handlers receive discriminated events
      > handleWebhook attaches PaymentEvent for handlers and onWebhookVerified
packages/core/src/webhook-events.acceptance.test.ts:303
Expected: "paid"
Received: "processing"
```

Fixture (`webhook-events.acceptance.test.ts` L282–294) is Moyasar `type: "payment_paid"` with `data.status: "paid"` and no `captured`. After stream C, `mapMoyasarStatus` / `mapPaymentResponse` fail-close paid-without-captured to `processing` (`moyasar.gateway.ts` L1781–1790). New P610-MAP-1/2 / HASH / RED AC cases in the same file pass.

Not re-run this pass: `bun run typecheck:types`, full `bun test packages/core packages/testkit packages/webhooks`, `bun test --coverage`, `bash scripts/validate-package.sh`, `bun run check:boundaries`.

---

## Gate (adversarial re-check)

Fail-closed on the workflow blocker list. Source evidence after the streams:

| Blocker | Result | Evidence |
| --- | --- | --- |
| **P610-MAP-1** unknown+paid is not `payment.succeeded` | **CLOSED** | `webhook-event-map.ts` L268–278: unknown Moyasar type → `provider.unmapped`. AC `webhook-events.acceptance.test.ts` P610-MAP-1. |
| **P610-MAP-2** unknown Paymob + success flags unmapped | **CLOSED** | `webhook-event-map.ts` L563–565; AC P610-MAP-2. Missing Paymob type no longer defaults to `TRANSACTION` (`paymob.gateway.ts` L3376). |
| **P610-ACK-1** inline never `scheduled_for_retry` | **CLOSED** | `engine.ts` L1122–1125 `not_available` + inline → `handler_failed`; L1152 inline fail `retryAfterMs: 0`. `engine.test.ts` P610-ACK-1. |
| **P610-ACK-2** parked only after persist | **CLOSED** | `engine.ts` L1156–1163: park `lease_lost` → `already_processing` / retryable `handler_failed`. `engine.modes.test.ts` P610-ACK-2. |
| **P610-ACK-3** no fake terminal | **CLOSED** | `engine.ts` L993–999: post-reclaim `fail` throw → `{ terminal: false }`; reclaim `already_completed`/`duplicate_failed` still terminal. |
| **P610-PP-1** reversed not outcome `succeeded` | **CLOSED** | `paypal.gateway.ts` L1639–1641 `cancelled \|\| reversed` → `failed`. |
| **P610-PP-2** partial not outcome `succeeded` | **CLOSED** | `paypal.gateway.ts` L1632–1637 `partially_captured` → `requires_action`. |
| **P610-INF-1** infer does not upgrade `partially_captured` | **CLOSED** | `operation-result.ts` L379–385 `isSettledSuccessStatus` omits `partially_captured`; L354–365 infers `requires_action`. |
| **P610-STO-1** testkit `fail` after expiry accepts matching token | **CLOSED** | `memory-stores.ts` L611–623: no `releaseExpiredLease` before token check. Conformance + `memory-stores.test.ts`. |
| **P610-HASH-1** JSON string secrets redacted before hash | **CLOSED** | `payment-event.ts` `tryParseJsonObjectOrArray` + `redactDeep`; AC P610-HASH-1. |
| **P610-MOY-1** JSDoc does not fulfill on `authorized` | **CLOSED** | `moyasar.gateway.ts` L467–468. |
| **P610-CLK-1** PayPal token uses injected clock | **CLOSED** | `paypal.gateway.ts` L1666–1669. |

Non-blocker IDs also addressed in source: P610-INF-2, P610-PP-3, P610-MOY-2/3, P610-HASH-2, P610-RED-1, P610-DOC-1, P610-SAFE-1, P610-ABT-1/2/3/4, P610-CLK-2/3, P610-STO-2/3 (contracts + webhooks + testkit; not reconciliation), P610-SNAP-1.

**Gate on listed P610 blockers: PASS** (source).  
**Independent verify (typecheck + targeted tests): FAIL** because one AC fixture disagrees with P610-MOY-2. Fail-closed overall verdict is therefore **FAIL**.

---

## Remaining nits

1. **Verify residual — Moyasar AC fixture vs P610-MOY-2.** Closed after the workflow: fixture now includes `captured: 1000`. `webhook-events.acceptance.test.ts` 30/30 pass.

2. **P610-IND-1 closed.** `NetworkError.afterProviderSubmit` + `BaseGateway` convert tagged post-submit mutation failures to `applyIndeterminatePaymentOutcome` / refund twin. Auth/GET still throw.

3. **`packages/reconciliation/src/store.ts` `isStoreLeaseLostError`** now matches class/name only (WEBHOOKS-6). Bare `{ code: "lease_lost" }` is not fencing.

4. **Paymob JWT `exp` still compared with `Date.now()`** in `resolveAuthTokenExpiry` (`paymob.gateway.ts` L2314–2315). Intentional: JWT exp is wall-clock epoch, not cache TTL. Cache TTL paths use `this.clock.nowMs()`.

5. **WEBHOOKS-2 hash shape honesty remains.** After redaction, `hashWebhookPayload(rawBodyString)` and `hashWebhookPayload(parsedObject)` may still differ (`payment-event.ts` L452–456). Documented, not a silent-ACK hole.

6. **`packages/webhooks/src/sanitize.ts` and `engine.concurrency.test.ts` untouched** (allowed in stream G, unused).

7. **Client safety-net applies Stripe demotes to every rebuilt event.** `demoteIncompleteSettledWebhookDualWrite` / `demoteIncompleteRefundWebhookDualWrite` no-op unless the snapshot is stripe-like (`payment_intent.succeeded` / `refund_completed` + matching stable types).

8. **Historical phase 6–10 reports** (`phase-6-gate-report.md` … `phase-10-gate-report.md`) still freeze `@paykernel/core@0.8.0`. Those are gate-time records, not live inventory.

9. **Working tree uncommitted.** Fix-stream diffs are local vs `2c41ad4`. Baseline `public-api.md` / `package-contents.md` were **not** regenerated this pass.

10. **Coverage / full suite / `validate:package` / `check:boundaries` / `typecheck:types` not re-run** this pass.

11. **`scripts/consumer-smoke.mjs`** still only asserts the published core smoke surface (unchanged).

---

## Checklist

- [x] Critic IDs confirmed against `HEAD` with file evidence
- [x] Nine streams recorded with owned files
- [x] Verify commands re-run; typecheck + portability green
- [x] Listed P610 blockers closed in source
- [x] Targeted tests green (Moyasar AC fixture given finite `captured`)
- [ ] `typecheck:types` / full core+testkit+webhooks / `validate:package` re-run
- [ ] P610-IND-1 (gateway indeterminate apply) closed
- [ ] Working tree committed

---

## Summary

Phase 6–10 critic IDs were present at `HEAD` and addressed across nine streams (infer/open-money, PayPal reversed/partial/refund/clock/abort, Moyasar fulfill-docs/captured/hash/clock/abort, mapper+hash+docs, Stripe/client safety-net, Paymob clock/prune/abort, inbox ACK/SNAP, store fail-after-expiry + lease comments, abort/portability). Listed blockers are closed in source. Post-gate fixture fix: Moyasar AC `handleWebhook` now proves captured amount. Typecheck green. Portability green (Deno SKIP). Working tree still uncommitted.
