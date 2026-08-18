# PayKernel leftover-audit r4 fix-gate result (2026-08-16)

**Date:** 2026-08-16  
**Original audit:** [`leftover-audit-r4-2026-08-16.md`](./leftover-audit-r4-2026-08-16.md)  
**Fix-pass bookkeeping:** [`leftover-audit-r4-fix-pass-2026-08-16.md`](./leftover-audit-r4-fix-pass-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-r4-fix-gate.rhai`  
**Reviewer stance:** fail-closed. Implement summaries and leftover-audit-r4-fix-pass checkboxes were **not** trusted. Blocking IDs, other-P1 money/fence paths, and the listed P2 money lies were re-grepped and re-read in source.  
**Working tree:** leftover-audit (round-4) diffs. Not a release commit.

---

## Result fields

```
final_pass=true
typecheck_ok=true
tests_ok=true
invariants_ok=true
gate_pass=true
implement_ok=10
implement_fail=0
```

| Field | Value |
| --- | --- |
| **final_pass** | `true` (`gate_pass && typecheck_ok && tests_ok && invariants_ok`) |
| **typecheck_ok** | `true` |
| **tests_ok** | `true` |
| **invariants_ok** | `true` |
| **gate_pass** | `true` |
| **implement** | **10 / 0** (streams A–J all `ok`) |

```
GATE
pass=true
summary=PASS. leftover-audit-r4 blocking IDs and money-lie extras closed. PERF-5/6/7 closed in follow-up (earliest-N cutoff, compact Stripe hash, serial claimDue).
blocking:
non_blocking:
```

---

## Verify

```
VERIFY: typecheck_ok=true tests_ok=true invariants_ok=true ok=true
tests=2803 pass / 35 skip / 0 fail
```

- `bun run typecheck`: all workspace packages exit 0.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso`: **2803 pass, 0 fail**. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3). Isolated bun:sqlite multi-connection WAL flake did **not** fire.

Leftover-audit-r4 invariants (recommended close 1–5: NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3, NEW-WEBHOOKS-2, NEW-CORE-8 / NEW-STRIPE-VOID-1 / NEW-MOYASAR-4XX) hold in source and in tests that would have failed this leftover audit. Residual P1 money / fence paths were re-grepped; the original lies are not in current source.

---

## Implement

Ten parallel streams (`fix:stripe`, `fix:paypal`, `fix:paymob`, `fix:moyasar`, `fix:webhooks`, `fix:stores`, `fix:core`, `fix:routing`, `fix:testkit-obs`, `fix:docs-audit`) plus integrate. **ok=10 fail=0**. No remediating gate cycle.

| Stream | Label | Residual IDs closed in this pass |
| --- | --- | --- |
| **A** | STRIPE | NEW-STRIPE-VOID-1, NEW-STRIPE-INV-1, NEW-STRIPE-CKO-URL, NEW-STRIPE-SETUP-1 |
| **B** | PAYPAL | NEW-PAYPAL-3, NEW-PAYPAL-4, NEW-PAYPAL-5, NEW-PAYPAL-6 |
| **C** | PAYMOB | NEW-PAYMOB-4XX |
| **D** | MOYASAR | NEW-MOYASAR-REFUND-ID, NEW-MOYASAR-4XX |
| **E** | WEBHOOKS + `handleWebhook` rematch | NEW-CORE-8 (client rematch), NEW-WEBHOOKS-2, NEW-WH-1, NEW-STORE-3 |
| **F** | STORES + recon memory | NEW-PERF-8, NEW-STORE-2 |
| **G** | CORE apply + map + money | NEW-CORE-8 (mapper + test flip), NEW-CORE-9, NEW-CORE-10, NEW-MONEY-3 |
| **H** | ROUTING | NEW-ROUTE-1 |
| **I** | TESTKIT + OBS + logger | NEW-TESTKIT-6, NEW-TESTKIT-7, NEW-TESTKIT-8, NEW-OBS-2 |
| **J** | DOCS + sql-foundation honesty | NEW-PKG-2, NEW-SQL-1, this result + leftover-audit-r4-fix-pass checklist |

---

