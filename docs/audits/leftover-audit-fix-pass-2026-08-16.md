# PayKernel leftover-audit fix pass (2026-08-16, round 3)

**Source of truth:** [`leftover-audit-2026-08-16.md`](./leftover-audit-2026-08-16.md)  
**Prior closed write-ups:** [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md), [`deep-audit-fix-pass-2026-08-16.md`](./deep-audit-fix-pass-2026-08-16.md), [`deep-audit-fix-result-2026-08-16.md`](./deep-audit-fix-result-2026-08-16.md), [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md), [`session-audit-fix-pass-2026-08-16.md`](./session-audit-fix-pass-2026-08-16.md), [`session-audit-fix-gate-2026-08-16.md`](./session-audit-fix-gate-2026-08-16.md), [`session-audit-fix-result-2026-08-16.md`](./session-audit-fix-result-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map, residual-ID checklist, and (later) integrate landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` only. Does **not** claim a post-fix gate result (that is `leftover-audit-fix-result-2026-08-16.md` after a formal gate).  
**Working tree:** uncommitted leftover-audit (round-3) diffs. Do **not** re-open first-pass or session-audit IDs unless current code still has the original lie.

**Audit verdict at pass start:** **SHIP_BLOCKED** on post-submit uncertainty classified as a clean failure, plus Stripe Checkout hardcoded `success: true`.

Prior ship-gate and session-audit IDs stay **already closed**. Historical PP0–ST1 stay already fixed. Disputed list is empty. Critic / implement streams skip any ID they prove already fixed against current code; this bookkeeping list is the audit residual set, not a landing score.

---

## Residual inventory (from leftover audit)

Do not ship until **P1 blocking** are fixed and covered by tests that would have failed this leftover audit. Gate may also treat still-present money / fence lies from the other-P1 set as blocking.

**Counts:** 6 P1 blocking + 11 P1 other + 17 P2 = **34 residual NEW-\* IDs**. Residual **PERF-5 / PERF-6 / PERF-7** stay documented leftovers unless a stream can cheaply improve them without breaking fencing.

### P1 blocking (must close)

Post-submit uncertainty classified as a clean failure, plus Checkout `success: true` without identity. Must close.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **NEW-STRIPE-3** | P1 | `stripeRequest` HTTP 200 empty/`{}`/non-JSON is returned as success. Create/capture map missing status to `failed`; refund maps missing status to `pending` + `success: true`; `fromStripeAmount(undefined)` is `0` on create using caller currency. | A |
| **NEW-STRIPE-CKO-200** | P1 | `createCheckoutSession` / `getCheckoutSession` hardcode `success: true` with no `id`/`url` assert. Empty 200 → `{ success: true, sessionId: undefined }`. | A |
| **NEW-CORE-1** | P1 | Caller abort after a mutating POST is `PaymentAbortedError`. `tryIndeterminateFromNetworkError` only accepts `NetworkError.afterProviderSubmit`. Retry-as-cancel can double-charge / double-refund. Paymob already wraps abort; Stripe/PayPal/Moyasar do not (they already pass `afterProviderSubmit` — **G** `abort.ts` covers them). | G |
| **NEW-PAYPAL-1** | P1 | HTTP 200 missing `id`/`status` throws `PayPalApiError` status 0 (not indeterminate). App-level retry mints a new `PayPal-Request-Id`. | B |
| **NEW-PAYMOB-2** | P1 | Mutation HTTP 429 (and other non-5xx `!ok`) after POST is `GatewayApiError`/`RateLimitError`; `executeIdempotent` **deletes** the fence. Moyasar keeps 429. | C |
| **NEW-MOYASAR-1** | P1 | Create HTTP 200 `{}` maps missing status to `failed` / `declined` with undefined `gatewayId`. No create fence. Caller mints a new `given_id`. | D |

### P1 other (fix in this pass)

Production money / status / recovery / lease holes. Gate may promote any still-present money lie into blocking.

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-CORE-2** | `handleWebhook` rematch changes `stableType` only; nested `event.payment.status` can stay `paid`. | E |
| **NEW-CORE-3** | Rematch ignores envelope `pending` / `failed` / `cancelled` / `reversed` (mapper already rematches). | E |
| **NEW-CORE-4** | Paymob `is_capture` + `partially_captured` dual-writes `capture.completed`. | G (map) — C must not edit `webhook-event-map.ts` |
| **NEW-CORE-5** | `applyOutcomeToGatewayRefundResult` does not coerce outcome vs status (payment apply does). | G |
| **NEW-WEBHOOKS-1** | `processRetryable` claims N keys in parallel then runs handlers serially; later leases expire → peer reclaim + this worker still handles (double-run). | E |
| **NEW-RECON-2** | `processDue` same parallel-claim / serial-handler lease overrun. | H |
| **NEW-RECON-1** | In-flight `pending`/`processing` + `capturedAmount=0` vs `local.amount` invents drift → `apply_drift_review` (bypasses `retry_later`). | H |
| **NEW-PAYMOB-TTL** | Completed Paymob fences expire at 24h and in-memory evicts completed at 1000; `delete`+`reserve` of expired completed is not atomic. No native Paymob idempotency. | C |
| **NEW-STRIPE-1** | `getPayment` refund math ignores `charges.data[0]` when `latest_charge` is omitted (webhook helper already reads it). | A |
| **NEW-STRIPE-2** | Id-only charge object `{ id: "ch_…" }` is treated as an observed snapshot; missing `amount_refunded` means “no refund” → `paid`. | A |
| **NEW-PAYMOB-REFUND-0** | Refund mutation `success: true` + `refunded_amount_cents: 0` → `completed` + `totalRefunded: 0`. | C |

### P2 pack (fix if cheap; do not leave as silent money lie)

Honesty, mock training, redaction, docs. None confirmed false-paid / double-refund on built-in default paths — still do not leave a silent money lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-PAYMOB-VOID-P** | Void ignores `pending` (capture/refund honor it). | C |
| **NEW-PAYMOB-FP** | Local `JSON.stringify` fingerprint (Date vs ISO); not shared `fingerprintParams`. | C |
| **NEW-MOYASAR-2** | Verified `card_auth_*` parse throws `InvalidWebhookError` → handleWebhook remaps retryable. | D |
| **NEW-MOYASAR-3** | `confirmStcPayOtp` is an unfenced mutation POST. | D |
| **NEW-WEBHOOKS-2** | Processed Paymob inbox key is still one `obj.id`; later same-id snapshot is `already_completed`. Child refunds have new ids. | E (docs / event-key comment) — C must not change `event.id` here |
| **NEW-STORE-1** | Redis list leaves ghost ZSET members when GET is missing. | F |
| **NEW-CORE-6** | `outcome: declined/failed` can persist with `status: paid`. | G |
| **NEW-CORE-7** | After-hook freeze omits `refundedAt`; Dates shared by reference. | G |
| **NEW-MONEY-1** | `applyOutcomeToGatewayResult` can publish non-finite / currency-less amounts. | G |
| **NEW-MONEY-2** | Webhook payload redaction misses PAN/CVC keys the logger already scrubs. | G (`payment-event.ts` redaction keys only) |
| **NEW-TESTKIT-1** | Mock create fingerprint omits `orderId` / payment-method identity. | I |
| **NEW-TESTKIT-2** | Partial refund freezes remaining capturable hold. | I |
| **NEW-TESTKIT-3** | `getPayment` + `outcome: "succeeded"` overwrites ledger to `paid`. | I |
| **NEW-TESTKIT-4** | `capture: false` without authorization capability silently pays. | I |
| **NEW-TESTKIT-5** | Fixture safety misses `cs_live_` / PI client secrets. | I |
| **NEW-OBS-1** | OTEL span status messages still pass PANs. | I |
| **NEW-PAYPAL-2** | Docs say partial capture `outcome: succeeded`; code is `requires_action`. | B (`paypal.md` only) |

Residual **PERF-5 / PERF-6 / PERF-7** stay documented leftovers unless a stream can cheaply improve them without breaking fencing. They are **not** NEW-\* IDs and are **unowned for code this pass** unless already in a stream’s files.

---

## Stream ownership

Non-overlapping file ownership from `paykernel-leftover-audit-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | NEW-STRIPE-3, NEW-STRIPE-CKO-200, NEW-STRIPE-1, NEW-STRIPE-2 |
| **B** | PAYPAL | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` | NEW-PAYPAL-1, NEW-PAYPAL-2 |
| **C** | PAYMOB | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | NEW-PAYMOB-2, NEW-PAYMOB-REFUND-0, NEW-PAYMOB-TTL, NEW-PAYMOB-VOID-P, NEW-PAYMOB-FP |
| **D** | MOYASAR | `packages/core/src/gateways/moyasar/**`, `packages/core/docs/moyasar.md` | NEW-MOYASAR-1, NEW-MOYASAR-2, NEW-MOYASAR-3 |
| **E** | WEBHOOKS + `handleWebhook` rematch | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md`, `packages/core/src/client.ts`, `packages/core/docs/webhooks.md` | NEW-CORE-2, NEW-CORE-3, NEW-WEBHOOKS-1, NEW-WEBHOOKS-2 |
| **F** | STORES (Redis ghost members) | `packages/store-redis/src/**`, `packages/store-redis/docs/**` | NEW-STORE-1 |
| **G** | CORE abort + apply + map + freeze | `packages/core/src/runtime/abort.ts`, `packages/core/src/runtime/abort.test.ts` if present, `packages/core/src/gateways/base.gateway.ts` only if needed to accept abort-as-indeterminate, `packages/core/src/types/operation-result.ts`, `packages/core/src/types/operation-result.test.ts`, `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.ts` (**NEW-MONEY-2 redaction keys only**), `packages/core/src/hooks/money-identity.ts`, `packages/core/docs/operation-results.md` if needed | NEW-CORE-1, NEW-CORE-4, NEW-CORE-5, NEW-CORE-6, NEW-CORE-7, NEW-MONEY-1, NEW-MONEY-2 |
| **H** | RECON compare + scheduler | `packages/reconciliation/src/**`, `packages/reconciliation/docs/**` | NEW-RECON-1, NEW-RECON-2 |
| **I** | TESTKIT + OBS | `packages/testkit/src/**`, `packages/observability/src/**` | NEW-TESTKIT-1, NEW-TESTKIT-2, NEW-TESTKIT-3, NEW-TESTKIT-4, NEW-TESTKIT-5, NEW-OBS-1 |
| **J** | DOCS audit bookkeeping | `docs/audits/**` only | this file |

### Ownership fences (do not cross)

- **A** must not edit `abort.ts` (**G**) or `client.ts` (**E**).
- **B** must not edit `abort.ts` (**G**) or `webhook-event-map.ts` (**G**). NEW-PAYPAL-2 is `paypal.md` honesty only.
- **C** must not edit `webhook-event-map.ts` (**G** owns NEW-CORE-4) or `abort.ts`. **C** must not change Paymob `event.id` for NEW-WEBHOOKS-2 (**E** docs / event-key comment only).
- **D** must not edit `abort.ts` (**G**) or `client.ts` (**E**).
- **E** owns `client.ts` rematch (NEW-CORE-2 / NEW-CORE-3). **E** must not edit `webhook-event-map.ts` (**G**) or `paymob.gateway.ts` (**C**).
- **F** owns Redis list ghost-member `ZREM` only. Do **not** edit sql-foundation / postgres / sqlite / d1 / turso / durable-objects unless a one-line comment is required.
- **G** must not edit `client.ts` (**E**) or stripe / paypal / paymob / moyasar gateways. NEW-CORE-1 is the shared `mapHttpAbortError` change; Stripe/PayPal/Moyasar already pass `afterProviderSubmit` on mutating fetch.
- **H** must not edit `store-*` (**F**) or the webhooks engine (**E**). NEW-RECON-2 is the same class as NEW-WEBHOOKS-1, different package.
- **I** must not flip production gateway / infer adapters.
- **J** must not edit `packages/**`.
- Built-in PaymentStatus values to prefer (do not invent new ones): `partially_captured`, `partially_refunded`, `refund_pending`, `refund_failed`, `refund_completed`, `setup_completed`, `paid`, `pending`, `processing`, `authorized`.
- Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split IDs

**NEW-CORE-1 (G, not A/B/D)**

`mapHttpAbortError` lives in `abort.ts`. If `options.afterProviderSubmit === true`, return `NetworkError({ afterProviderSubmit: true })` even when the caller signal aborted — do not use `PaymentAbortedError` after submit. Timeout path already uses `NetworkError`. Stripe / PayPal / Moyasar already pass `afterProviderSubmit` on mutating fetch; this one change covers them. Paymob already wraps abort as indeterminate in-gateway. **A / B / D must not edit `abort.ts`.**

**NEW-CORE-2 / NEW-CORE-3 (E, not G)**

Rematch after parse lives in `client.ts` (`rematchSucceededWebhookDualWriteAgainstDomainStatus`). Rebuild payment via `paymentFromWebhookEvent` (or overwrite nested `payment.status` from envelope) so `event.payment.status` cannot stay `paid` when the envelope is processing / partial / authorized / refunded. Also cover `pending` / `failed` / `cancelled` / `reversed` to align with `coerceStableSucceededToDomainStatus` (**G** mapper; **E** must not edit that file).

**NEW-CORE-4 (G, not C)**

`mapPaymobCaptureSettle` / `mapPaymobFromFlags` live in `webhook-event-map.ts`. `is_capture` + `partially_captured` must not emit `capture.completed` — use `payment.processing`. **C** comments `paymob.md` only if needed.

**NEW-WEBHOOKS-1 (E) + NEW-RECON-2 (H)**

Same class, different packages:

1. **E:** `processRetryable` must not hold N unexpired leases across serial handler I/O. Claim one-at-a-time (or claim next only after the previous handler returns), **or** renew remaining claimed leases before each handler.
2. **H:** `processDue` same rule. **H** must not edit the webhooks engine.

**NEW-WEBHOOKS-2 (E, not C)**

Processed Paymob `TRANSACTION` inbox key is still `obj.id`. Child refunds have new ids. **E** documents that (and may comment `event-key`). Do not change `paymob.gateway.ts` `event.id` this pass.

---

## Recommended close (audit §)

1. NEW-STRIPE-3 / NEW-STRIPE-CKO-200  
2. NEW-CORE-1  
3. NEW-PAYPAL-1 / NEW-PAYMOB-2 / NEW-MOYASAR-1  
4. NEW-CORE-2 / NEW-CORE-3 / NEW-CORE-4 / NEW-CORE-5  
5. NEW-WEBHOOKS-1 / NEW-RECON-2  
6. NEW-RECON-1 / NEW-PAYMOB-TTL / NEW-STRIPE-1 / NEW-STRIPE-2 / NEW-PAYMOB-REFUND-0  
7. P2 pack  

Items **1–3** are this leftover pass’s ship gate (blocking). Items **4–6** are still this-pass P1s; gate may promote any still-present money lie into blocking. Item **7** is cheap honesty / mock / redaction / docs — do not leave as a silent money lie.

---

## Already closed (do not re-open)

From leftover-audit “Prior closed IDs”, the first-pass ship-gate, and the session-audit fix-gate. Do **not** re-open unless current code still has the **original** lie.

```
WEBHOOKS-1          (redirect vs processed inbox key)
CORE-1–8            (original forms)
STRIPE-1 / STRIPE-2
PAYPAL-1 / PAYPAL-3
PAYMOB-1 / PAYMOB-2 (Intention fence)
PAYMOB-FENCE-1/2/3
STRIPE-CKO-1 / STRIPE-CHG-1
CORE-INF-1 / CORE-INF-2
CORE-HW-1
CORE-6-EXT
MONEY-1             (JMD/XCG/XAD)
REDIS-1             (rescore)
RECON-1/2/3         (original forms)
RECON-LEASE-1
WH-LIST-FAIL
PAYMOB-TOCTOU
PAYPAL-IDEM-1 / PAYPAL-DW-1 / PAYPAL-ID-1
WEBHOOKS-403
MOYASAR-CAP-0
PAYMOB-AUTH-REDIR
PERF-1 / PERF-2     (original forms)
TESTKIT-1–4         (original forms)
OBS-1 / OBS-2       (original forms)
PKG-1
SQL-UPD-1
REDIS-CLEAN-1
```

These are leftover **adjacent** classes, not regressions of the original IDs:

| Prior close | This-pass leftover |
| --- | --- |
| Stripe `stripeRequest` returns parsed JSON on HTTP 200 | **NEW-STRIPE-3** empty / `{}` / non-JSON 200 is still treated as a PaymentIntent / Refund |
| Checkout session create/get assumed a body | **NEW-STRIPE-CKO-200** hardcodes `success: true` with no `id` / `url` |
| PAYMOB-FENCE-2 abort-after-POST is indeterminate in Paymob | **NEW-CORE-1** Stripe / PayPal / Moyasar abort after POST is still `PaymentAbortedError` (shared `abort.ts`) |
| PAYPAL-IDEM-1 always sends `PayPal-Request-Id` | **NEW-PAYPAL-1** HTTP 200 missing `id`/`status` is `PayPalApiError` status 0; retry mints a new key |
| PAYMOB-2 Intention missing id keeps fence; 5xx is indeterminate | **NEW-PAYMOB-2** mutation HTTP 429 / other non-5xx `!ok` deletes the fence |
| Moyasar mutation 2xx-without-id kept as unknown | **NEW-MOYASAR-1** **create** HTTP 200 `{}` maps missing status to `failed` / `declined` (create is not fenced) |
| CORE-HW-1 rematch of complete v1 `payment.succeeded` | **NEW-CORE-2** rematch changes `stableType` only; nested `event.payment.status` can stay `paid` |
| CORE-6-EXT remaps authorized / partial / refunded | **NEW-CORE-3** rematch still ignores envelope `pending` / `failed` / `cancelled` / `reversed` |
| PAYMOB-AUTH-REDIR redirect + authorized → `payment.processing` | **NEW-CORE-4** processed `is_capture` + `partially_captured` still dual-writes `capture.completed` |
| CORE-1 / CORE-INF-2 refund infer coerce | **NEW-CORE-5** refund **apply** still does not coerce outcome vs status |
| PERF-7 listed claims in parallel, handlers serial (session close) | **NEW-WEBHOOKS-1** / **NEW-RECON-2** those unexpired leases still overrun across serial I/O |
| RECON-1 auth-hold `capturedAmount=0` vs `local.amount` is not drift | **NEW-RECON-1** in-flight `pending`/`processing` + zero capture still invents drift |
| PAYMOB-FENCE-1 expired `unknown` / `in_progress` is not a free key | **NEW-PAYMOB-TTL** **completed** fences still expire / evict as a free key |
| STRIPE-CHG-1 webhook helper reads `charges.data[0]` | **NEW-STRIPE-1** `getPayment` still ignores that fallback |
| STRIPE-2 unexpanded **string** charge → `processing` | **NEW-STRIPE-2** id-only object `{ id }` is treated as an observed snapshot → `paid` |
| Refund apply / Moyasar incomplete-refund omit | **NEW-PAYMOB-REFUND-0** `success: true` + `refunded_amount_cents: 0` is `completed` + `0` |
| WEBHOOKS-1 redirect vs processed inbox key | **NEW-WEBHOOKS-2** processed same-id later snapshot is still `already_completed` |
| PERF-1 SCAN off poll | **NEW-STORE-1** missing GET still leaves a ghost ZSET member |
| OBS-1 / OBS-2 prefix / `cs_live_` sanitization | **NEW-OBS-1** embedded PANs still pass in span status messages |
| TESTKIT-1–4 original mock lies | **NEW-TESTKIT-1–5** adjacent fingerprint / hold / ledger / `capture:false` / fixture holes |

---

## Stream J status

Wrote this ownership + residual checklist. Stream J did **not** edit `packages/**`.

**fixed_ids (this stream):** none — J is bookkeeping only.

Integrate (below) updated this file with landed vs remaining. Formal gate artifact is `leftover-audit-fix-result-2026-08-16.md` (not this file).

---

## Integrate result (2026-08-16, uncommitted)

**Do not commit** (integrate instruction). Working tree is the A–I stream diffs plus the three integrate-phase seams below. This file is still **not** a formal gate result.

**Verify:** `bun run typecheck` green across the monorepo. `bun test` on core / webhooks / reconciliation / routing / testkit / observability / store-contracts / sql-foundation / store-d1 / store-durable-objects / store-redis / store-postgres / store-sqlite / store-turso → **2738 pass / 35 skip / 0 fail**. Known sql-foundation bun:sqlite WAL flake did **not** reproduce.

### Invariant cross-check (blocking)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **NEW-STRIPE-3** | landed | `stripeRequest` HTTP 200 empty / non-JSON is `NetworkError` (`afterProviderSubmit` on mutations). Parsed `{}` / missing PaymentIntent `id` or `status` on create/capture, and missing refund `id`/`status`, map to `outcome: indeterminate` — never `failed` create, never `pending` + `success: true` refund, never `fromStripeAmount(undefined)` → major `0`. Tests: empty / `{}` / non-JSON create + refund; id-without-status create/capture/refund. |
| **NEW-STRIPE-CKO-200** | landed | `createCheckoutSession` requires string `id` (`requireStripeMutationId` → post-submit `NetworkError`). `getCheckoutSession` throws `NetworkError` when `id` is missing. Empty / `{}` 200 is not `{ success: true, sessionId: undefined }`. Checkout `url` may still be null on a valid session (Stripe-legal; not the empty-200 lie). |
| **NEW-CORE-1** | landed | `mapHttpAbortError` with `afterProviderSubmit: true` always returns `NetworkError({ afterProviderSubmit: true })`, including caller-signal abort. Stripe / PayPal / Moyasar already pass the flag on mutating fetch; Paymob still wraps abort in-gateway. Tests: `abort.test.ts`; Stripe / Moyasar mid-flight create abort is indeterminate. Pre-submit GET / token abort stays `PaymentAbortedError`. |
| **NEW-PAYPAL-1** | landed | Mutation HTTP 200 missing `id`/`status` is `NetworkError.afterProviderSubmit` (indeterminate), not `PayPalApiError` status 0. App retry cannot mint a new `PayPal-Request-Id` as a clean failure. Tests: create / refund missing id; empty body. |
| **NEW-PAYMOB-2** | landed | Mutation HTTP 429 is `PaymobIndeterminateGatewayError`; `shouldRetainPaymobMutationFence` also keeps `RateLimitError`. `executeIdempotent` does **not** delete the fence. Tests: refund POST 429 keeps fence. |
| **NEW-MOYASAR-1** | landed | Create HTTP 200 `{}` / missing `payment.id` throws `NetworkError.afterProviderSubmit` via `assertObservedPaymentId` — not `failed`/`declined` with undefined `gatewayId`. Tests: empty `{}`; paid status without id. |

### Other P1

All landed in stream ownership:

| ID | Where |
| --- | --- |
| **NEW-CORE-2** | `handleWebhook` rematch rebuilds nested `event.payment` via `paymentFromWebhookEvent` so status cannot stay `paid`. |
| **NEW-CORE-3** | Rematch covers envelope `pending` / `failed` / `cancelled` / `reversed` (plus existing processing / partial / authorized / refunded). |
| **NEW-CORE-4** | `mapPaymobCaptureSettle` / `mapPaymobFromFlags`: `is_capture` + `partially_captured` → `payment.processing`, never `capture.completed`. |
| **NEW-CORE-5** | `applyOutcomeToGatewayRefundResult` coerces stored outcome vs `base.status` (payment-apply family). |
| **NEW-WEBHOOKS-1** | `processRetryable` claims one listed row at a time (next `store.claim` after the previous handler returns). |
| **NEW-RECON-2** | `processDue` claims one-at-a-time (same class, recon package). |
| **NEW-RECON-1** | In-flight `pending`/`processing` + `capturedAmount=0` vs `local.amount` is `retry_later`, not invented `apply_drift_review`. |
| **NEW-PAYMOB-TTL** | `isStoredIdempotencyReplayExpired` is always false; completed / unknown / in_progress fences are never a free key. In-memory does not FIFO-evict them. |
| **NEW-STRIPE-1** | `getPayment` refund math falls through to `charges.data[0]` when `latest_charge` is omitted. |
| **NEW-STRIPE-2** | Id-only `{ id: "ch_…" }` is unobservable (same as a string charge id) → `processing`, not `paid`. |
| **NEW-PAYMOB-REFUND-0** | `success: true` + missing/`<=0` `refunded_amount_cents` is `pending` and omits `totalRefunded` unless inquiry + this request proves a positive cumulative. |

### P2 pack

| ID | Verdict |
| --- | --- |
| **NEW-PAYMOB-VOID-P** | landed — void honors `pending` like capture/refund. |
| **NEW-PAYMOB-FP** | landed — shared `fingerprintParams` (Date-aware); AbortSignal stripped before fingerprint. |
| **NEW-MOYASAR-2** | landed — verified `card_auth_*` parses as `provider.unmapped` (no `InvalidWebhookError` retry loop). |
| **NEW-MOYASAR-3** | landed — `confirmStcPayOtp` is fenced like capture/refund/void. |
| **NEW-WEBHOOKS-2** | landed as documented honesty — processed Paymob inbox key remains `obj.id`; later same-id snapshot is `already_completed`; child refunds have new ids. **E** docs / `event-key` comment only (no `paymob.gateway.ts` `event.id` change). |
| **NEW-STORE-1** | landed — Redis list GET Lua `ZREM`s ghost ZSET members when the hash is missing. |
| **NEW-CORE-6** | landed — `declined`/`failed` does not persist on paid-like status (status wins → stored `succeeded`). |
| **NEW-CORE-7** | landed — after-hook freeze includes `refundedAt`; Dates are cloned. |
| **NEW-MONEY-1** | landed — `applyOutcomeToGatewayResult` publishes finite amounts only with currency. |
| **NEW-MONEY-2** | landed — webhook payload redaction includes PAN/CVC keys the logger already scrubs. |
| **NEW-TESTKIT-1** | landed — mock create fingerprint includes `orderId` / payment-method identity (token/source ids only). |
| **NEW-TESTKIT-2** | landed — partial refund does not freeze remaining capturable hold. |
| **NEW-TESTKIT-3** | landed — `getPayment` + `outcome: "succeeded"` does not overwrite ledger to `paid`. |
| **NEW-TESTKIT-4** | landed — `capture: false` without authorization capability is `OperationNotSupportedError`. Conformance default create only requests an auth hold when authorization is claimed. |
| **NEW-TESTKIT-5** | landed — fixture safety matches `cs_live_` / PI client secrets. |
| **NEW-OBS-1** | landed — OTEL span status messages redact embedded PANs + credential-shaped leaves. |
| **NEW-PAYPAL-2** | landed — `paypal.md` says partial capture `outcome: requires_action` (matches code). |

### Documented leftovers (not NEW-*)

| ID | Verdict |
| --- | --- |
| **PERF-5** | **remaining (documented)** — DO hash `listDue` still wakes every isolate at full `limit`. No cheaper correct global earliest-N. |
| **PERF-6** | **remaining (unowned this pass)** — webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. G must not edit `stripe.gateway.ts`. |
| **PERF-7** | **remaining (documented)** — `processDue` / `processRetryable` stay list-then-serial-claim (list is not a fence). NEW-WEBHOOKS-1 / NEW-RECON-2 closed the lease-overrun money class (one claim at a time). |

### Integrate-phase seams (not stream leftovers)

1. **testkit TS2352** — `createPaymentIdentityFields` cast `MoyasarPaymentSource` → `Record<string, unknown>` failed `exactOptionalPropertyTypes` (`StcPaySource` has no string index). Cast via `unknown`.
2. **NEW-TESTKIT-4 × conformance** — `defaultCreatePayment` treated unclaimed `immediateCapture` as `capture: false`, which the mock now rejects without `authorization`. Payments-only fixtures now capture immediately; auth hold only when authorization is claimed **and** immediateCapture is false.
3. **NEW-STRIPE-3 missing status** — empty / `{}` / non-JSON 200 was already indeterminate; create/capture HTTP 200 with `id` but no `status` still mapped to `failed`. `requireStripeMutationStatus` fail-closes those as post-submit indeterminate (refund already required status).

No remaining tests found that lock the leftover empty-200-as-success, abort-after-POST-as-`PaymentAbortedError`, PayPal status-0, Paymob 429 fence-delete, or Moyasar create-`{}`-as-declined lies.

---

## Residual ID checklist (copy for critic / gate)

### Blocking

- [x] NEW-STRIPE-3
- [x] NEW-STRIPE-CKO-200
- [x] NEW-CORE-1
- [x] NEW-PAYPAL-1
- [x] NEW-PAYMOB-2
- [x] NEW-MOYASAR-1

### Other P1

- [x] NEW-CORE-2
- [x] NEW-CORE-3
- [x] NEW-CORE-4
- [x] NEW-CORE-5
- [x] NEW-WEBHOOKS-1
- [x] NEW-RECON-1
- [x] NEW-RECON-2
- [x] NEW-PAYMOB-TTL
- [x] NEW-STRIPE-1
- [x] NEW-STRIPE-2
- [x] NEW-PAYMOB-REFUND-0

### P2 pack

- [x] NEW-PAYMOB-VOID-P
- [x] NEW-PAYMOB-FP
- [x] NEW-MOYASAR-2
- [x] NEW-MOYASAR-3
- [x] NEW-WEBHOOKS-2
- [x] NEW-STORE-1
- [x] NEW-CORE-6
- [x] NEW-CORE-7
- [x] NEW-MONEY-1
- [x] NEW-MONEY-2
- [x] NEW-TESTKIT-1
- [x] NEW-TESTKIT-2
- [x] NEW-TESTKIT-3
- [x] NEW-TESTKIT-4
- [x] NEW-TESTKIT-5
- [x] NEW-OBS-1
- [x] NEW-PAYPAL-2

### Documented leftovers (not NEW-\*; unowned unless already in-stream)

- [ ] PERF-5 (documented residual unless a stream can cheaply improve without breaking fencing)
- [ ] PERF-6 (documented residual; **G** must not edit `stripe.gateway.ts`)
- [ ] PERF-7 (documented residual; fencing stays list-then-claim — NEW-WEBHOOKS-1 / NEW-RECON-2 are the lease-overrun money class)
