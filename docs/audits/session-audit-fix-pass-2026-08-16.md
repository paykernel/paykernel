# PayKernel session-audit fix pass (2026-08-16)

**Source of truth:** [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md)  
**Prior ship-gate write-up:** [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md), [`deep-audit-fix-pass-2026-08-16.md`](./deep-audit-fix-pass-2026-08-16.md), [`deep-audit-fix-result-2026-08-16.md`](./deep-audit-fix-result-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map, residual-ID checklist, and (later) integrate landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` only. Does **not** claim a post-fix gate result (that is `session-audit-fix-result-2026-08-16.md` after a formal gate).  
**Working tree:** uncommitted session-audit leftover diffs. Do **not** re-open first-pass ship-gate IDs unless current code still has the original lie.

**Audit verdict at pass start:** **SHIP_BLOCKED** on new fence-release / dual-write leftovers.

Prior ship-gate IDs (WEBHOOKS-1, CORE-1, STRIPE-1/2, PAYPAL-1/3, PAYMOB-2 Intention) stay **already closed**. Historical PP0–ST1 stay already fixed. Disputed list is empty.

---

## Residual inventory (from session audit)

Do not ship until **P1 blocking** are fixed and covered by tests that would have failed this leftover audit. Critic / implement streams skip any ID they prove already fixed against current code; this bookkeeping list is the audit residual set, not a landing score.

**Counts:** 6 P1 blocking + 12 P1 other + 8 P2 = **26 residual IDs**.

### P1 blocking

Fence-release / dual-write / non-retryable drop of a signature-valid paid body. Must close.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **PAYMOB-FENCE-1** | P1 | Durable `reserveStoredIdempotencyRecord` deletes any row with expired `expiresAt`, including `unknown` / `in_progress`. Indeterminate refund/capture/void is stamped `expiresAt: now+24h`. After 24h the same key re-enters the mutation (double-apply). In-memory cache correctly never evicts those fences. | C |
| **PAYMOB-FENCE-2** | P1 | Caller abort after a mutating POST becomes `PaymentAbortedError`. `fetchPaymobMutation` only wraps `NetworkError` as indeterminate. `executeIdempotent` then **deletes** the fence. Timeout on the same body-read is indeterminate; `AbortController` / worker cancel is not. | C |
| **PAYMOB-FENCE-3** | P1 | Legacy Egypt create still uses `requireNumber` / `requireString` → `GatewayApiError` on HTTP 200 missing order id / payment token, which **releases** the fence. Intention was fixed; this path was not. | C |
| **PAYPAL-IDEM-1** | P1 | `getRequestId("")` keeps the empty string; `if (requestId)` skips `PayPal-Request-Id`. In-process `withRetry` after timeout/5xx can double-mutate. Stripe trims empty keys and always generates. | B |
| **PAYPAL-DW-1** | P1 | `PAYMENT.CAPTURE.REFUNDED` domain status is fail-closed `partially_refunded`, but static map still dual-writes `refund.completed`. Demote only runs for `status === "refund_completed"`. Type-only handlers can close the capture as fully refunded. | B |
| **WEBHOOKS-403** | P1 | `InvalidWebhookError` is always constructed with HTTP **403**. Parse-stage messages skip *forgery* but then hit `isPermanentClientHttpStatus(403)`. `processWithVerifier` + `parseWebhookEvent` can drop a signature-valid paid body as non-retryable. `handleWebhook` is safe (rewrites to `InvalidRequestError`). | E |

### P1 other (fix in this pass)

Production money / status / recovery holes. Gate may also treat still-present money lies as blocking.

| ID | One-line | Stream |
| --- | --- | --- |
| **STRIPE-CKO-1** | `checkout.session.completed` (`payment_status: paid`) and `async_payment_succeeded` ignore refunds. Docs tell integrators to hydrate the current Stripe object; Checkout stays `paid` after refunds. PI.succeeded was fixed; Checkout was not. | A |
| **STRIPE-CHG-1** | `stripeSucceededIntentRefundStatus` only reads expanded `latest_charge`. If `latest_charge` is omitted and refunds live on `charges.data[0]`, settled math can still reach `paid`. | A |
| **CORE-INF-1** | `inferOperationOutcome`: `success: false` + `paid` / `authorized` / `partially_captured` / `refunded` → `failed` (P610-INF-2 only lists pending/processing/approved). Retry-as-failed can double-charge. | G |
| **CORE-INF-2** | `inferRefundOperationOutcome`: `success: false` + `status: "completed"` → `failed`. Retry can double-refund. | G |
| **CORE-HW-1** | `handleWebhook` skips demote when `isPaymentEvent` passes. A complete v1 `payment.succeeded` arm with envelope `processing` / `partially_captured` is trusted. Built-ins rematch first; custom / dishonest attach skips the safety net. | E |
| **CORE-6-EXT** | `coerceStableSucceededToDomainStatus` only remaps failed/pending/processing. Already-stable `payment.succeeded` + `authorized` / `approved` / `partially_captured` stays succeeded. | G |
| **PAYPAL-ID-1** | Webhook `gatewayPaymentId` uses last / `related_ids.capture_id` unless `refundableCaptureCount > 1`. Siblings `[COMPLETED $50, later REFUNDED $50]` attach remaining-held money to the **refunded** capture. `getPayment` would have published the held id. | B |
| **PAYMOB-TOCTOU** | Store without `reserve()` is get-then-set. Moyasar throws; Paymob warns and continues. Concurrent workers can double-apply. | C |
| **RECON-LEASE-1** | Recon `fail` / `complete` still require `lease_expires_at > now`. Handler overrun → `lease_lost` → `listDue` restores an attempt → reclaim forever. `maxAttempts` never dead-letters. | F (store fail-after-expiry) + H (scheduler hang budget) |
| **WH-LIST-FAIL** | `listRetryable` / `listDue` wipe lease token on expired claimed. A late `fail()` then cannot record (token gone). Concurrent poller defeats post-expiry fail. | E (engine / honesty) + F (list UPDATE) |
| **MOYASAR-CAP-0** | `paid` + finite `captured: 0` is not demoted (only missing captured is). Dual-write can stay `payment.succeeded` and publish full amount. | D |
| **PAYMOB-AUTH-REDIR** | AUTH redirect (`is_auth` + success) dual-writes `payment.authorized`. Sale redirect is demoted to `payment.processing`; AUTH is not. | G (map) — C may only comment `paymob.md` |

### P2 (fix if cheap; do not leave as silent money lie)

Honesty, indexes, poll cost. None confirmed false-paid / double-refund on built-in default paths.

| ID | One-line | Stream |
| --- | --- | --- |
| **MOYASAR-3** | Public `moyasarSource` / `CreditCardSource` JSDoc still advertise raw `creditcard`. Runtime rejects. Honesty only. | D (`payment.types.ts` JSDoc only) |
| **SQL-UPD-1** | Postgres expired-claim `UPDATE … WHERE key IN (SELECT claimed …)` does not re-check `status = 'claimed'`. Concurrent pollers can double-decrement `attempts`. | F |
| **PERF-3** | Composite list indexes exist in sql-foundation v1 DDL only. `migrate()` skips applied v1. D1 Wrangler `0001_foundation.sql` is still single-column. | F (new migration version; do **not** rewrite applied v1) |
| **PERF-4** | Redis `listDue` / `listRetryable` is ZRANGE + N Lua GETs. | F (batch if cheap; else comment + SCAN-off-poll test) |
| **PERF-5** | DO `listDue` wakes every hash isolate at full `limit`. | F (document fan-out if no cheaper correct global earliest-N) |
| **PERF-6** | Webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. | **unowned for code this pass** (A owns `stripe.gateway.ts`; G must not edit it). Document residual. |
| **PERF-7** | `processDue` / `processRetryable` still list-then-serial-claim. | H (keep fencing; do not oversample beyond existing 200 cap) |
| **REDIS-CLEAN-1** | `deleteExpired` default `limit` is `Infinity` (SCAN + per-key EVAL). | F (bounded default, e.g. 1000; allow explicit higher) |

---

## Stream ownership

Non-overlapping file ownership from `paykernel-session-audit-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | STRIPE-CKO-1, STRIPE-CHG-1 |
| **B** | PAYPAL | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` | PAYPAL-IDEM-1, PAYPAL-DW-1, PAYPAL-ID-1 |
| **C** | PAYMOB | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | PAYMOB-FENCE-1, PAYMOB-FENCE-2, PAYMOB-FENCE-3, PAYMOB-TOCTOU |
| **D** | MOYASAR | `packages/core/src/gateways/moyasar/**`, `packages/core/docs/moyasar.md`, `packages/core/src/types/moyasar-source.types.ts`, `packages/core/src/types/payment.types.ts` **only** the `moyasarSource` JSDoc (MOYASAR-3) | MOYASAR-CAP-0, MOYASAR-3 |
| **E** | WEBHOOKS + `handleWebhook` | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md`, `packages/core/src/client.ts`, `packages/core/src/types/payment-event.ts` if CORE-HW-1 needs a tighter guard, `packages/core/docs/webhooks.md` | WEBHOOKS-403, CORE-HW-1, WH-LIST-FAIL (engine / honesty half) |
| **F** | STORES + sql-foundation | `packages/store-redis/src/**`, `packages/store-postgres/src/**`, `packages/store-sqlite/src/**`, `packages/store-d1/src/**`, `packages/store-d1/migrations/**`, `packages/store-turso/src/**`, `packages/store-durable-objects/src/**`, `packages/sql-foundation/src/**`, `packages/sql-foundation/docs/**` | RECON-LEASE-1 (store fail-after-expiry), WH-LIST-FAIL / SQL-UPD-1 (outer `status = 'claimed'`), PERF-3, PERF-4, PERF-5, REDIS-CLEAN-1 |
| **G** | CORE infer + webhook-event-map | `packages/core/src/types/operation-result.ts`, `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/operation-result.test.ts`, `packages/core/src/types/payment-event.test.ts` if map tests live there, `packages/core/docs/operation-results.md` | CORE-INF-1, CORE-INF-2, CORE-6-EXT, PAYMOB-AUTH-REDIR |
| **H** | RECON scheduler + ROUTING | `packages/reconciliation/src/**`, `packages/reconciliation/docs/**`, `packages/routing/src/**`, `packages/routing/docs/**` | RECON-LEASE-1 (scheduler hang budget), PERF-7 |
| **I** | TESTKIT + OBS polish | `packages/observability/src/**`, `packages/observability/docs/**`, `packages/testkit/src/**` | none (no new P1 money IDs). Do not flip production adapters. Only update testkit if a mock trains checkout-paid-after-refund or `success:false`+`paid` as `failed`. |
| **J** | DOCS audit bookkeeping | `docs/audits/**` only | this file |

### Ownership fences (do not cross)

- **B** rematch dual-write **inside** `paypal.gateway.ts` after attach (same family as existing demote helpers). **B** must not edit `webhook-event-map.ts` (**G**).
- **C** must not edit `webhook-event-map.ts` (**G** owns PAYMOB-AUTH-REDIR). **C** may only comment `paymob.md` for AUTH redirect.
- **D** must not edit `payment.types.ts` beyond the `moyasarSource` JSDoc.
- **E** owns `client.ts` and (if needed) `payment-event.ts`. **E** must not change store SQL (**F** owns list UPDATE).
- **F** owns recon `fail` templates and expired-claim UPDATE. **H** must not edit `store-*` SQL; **H** owns scheduler policy for hang / `lease_lost`.
- **G** must not edit `client.ts` or `payment-event.ts` (**E**). **G** must not edit `payment.types.ts` (**D**).
- **G** must not edit `stripe.gateway.ts` even for PERF-6.
- **I** must not flip production gateway / infer adapters.
- **J** must not edit `packages/**`.
- Built-in PaymentStatus values to prefer (do not invent new ones): `partially_captured`, `partially_refunded`, `refund_pending`, `refund_failed`, `refund_completed`, `setup_completed`, `paid`, `pending`, `processing`, `authorized`.
- Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split IDs

**RECON-LEASE-1 (F + H)**

1. **F (store half):** recon `fail` (and `markManualReview` if needed) must accept a matching `lease_token` on `status=claimed` even after `lease_expires_at <= now` (webhook WEBHOOKS-2 parity). `complete` may stay unexpired-only if that is the documented crash boundary — but fail after hang must record retry / dead-letter. Apply postgres / sqlite / d1 / turso / do / redis consistently.
2. **H (scheduler half):** a handler that overruns `defaultLeaseMs` must not livelock forever. After F allows fail-after-expiry, `processDue` should `failAndReschedule` (or `fail`) on hang/throw so attempts can reach `maxAttempts`. If fail is still `lease_lost` because `listDue` already wiped the token, do not treat that as a free infinite reclaim without budget.

**WH-LIST-FAIL (E + F)**

1. **F:** expired-claim UPDATE must re-check `status = 'claimed'` in the outer `WHERE` (SQL-UPD-1) so concurrent pollers cannot double-decrement `attempts`.
2. **E:** if the engine can fail after expiry, document that a concurrent `listRetryable` that already soft-released the token will `lease_lost` (at-least-once). Prefer: on `lease_lost` from fail-after-handler, still return `handler_failed` retryable and do **not** complete.

**PAYMOB-AUTH-REDIR (G, not C)**

Map lives in `webhook-event-map.ts`. Redirect + `authorized` must demote to `payment.processing` (include `payment.authorized` in `PAYMOB_FULFILLMENT_READY_STABLE` or an adjacent redirect demote set). C comments only.

---

## Recommended close (audit §)

1. PAYMOB-FENCE-1 / 2 / 3  
2. PAYPAL-IDEM-1  
3. PAYPAL-DW-1  
4. WEBHOOKS-403  
5. STRIPE-CKO-1 / STRIPE-CHG-1  
6. CORE-INF-1 / CORE-INF-2 / CORE-HW-1 / CORE-6-EXT  
7. PAYPAL-ID-1, PAYMOB-TOCTOU, RECON-LEASE-1, WH-LIST-FAIL, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR  
8. P2 pack  

Items **1–4** are this leftover pass’s ship gate (blocking). Items **5–7** are still this-pass P1s; gate may promote any still-present money lie into blocking.

---

## Already closed (do not re-open)

From session-audit “Already closed” and the first-pass ship-gate. Do **not** re-open unless current code still has the **original** lie.

```
WEBHOOKS-1   (redirect vs processed inbox key)
CORE-1       (refund pending infer)
STRIPE-1     (refund entity status)
STRIPE-2     (PI.succeeded + unexpanded charge)
PAYPAL-1     (domain status on CAPTURE.REFUNDED)
PAYPAL-3     (no invented COMPLETED capture)
PAYMOB-2     (Intention fence)
CORE-2/3/4   (original forms)
MONEY-1      (JMD/XCG/XAD)
REDIS-1      (rescore)
RECON-1/2/3  (original forms)
PERF-1/2     (original forms)
OBS-1/2
TESTKIT-1/2/3/4
PKG-1
```

These are leftover **adjacent** classes, not regressions of the original IDs:

| First-pass close | This-pass leftover |
| --- | --- |
| PAYMOB-2 Intention `requireMutationString` keeps fence | PAYMOB-FENCE-3 legacy Egypt `requireNumber` / `requireString` still releases |
| In-memory Paymob prune keeps `unknown` / `in_progress` | PAYMOB-FENCE-1 durable reserve deletes expired fences including those statuses |
| Timeout body-read is indeterminate | PAYMOB-FENCE-2 caller abort after POST is `PaymentAbortedError` and clears fence |
| PAYPAL-1 domain `partially_refunded` on refund-shaped CAPTURE.REFUNDED | PAYPAL-DW-1 static map still dual-writes `refund.completed` |
| STRIPE-2 PI.succeeded reads expanded `latest_charge` refunds | STRIPE-CKO-1 Checkout ignores refunds; STRIPE-CHG-1 omitted `latest_charge` + `charges.data[0]` |
| CORE-1 / P610-INF-2 `!success` + pending/processing/approved → indeterminate | CORE-INF-1/2 `!success` + settled statuses still → `failed` |
| CORE-6 remaps failed/pending/processing | CORE-6-EXT already-stable succeeded + authorized/approved/partial stays succeeded |
| WEBHOOKS-3 parse `InvalidWebhookError` excluded from forgery-class | WEBHOOKS-403 same error is HTTP 403 → `isPermanentClientHttpStatus` |
| PERF-1 SCAN off poll; PERF-2 SQL UPDATE bounded | PERF-3/4/5/6/7 and REDIS-CLEAN-1 leftover cost / index / default-limit holes |

---

## Stream J status

Wrote this ownership + residual checklist. Stream J did **not** edit `packages/**`.

**fixed_ids (this stream):** none — J is bookkeeping only.

Integrate (workflow phase after A–J) must update this file with what landed vs remaining. Formal gate artifact is `session-audit-fix-result-2026-08-16.md` (not this file).

---

## Integrate result (2026-08-16, uncommitted)

**Do not commit** (integrate instruction). Working tree is the A–I stream diffs plus the four integrate-phase seams below. This file is still **not** a formal gate result.

**Verify:** `bun run typecheck` green across the monorepo. `bun test` on core / webhooks / reconciliation / routing / testkit / observability / store-contracts / sql-foundation / store-d1 / store-durable-objects / store-redis / store-postgres / store-sqlite / store-turso → **2673 pass / 35 skip / 0 fail**. Known sql-foundation bun:sqlite WAL flake did **not** reproduce.

### Invariant cross-check (blocking)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **PAYMOB-FENCE-1** | landed | `isStoredIdempotencyReplayExpired` is `status === "completed"` only. `reserveStoredIdempotencyRecord` / `getStoredIdempotencyRecord` never `delete` expired `unknown` / `in_progress`. Expired `in_progress` is retained as `unknown`. Tests: `paymob.gateway.test.ts` expired durable unknown / in_progress refuse re-reserve. |
| **PAYMOB-FENCE-2** | landed | `fetchPaymobMutation` wraps `NetworkError` **and** `PaymentAbortedError` as `PaymobIndeterminateNetworkError`. `executeIdempotent` keeps the fence. Tests: abort after Intention / refund POST. |
| **PAYMOB-FENCE-3** | landed | Legacy Egypt Orders uses `requireMutationNumber` (order id); Payment Keys uses `requireMutationString` (token). HTTP 200 missing id/token → `PaymobIndeterminateResponseError`, fence kept. Tests: missing token / missing order id. |
| **PAYPAL-IDEM-1** | landed | `getRequestId` trims; empty / whitespace mints UUID. `createJsonHeaders` always sets `PayPal-Request-Id`. Test: empty key still generates and header is sent. |
| **PAYPAL-DW-1** | landed | `demoteIncompleteRefundWebhookDualWrite` rematches `PAYMENT.CAPTURE.REFUNDED` + `partially_refunded` **and** `status === "refund_completed"` off `refund.completed` → `refund.pending`. Proven `refunded` stays `refund.completed`. Test: refund-resource COMPLETED is not type-only `refund.completed`. Static `mapProviderEventTypeToStable` without status still names `refund.completed` (G mapper); rematch is inside `paypal.gateway.ts` after attach (B ownership). |
| **WEBHOOKS-403** | landed | `isPermanentNonRetryableVerifyError` excludes non-verify `InvalidWebhookError` (always HTTP 403). Parse-stage + fail-open unknown InvalidWebhook → `handler_failed { retryable: true }`. Forgery stays verify-false only. Tests: `engine.test.ts` WEBHOOKS-403. `handleWebhook` still rewrites parse to `InvalidRequestError`. |

### Other P1

All landed in stream ownership:

| ID | Where |
| --- | --- |
| **STRIPE-CKO-1** | Checkout `completed` / `async_payment_succeeded` hydrate refunds; paid-after-refund is not `paid` / `payment.succeeded`. |
| **STRIPE-CHG-1** | `stripeSucceededIntentRefundStatus` falls through to `charges.data[0]` when `latest_charge` is omitted. Unexpanded string charge still fail-closes to `processing`. |
| **CORE-INF-1** | `inferOperationOutcome`: `success: false` + paid / authorized / partially_captured / refunded / partially_refunded → `indeterminate`. |
| **CORE-INF-2** | `inferRefundOperationOutcome`: `success: false` + `completed` → `indeterminate`. |
| **CORE-HW-1** | `handleWebhook` always rematches a complete v1 `payment.succeeded` arm against processing / partial / authorized / approved. |
| **CORE-6-EXT** | `coerceStableSucceededToDomainStatus` remaps authorized / approved / partially_captured / refunded / partially_refunded → `payment.processing`. |
| **PAYPAL-ID-1** | Multi-capture siblings prefer the remaining-held capture, not the refunded slice. |
| **PAYMOB-TOCTOU** | Store without `reserve()` throws (Moyasar parity). No get-then-set fallthrough. |
| **RECON-LEASE-1** | Store `fail` / `markManualReview` accept matching token on `claimed` after expiry (SQL + Redis Lua + memory). Scheduler hang budget + `failAndReschedule` after overrun so `maxAttempts` can dead-letter. `complete` stays unexpired-only. |
| **WH-LIST-FAIL** | Outer `UPDATE … WHERE status = 'claimed'` (SQL-UPD-1). Engine: fail after `listRetryable` wiped token → `handler_failed { retryable: true }`, never complete. |
| **MOYASAR-CAP-0** | `paid` + missing / non-finite / finite `0` `captured` → `processing`. |
| **PAYMOB-AUTH-REDIR** | `TRANSACTION_RESPONSE` + authorized / `is_auth` demotes to `payment.processing`. Processed `TRANSACTION` still publishes `payment.authorized`. |

### P2

| ID | Verdict |
| --- | --- |
| **MOYASAR-3** | landed — `moyasarSource` / `CreditCardSource` JSDoc no longer advertise raw backend `creditcard`. |
| **SQL-UPD-1** | landed — outer `status = 'claimed'` on expired-claim UPDATE (postgres / sqlite / d1 / turso / do). |
| **PERF-3** | landed — sql-foundation v2 `CREATE INDEX IF NOT EXISTS` composites; D1 Wrangler `0002_list_indexes.sql`. Applied v1 not rewritten. |
| **PERF-4** | landed as documented — poll is ZRANGE + one `Promise.all` wave of keyed Lua GETs. SCAN stays off the list path. Multi-key GET Lua not added. |
| **REDIS-CLEAN-1** | landed — `deleteExpired` default `limit` is `1000` (`DEFAULT_DELETE_EXPIRED_LIMIT`). Explicit higher allowed. |
| **PERF-5** | **remaining (documented)** — DO hash `listDue` still wakes every isolate at full `limit`. No cheaper correct global earliest-N. `store-durable-objects/docs/sharding.md`. |
| **PERF-6** | **remaining (unowned this pass)** — webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. G must not edit `stripe.gateway.ts`. |
| **PERF-7** | **remaining (documented)** — `processDue` / `processRetryable` stay list-then-serial-claim (list is not a fence). Oversample still capped at 200 when `maxInFlightByGateway` is set. |

### Integrate-phase seams (not stream leftovers)

1. **Moyasar TS18048** — `payment.captured` used after a `capturedFinite` flag; `exactOptionalPropertyTypes` did not narrow. Local `capturedAmount`.
2. **OBS-1** — `sanitizeSpanStatusMessage` used core `redact()` as a whole-string check. Core `redact()` treats any string *containing* `sk_live_` as fully `[REDACTED]`, so `"capture failed sk_live_…"` was dropped. Whole-string credential regex + in-place embed replace restored. Not a session-audit leftover lie.
3. **Redis HGETALL source policy** — PERF-4 comment said `HGETALL`; the no-live-Redis claim test is a substring scan. Comment reworded. Claims still go through EVAL.
4. **testkit ledger** — CORE-1 remaps `partially_captured` → outcome `requires_action`. Mock `isLedgerSettlingResult` treated that as “do not mutate ledger”, so remaining-capture tests saw `capturedAmount: 0`. Ledger now settles on domain status even when outcome is `requires_action`. Failed / indeterminate / declined still do not settle. This un-trains a leftover (partial capture as no-op), not a checkout-paid-after-refund lie.

No remaining tests found that lock the original fence-release / 403-drop / empty-Request-Id / type-only `refund.completed` / `success:false`+paid-as-`failed` lies.

---

## Residual ID checklist (copy for critic / gate)

### Blocking

- [x] PAYMOB-FENCE-1
- [x] PAYMOB-FENCE-2
- [x] PAYMOB-FENCE-3
- [x] PAYPAL-IDEM-1
- [x] PAYPAL-DW-1
- [x] WEBHOOKS-403

### Other P1

- [x] STRIPE-CKO-1
- [x] STRIPE-CHG-1
- [x] CORE-INF-1
- [x] CORE-INF-2
- [x] CORE-HW-1
- [x] CORE-6-EXT
- [x] PAYPAL-ID-1
- [x] PAYMOB-TOCTOU
- [x] RECON-LEASE-1
- [x] WH-LIST-FAIL
- [x] MOYASAR-CAP-0
- [x] PAYMOB-AUTH-REDIR

### P2

- [x] MOYASAR-3
- [x] SQL-UPD-1
- [x] PERF-3
- [x] PERF-4
- [ ] PERF-5 (documented residual)
- [ ] PERF-6 (unowned residual)
- [ ] PERF-7 (documented residual; oversample cap 200)
- [x] REDIS-CLEAN-1