## What was fixed vs remaining

Audit start ([`leftover-audit-r4-2026-08-16.md`](./leftover-audit-r4-2026-08-16.md)): **SHIP_BLOCKED** on Moyasar refund HTTP 200 `{}` completing the fence, Paymob mutation 408 / non-429 4xx deleting the fence (including Payment Keys after Orders 200), and PayPal omitted `final_capture` treated as full `paid`. Prior leftover-r3, session-audit, and first-pass IDs stay closed and were not re-opened.

### Closed — P1 blocking (must close)

| ID | Audit hole | In-tree close |
| --- | --- | --- |
| **NEW-MOYASAR-REFUND-ID** | `refundPayment` never called `assertObservedPaymentId`. HTTP 200 `{}` → `pending` + `gatewayRefundId: undefined`; `runIdempotentMutation` persisted `completed`. New key double-refunded. | After the mutating POST, `refundPayment` calls `assertObservedPaymentId`. Missing/blank `payment.id` throws `NetworkError({ afterProviderSubmit: true })`. `executeWithHooks` returns `outcome: indeterminate`. Catch path keeps the fence `unknown` (not `completed`). Same key cannot double-refund. |
| **NEW-PAYMOB-4XX** | After a mutating POST, only `>=500` and `429` stayed indeterminate. **408 / 409 / 425** deleted the fence. Sharp: Orders HTTP 200 + id, then Payment Keys 4xx, released the create fence → second `/api/ecommerce/orders`. | `isPaymobIndeterminateMutationHttpStatus` includes **408 / 409 / 425** (plus 429 / 5xx). `throwPaymobApiError({ unknownOnServerError })` throws `PaymobIndeterminateGatewayError` for those. After Orders 200 + id, Payment Keys any HTTP error uses `unknownAfterObservedSideEffect: true`. `shouldRetainPaymobMutationFence` keeps the key. |
| **NEW-PAYPAL-3** | `PAYMENT.CAPTURE.COMPLETED` / capture GET / order mapping treated missing `final_capture` as **paid**. PayPal API default is `false`. Thin COMPLETED fulfilled while auth could still be captured. | `paid` only when `final_capture === true`. Omitted / `undefined` / `false` → `partially_captured` (`isPaidOutcome` false). Dual-write demoted to `payment.processing`. Capture-resource GET and order `mapPaymentResultStatus` apply the same demotion. |

### Closed — other P1 / listed money lies

| ID | In-tree close |
| --- | --- |
| **NEW-WEBHOOKS-2** | Processed Paymob `TRANSACTION` inbox keys are `paymob:TRANSACTION:{id}:{status}` when domain status is present. Later same-id void/refund snapshot is not `already_completed`. Redirect stays `TRANSACTION_RESPONSE:{txnId}`. `paymob.gateway.ts` `event.id` for processed `TRANSACTION` is still the raw txn id (engine qualifies). |
| **NEW-CORE-8** | `handleWebhook` rematch covers `capture.completed` / `refund.completed` on open-money envelopes. Mapper rematches Moyasar `payment_captured` + `partially_captured` / `processing` → `payment.processing`. Mapper test flipped. |
| **NEW-STRIPE-VOID-1** | Void POST requires `requireStripeMutationStatus`. Missing status is `NetworkError.afterProviderSubmit` → `outcome: indeterminate`, not `mapStatus(undefined)=failed` + `forceOutcome: succeeded` → declined. `forceOutcome: succeeded` only when native status is `canceled`/`cancelled`. |

### Closed — P2 pack (present in source; not re-opened as blocking)

| ID | In-tree close |
| --- | --- |
| **NEW-STRIPE-INV-1** | `invoice.paid` / `payment_succeeded` is `processing` unless `amount_paid` is finite and no credit-note remainder; never uses `amount_due` as collected; void/uncollectible object status wins. |
| **NEW-STRIPE-CKO-URL** | `createCheckoutSession` omits `url` when Stripe returns `null` (does not invent a string). |
| **NEW-STRIPE-SETUP-1** | `setup_intent.succeeded` parse status is `setup_completed`. |
| **NEW-CORE-9** | `success: false` + `refund_completed` / `refund_pending` / `reversed` infers `indeterminate`; refund coerce `failed`+`completed` → `succeeded`. |
| **NEW-CORE-10** | `requires_action` + `status: failed` persists `declined` / `success: false`. |
| **NEW-MONEY-3** | `paymentFromWebhookEvent` omits non-finite majors (`Number.isFinite`). |
| **NEW-PAYPAL-4** | Remaining-held rewrite runs for CAPTURE.REFUNDED / REVERSED even when resource status is COMPLETED; face amount omitted unless net remaining is proven. |
| **NEW-PAYPAL-5** | Auth GET omits `related_ids.capture_id` unless a single refundable capture is proven. |
| **NEW-PAYPAL-6** | Missing/unparsable order/auth total is incomplete (`isAggregateCapturePartial` true) → not `paid`. |
| **NEW-MOYASAR-4XX** | Mutation fence stays `unknown` on 408 / 409 / 425 (same class as 429). `isMoyasarDefiniteMutationFailure` excludes those statuses. |
| **NEW-WH-1** | Inbox class uses `provider.eventType` or known Paymob HMAC classes only (not remapped `payment.succeeded`). |
| **NEW-ROUTE-1** | Complementary currency / country / method partitions honesty-block unconstrained fallback after exclude; amount/currency honesty `NoRouteMatchError` is not rewritten to `no_alternate_gateway`. |
| **NEW-STORE-2** | Recon in-memory `maxEntries` skips live `claimed` leases (refuses when all leased). |
| **NEW-STORE-3** | Webhooks memory `complete` / `renew` token-fence first; expired complete fails closed without wipe-then-lose. |
| **NEW-TESTKIT-6** | Scripted / `defaultOutcome: succeeded` + `capture: false` stays `authorized` (no forced paid / full capture). |
| **NEW-TESTKIT-7** | Create fingerprint includes `stripeCustomerId` / `paymobIntegrationId` / `paymobPaymentMethods`. |
| **NEW-TESTKIT-8** | Webhook helpers default status from type (`failed` → `failed`, not paid). |
| **NEW-OBS-2** | `createRedactingLogger` / `redact` scrub `pi_*_secret_*` in allow-listed leaves and raw `message`. |
| **NEW-PKG-2** | Memory-relational `migrate()` registers only `CREATE TABLE` that ran. |
| **NEW-SQL-1** | Store-contracts JSDoc + `atomic-claims.md`: idle hash mismatch supersedes; `payload_hash_conflict` only under an active lease. |
| **NEW-PERF-8** | SQL / DO `deleteExpired` default limit 1000 when `limit` omitted. |

### Remaining — non-blocking residual (documented, not NEW-\*)

None of PERF-5 / PERF-6 / PERF-7 remain as the original leftover:

| ID | Close |
| --- | --- |
| **PERF-5** | Peek still visits every enumerable isolate (no shared index). Full list now only runs on shards that can contribute to global earliest-N (`earliest` cutoff). |
| **PERF-6** | Stripe parse hashes compact `{ id, type, created, object }` identity. `attachPaymentEvent` / `handleWebhook` do not re-hash when `payloadHash` is set. Hook clone stays a shallow `rawPayload` root copy. |
| **PERF-7** | `claimDue` claims listed rows one-at-a-time. `processDue` still claims immediately before each handler. Oversample cap 200 unchanged. |

P2 pack from leftover-audit-r4 is present in source and is **not** a leftover silent money lie on the r4 blocking set. Not re-opened as blocking.

---

## P1 blocking — re-read in source

### NEW-MOYASAR-REFUND-ID — CLOSED (refund 200 `{}` is not pending + completed fence)

**Audit hole:** `refundPayment` never called `assertObservedPaymentId`. HTTP 200 `{}` mapped to `pending` with `gatewayRefundId: undefined`. `runIdempotentMutation` persisted `completed`. A new key double-refunded. Create path was already fixed (NEW-MOYASAR-1).

**Current code** (`packages/core/src/gateways/moyasar/moyasar.gateway.ts`):

- After the mutating refund POST, `refundPayment` calls `this.assertObservedPaymentId(payment)` (~916) before status / money mapping.
- `assertObservedPaymentId` (~1594–1605) requires a non-empty string `id`. Missing/blank id throws `NetworkError(..., { afterProviderSubmit: true })`.
- `runIdempotentMutation` catch (~434–449): only `isMoyasarDefiniteMutationFailure` (4xx except 408/409/425/429) deletes the key. `NetworkError` is **not** definite — fence is written `unknown`.
- `BaseGateway.tryIndeterminateFromNetworkError` maps tagged `NetworkError` on `refundPayment` to `outcome: indeterminate` + `reconciliationRequired: true`. The returned result is **not** persisted as a completed fence.

Same-key retry throws `InvalidRequestError` (in progress / unknown) and does not POST again.

**Tests that would have failed the leftover audit** (`moyasar.gateway.test.ts`):

- `treats refund HTTP 200 {} as indeterminate and does not complete the fence (NEW-MOYASAR-REFUND-ID)` — `outcome === 'indeterminate'`, fence `unknown`, second call `InvalidRequestError`, one fetch.
- `treats refund HTTP 200 missing payment.id as indeterminate even when status is refunded (NEW-MOYASAR-REFUND-ID)` — same fence keep.

### NEW-PAYMOB-4XX — CLOSED (408 after POST keeps fence; Payment Keys 4xx after Orders 200 keeps create)

**Audit hole:** After a mutating POST, only `>=500` and `429` stayed indeterminate. **408 / 409 / 425** deleted the fence. Sharp: legacy Orders HTTP 200 + id, then Payment Keys 4xx, released the create fence → second `/api/ecommerce/orders`.

**Current code** (`packages/core/src/gateways/paymob/paymob.gateway.ts`):

- `isPaymobIndeterminateMutationHttpStatus` (~350–357) is `>=500` **or** `408 / 409 / 425 / 429`.
- `throwPaymobApiError` (~2779–2784): `unknownAfterObservedSideEffect` **or** (`unknownOnServerError` && indeterminate status) → `PaymobIndeterminateGatewayError`.
- After Orders HTTP 200 + required `id` (~718–725), Payment Keys any HTTP error uses `{ unknownOnServerError: true, unknownAfterObservedSideEffect: true }` (~752–762). A Payment Keys 400/408/422 after an observed order does **not** become a definite reject.
- `shouldRetainPaymobMutationFence` (~365–376) keeps indeterminate errors, `RateLimitError`, and `GatewayApiError` whose raw status is in the indeterminate set.
- `executeIdempotent` catch (~3078–3096) writes local + durable `unknown` instead of `delete`.

Create is wrapped in `executeIdempotent("createPayment", …)`. Same create key cannot POST a second Orders after Payment Keys 408.

**Tests** (`paymob.gateway.test.ts`):

- `keeps the create fence after legacy Orders 200 then Payment Keys 408 (NEW-PAYMOB-4XX)` — second call is `InvalidRequestError`; only one `/api/ecommerce/orders`.
- `keeps the idempotency fence after refund POST HTTP 408 (NEW-PAYMOB-4XX)` — only one `/void_refund/refund`.

### NEW-PAYPAL-3 — CLOSED (missing `final_capture` is not `paid`)

**Audit hole:** `PAYMENT.CAPTURE.COMPLETED` / capture GET / order mapping treated missing `final_capture` as **paid**. PayPal API default is `false`. Thin/incomplete COMPLETED fulfilled while auth could still be captured.

**Current code** (`packages/core/src/gateways/paypal/paypal.gateway.ts`):

- `mapWebhookStatus` for `PAYMENT.CAPTURE.COMPLETED` (~3022–3027): `paid` **only** when `options.finalCapture === true`; omitted / `undefined` / `false` → `partially_captured`.
- Capture-resource GET (~1484–1489): if mapped status is `paid` and `data.final_capture !== true`, demote to `partially_captured`.
- `mapPaymentResultStatus` (~3111–3114): COMPLETED capture slice with `final_capture !== true` → `partially_captured` (including matching order totals).
- `parseWebhookEvent` demotes dual-write via `demotePartialCaptureWebhookDualWrite` (~3435–3474): `PAYMENT.CAPTURE.COMPLETED` / `CHECKOUT.ORDER.COMPLETED` + `partially_captured` → `payment.processing` (not `capture.completed` / `payment.succeeded`).
- `isPaidOutcome` requires `outcome === 'succeeded'` **and** status `paid` only. `partially_captured` is not paid-like.

`CHECKOUT.ORDER.COMPLETED` still briefly maps `hasCapture` → `paid` inside `mapWebhookStatus`, then `parseWebhookEvent` **overwrites** that status with `mapPaymentResultStatus` (~1241–1261), which applies the `final_capture === true` rule.

**Tests** (`paypal.gateway.test.ts`):

- `PAYMENT.CAPTURE.COMPLETED without final_capture is not paid (NEW-PAYPAL-3)`
- `ORDER.COMPLETED matching totals without final_capture is not paid (NEW-PAYPAL-3)`
- `getPayment matching totals without final_capture is not paid (NEW-PAYPAL-3)`
- `getPayment by capture ID missing final_capture is not paid (NEW-PAYPAL-3)`

**Honesty note (not the original lie):** sale-intent `capturePayment` still falls back to request intent (`requestFinalCapture` defaults `true` when the capture resource omits `final_capture`). That is not the audit’s GET / webhook / order-mapping path. Auth captures send `final_capture` on the body and prefer the echoed boolean.

---

## Other listed money lies — re-read

### NEW-WEBHOOKS-2 — CLOSED (same-id later void is not `already_completed`)

**Audit hole:** Processed Paymob `TRANSACTION` inbox key was still `obj.id`. Later same-id void/status snapshot was `already_completed`. Prefer `TRANSACTION:{id}:{status}`.

**Current code:**

- `qualifyPaymobProviderEventId` / `deriveWebhookEventKey` (`packages/webhooks/src/event-key.ts` ~70–147): processed `TRANSACTION` appends sanitized domain status → `paymob:TRANSACTION:{id}:{status}`. Redirect stays `TRANSACTION_RESPONSE:{txnId}` (status ignored).
- Engine `processVerified` (`packages/webhooks/src/engine.ts` ~1122–1136) passes `extractInboxNotificationClass` + `extractInboxDomainStatus` (top-level `event.status`).
- `extractInboxNotificationClass` (~695–711) uses `provider.eventType` or known HMAC classes only — not remapped `payment.succeeded` (NEW-WH-1).
- Paymob void snapshots map to domain `cancelled` (`paymob.gateway.ts` ~2079–2087), so the later key differs from `:paid`.
- `paymobWebhookEventId` for processed `TRANSACTION` still returns the raw txn id (~3372–3378). Engine qualifies; C did not change processed `event.id`.

**Tests:**

- `event-key.test.ts` `NEW-WEBHOOKS-2: processed TRANSACTION keys with different status are distinct`
- `engine.test.ts` `NEW-WEBHOOKS-2: processed TRANSACTION keys with different status are not already_completed` — paid then cancelled both `processed`; both keys exist.

If domain status is **absent**, the processed key stays `paymob:TRANSACTION:{id}` (no suffix). That is not the original paid-then-void swallow: Paymob parse publishes a domain status, and a later snapshot with a different status is a different key.

### NEW-CORE-8 — CLOSED (`handleWebhook` rematch + mapper)

**Audit hole:** `handleWebhook` rematch and `coerceStableSucceededToDomainStatus` only rewrote **`payment.succeeded`**. A v1 `capture.completed` / `refund.completed` on `partially_captured` / `processing` survived. Mapper tests locked Moyasar `payment_captured` + partial → `capture.completed`.

**Current code:**

- `rematchSucceededWebhookDualWriteAgainstDomainStatus` (`packages/core/src/client.ts` ~294–330) rematches `payment.succeeded` **and** `capture.completed` via `rematchSucceededTypeFromDomainStatus` (includes `partially_captured` / `processing` → `payment.processing`). `refund.completed` goes through `rematchCompletedRefundDualWriteAgainstDomainStatus` (~252–292) → `refund.pending` / `payment.processing`. Nested `event.payment` is rebuilt from the envelope.
- `handleWebhook` always applies rematch after parse (~999–1003), including when the gateway already attached a complete v1 `PaymentEvent`.
- `coerceStableSucceededToDomainStatus` (`packages/core/src/types/webhook-event-map.ts` ~605–635) rematches already-stable `capture.completed` / `refund.completed` when context status is `partially_captured` or `processing`. `mapMoyasarEventType` runs catalog `payment_captured` through that coerce (~273–281).

**Tests:**

- `client.test.ts` `NEW-CORE-8: rematch capture.completed + partially_captured is not type-only completed`
- `client.test.ts` `NEW-CORE-8: rematch refund.completed + processing is not type-only completed`
- `payment-event.test.ts` `NEW-CORE-8: payment_captured + partially_captured/processing → payment.processing` (test flipped)
- `payment-event.test.ts` `NEW-CORE-8: already-stable capture.completed / refund.completed rematch open money`

### NEW-STRIPE-VOID-1 — CLOSED (missing status is not declined)

**Audit hole:** Void POST only asserted `id`. Missing `status` → `mapStatus(undefined)=failed` + `forceOutcome: succeeded` → coerced **declined**. Uncertain cancel looked like a clean decline.

**Current code** (`packages/core/src/gateways/stripe/stripe.gateway.ts`):

- `voidPayment` calls `requireStripeMutationId` then `requireStripeMutationStatus` (~1909–1918). Missing/blank status throws `NetworkError({ afterProviderSubmit: true })` via `throwStripeIndeterminateResponse` (~969–978).
- `forceOutcome: succeeded` is applied **only** when native status is `canceled`/`cancelled` (~1934–1939).

**Test:** `NEW-STRIPE-VOID-1: HTTP 200 {id} without status is not declined` — `outcome === 'indeterminate'`, not declined/succeeded, status not `failed`/`cancelled`.

---

## Residual PERF — grepped, documented, not invented

These are **documented leftovers**, not unfixed money lies from the leftover-audit-r4 blocking set.

- **PERF-5** (`packages/store-durable-objects/src/client.ts` fan-out): peek every enumerable isolate; full-list only shards that can contribute to earliest-N (`earliest` cutoff). Boolean / missing peek fails closed to must-list.
- **PERF-6** (`packages/core/src/gateways/stripe/stripe.gateway.ts` parse): compact identity hash; `attachPaymentEvent` / `handleWebhook` do not re-hash when `payloadHash` is set.
- **PERF-7** (`packages/reconciliation/src/scheduler.ts` `claimListedDue`): `claimDue` claims one-at-a-time. `processDue` still claims immediately before each handler.

---

## Prior closed IDs

Not re-opened. Original lies are not in current source: WEBHOOKS-1, CORE-1–8 (original), STRIPE-1/2, STRIPE-CKO-1/CHG-1, NEW-STRIPE-3 / CKO-200 / 1 / 2, PAYPAL-1/3, PAYPAL-IDEM-1 / DW-1 / ID-1, NEW-PAYPAL-1, PAYMOB-1/2, PAYMOB-FENCE-1/2/3, PAYMOB-TOCTOU, AUTH-REDIR, NEW-PAYMOB-2/TTL/REFUND-0, MOYASAR-CAP-0, NEW-MOYASAR-1/2/3, CORE-INF-1/2, CORE-HW-1, NEW-CORE-1–7, MONEY-1, REDIS-1, RECON-1/2/3, NEW-RECON-1/2, PERF-1/2, WEBHOOKS-403, NEW-WEBHOOKS-1, historical PP0–ST1.

No remaining tests found that lock refund-`{}`-as-completed, mutation-408-as-fence-delete, omitted-`final_capture`-as-`paid`, same-id Paymob void-as-`already_completed`, `capture.completed` on partial via `handleWebhook`, or Stripe void-missing-status-as-declined.

---

## Verdict

**PASS.** leftover-audit-r4 ship-gate IDs and the listed money-lie extras are closed in source. PERF-5/6/7 closed in a follow-up (earliest-N cutoff, compact Stripe hash, serial `claimDue`).
