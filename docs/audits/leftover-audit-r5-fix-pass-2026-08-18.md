# PayKernel leftover-audit fix pass (2026-08-18, round 5)

**Source of truth:** [`leftover-audit-r5-2026-08-18.md`](./leftover-audit-r5-2026-08-18.md)  
**Prior closed write-ups:** [`leftover-audit-r4-2026-08-16.md`](./leftover-audit-r4-2026-08-16.md), [`leftover-audit-r4-fix-pass-2026-08-16.md`](./leftover-audit-r4-fix-pass-2026-08-16.md), [`leftover-audit-r4-fix-result-2026-08-16.md`](./leftover-audit-r4-fix-result-2026-08-16.md), [`leftover-audit-2026-08-16.md`](./leftover-audit-2026-08-16.md), [`leftover-audit-fix-pass-2026-08-16.md`](./leftover-audit-fix-pass-2026-08-16.md), [`leftover-audit-fix-result-2026-08-16.md`](./leftover-audit-fix-result-2026-08-16.md), [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md), [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-r5-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map, residual-ID checklist, and integrate landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` only. Does **not** claim a post-fix gate result (that is `leftover-audit-r5-fix-result-2026-08-18.md` after a formal gate).  
**Working tree:** uncommitted leftover-audit (round-5) diffs. Do **not** commit. Do **not** re-open leftover-r4 IDs unless current code still has the original lie.

**Audit verdict at pass start:** **SHIP_BLOCKED** on sale-intent PayPal `capturePayment` omitted `final_capture` as `paid`, Stripe refund list `totalRefunded: 0`, Moyasar mutating HTTP 200 invalid JSON as a thrown API error, Paymob inbox keys missing PaymentEvent domain status, and routing `input.currency` ≠ `amount.currency`.

**Blocking (must close — this pass’s ship gate):**

1. **NEW-PAYPAL-7**
2. **NEW-STRIPE-REFUND-0**
3. **NEW-MOYASAR-JSON-1**
4. **NEW-WH-KEY-1**
5. **NEW-ROUTE-CCY-1**

This file is **not** a formal gate pass. Formal gate artifact is `leftover-audit-r5-fix-result-2026-08-18.md`. Integrate landed-vs-remaining is below; critic / implement streams skip any ID they prove already fixed against current code. The residual inventory tables stay the audit start set; checkboxes reflect integrate verification.

Prior leftover-r4, leftover-r3, session-audit, and first-pass ship-gate IDs stay **already closed**. Historical PP0–ST1 stay already fixed.

---

## Residual inventory (from leftover-audit r5)

Do not ship until **P1 blocking** are fixed and covered by tests that would have failed this leftover audit. Gate may also treat still-present money / fence lies from the other-P1 set as blocking.

**Counts:** 5 P1 blocking + 4 P1 other + 6 P2 = **15 residual NEW-\* IDs**. Residual **PERF-4 / PERF-5 / PERF-7** stay documented leftovers (Redis ZRANGE+N GETs, DO peek-all, serial recon claim). Do not change fencing to chase them. They are **not** NEW-\* IDs and are **unowned for code this pass** unless already in a stream’s files.

No Stream **C** (Paymob gateway) this pass.

### P1 blocking (must close)

Sale/order capture omitted `final_capture` as `paid`; empty Stripe refund list published as `totalRefunded: 0`; Moyasar mutating 200 invalid JSON as a thrown API error; Paymob processed inbox key ignoring PaymentEvent `payment.status`; routing `input.currency` ≠ `amount.currency`. Must close.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **NEW-PAYPAL-7** | P1 | Sale/order `capturePayment` falls back to `requestFinalCapture=true` when the capture omits `final_capture`. GET / webhook still require `=== true`. Same capture fulfills on capture then looks open on poll. Test `'should capture order and return capture ID'` locks the lie. Evidence: `paypal.gateway.ts` ~626–694. | B |
| **NEW-STRIPE-REFUND-0** | P1 | `getTotalRefundedForPaymentIntent` starts at `0` and returns major `0` on empty / pending-only list. Catch fallback to `charge.amount_refunded` runs only on **throw**. Completed refund can ledger `totalRefunded: 0`. Evidence: `stripe.gateway.ts` ~1842–1882, ~2869–2906. | A |
| **NEW-MOYASAR-JSON-1** | P1 | `parseJsonResponse` throws `GatewayApiError` with HTTP 200 on invalid JSON. Fence stays `unknown` (good) but `executeWithHooks` only maps `NetworkError.afterProviderSubmit` → indeterminate. Caller throw + new key double-applies. Evidence: `moyasar.gateway.ts` ~1774–1786. | D |
| **NEW-WH-KEY-1** | P1 | `extractInboxDomainStatus` reads only top-level `status`. Documented path is `event: webhookEvent.event` (`PaymentEvent` has `payment.status` / `refund.status`). Processed Paymob keys stay `paymob:TRANSACTION:{id}`; later same-id void is `already_completed`. NEW-WEBHOOKS-2 test uses a legacy `{status}` bag. Evidence: `webhooks/src/engine.ts` ~713–720; README ~61. | E |
| **NEW-ROUTE-CCY-1** | P1 | Rule currency matches `input.currency` only. Money `amount.currency` is ignored unless the rule has min/max. `{ currency: "USD", amount: { amount: "10.00", currency: "EUR" } }` routes to a USD gateway. Evidence: `routing/src/match.ts` ~76–79, `amount-range.ts` ~23–27. | H |

### P1 other (fix in this pass)

Production lease / rematch holes. Gate may promote any still-present money lie into blocking (especially NEW-STORE-4 expire-then-lose reserved fence, NEW-CORE-11 mapper type-only complete).

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-STORE-3** | Testkit webhook `complete` / `renew` still `releaseExpiredLease` **before** token fence (`testkit/src/memory/memory-stores.ts` ~572–599). In-package webhooks memory was fixed (leftover-r4 NEW-STORE-3). | F |
| **NEW-STORE-4** | Testkit idempotency `expireIfNeeded` mutates expired `reserved` → `expired` and clears the token in `get` / `markIndeterminate`. A4 hang `markIndeterminate` becomes `lease_lost`; next reserve is a free key. | F |
| **NEW-STORE-5** | Recon-package `complete` / `renew` / `markManualReview` still wipe-before-token. `fail` is already token-first (RECON-LEASE-1). Testkit recon `fail` still wipes first. | F |
| **NEW-CORE-11** | Public mapper `coerceStableSucceededToDomainStatus` rematches `capture.completed` / `refund.completed` only for `partially_captured` / `processing`. Catalog Stripe/PayPal hits skip cancelled/failed/refunded rematch. `handleWebhook` rematch is thicker (leftover-r4 NEW-CORE-8). | G |

### P2 pack (fix if cheap; do not leave as silent money/secret lie)

Honesty, redaction, mock training, perf. None confirmed false-paid / double-refund on built-in default paths — still do not leave a silent money or secret lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **NEW-STRIPE-0** | `fromStripeAmount(undefined\|null)` returns `0`. Call sites currently guard; helper must not invent $0. | A |
| **NEW-PERF-9** | SQL/DO idempotency `deleteExpired` with omitted `limit` is unbounded DELETE (webhook/recon already default 1000 — leftover-r4 NEW-PERF-8). | F |
| **NEW-PERF-1** | PayPal / Moyasar webhook parse still hash the full tree; Stripe hashes compact identity. | B (PayPal hash) + D (Moyasar hash) |
| **NEW-OBS-3** | Logger / observability miss `seti_*_secret_*` and PayPal `A21AA…` access tokens on allow-listed leaves / span messages. | I |
| **NEW-ROUTE-2** | Complementary honesty covers currency / country / method, not `tenant`. After exclude, unconstrained fallback can cross tenant partitions. | H |
| **NEW-TESTKIT-FP-1** | Mock create fingerprint still omits `stripeSetupFutureUsage` / `paymobIframeId` (false idempotent hit). | I |

Residual **PERF-4 / PERF-5 / PERF-7** stay documented leftovers (Redis ZRANGE+N GETs, DO peek-all, serial recon claim). Do not change fencing to chase them.

---

## Stream ownership

Non-overlapping file ownership from `paykernel-leftover-audit-r5-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | NEW-STRIPE-REFUND-0, NEW-STRIPE-0 |
| **B** | PAYPAL | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` | NEW-PAYPAL-7, NEW-PERF-1 (PayPal hash) |
| **D** | MOYASAR | `packages/core/src/gateways/moyasar/**`, `packages/core/docs/moyasar.md` | NEW-MOYASAR-JSON-1, NEW-PERF-1 (Moyasar hash) |
| **E** | WEBHOOKS engine | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md` | NEW-WH-KEY-1 |
| **F** | STORES + recon/testkit memory | `packages/testkit/src/memory/**`, `packages/reconciliation/src/memory-store.ts`, `packages/reconciliation/src/memory-store.test.ts`, `packages/store-postgres/src/stores/idempotency-store.ts`, `packages/store-sqlite/src/stores/idempotency-store.ts`, `packages/store-d1/src/stores/idempotency-store.ts`, `packages/store-turso/src/stores/idempotency-store.ts`, `packages/store-durable-objects/src/stores/idempotency-store.ts` | NEW-STORE-3, NEW-STORE-4, NEW-STORE-5, NEW-PERF-9 |
| **G** | CORE MAP | `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.test.ts` | NEW-CORE-11 |
| **H** | ROUTING | `packages/routing/src/**`, `packages/routing/docs/**` | NEW-ROUTE-CCY-1, NEW-ROUTE-2 |
| **I** | OBS + logger + testkit mock | `packages/observability/src/**`, `packages/core/src/utils/logger.ts`, `packages/core/src/utils/utils.test.ts` if logger tests live there, `packages/testkit/src/mock/**` | NEW-OBS-3, NEW-TESTKIT-FP-1 |
| **J** | DOCS | `docs/audits/**` | this file (bookkeeping only) |

No Stream **C** this pass. No stream owns `packages/core/src/gateways/paymob/**`.

### Ownership fences (do not cross)

- **A** must not edit `abort.ts`, `client.ts`, `webhook-event-map.ts`, `operation-result.ts`, or `logger.ts`.
- **B** must not edit `abort.ts` or `webhook-event-map.ts`.
- **D** must not edit `abort.ts` or `client.ts`.
- **E** must not edit `webhook-event-map.ts` (**G**). **E** must not edit testkit (**F** / **I**).
- **F** must not edit `packages/webhooks/src` (**E**). **F** must not edit `packages/testkit/src/mock` (**I**).
- **G** must not edit `client.ts` (already rematches leftover-r4 NEW-CORE-8). **G** must not edit gateways.
- **H** must not edit `store-*` or the webhooks engine.
- **I** must not edit `packages/testkit/src/memory` (**F**). **I** must not edit gateways.
- **J** must not edit `packages/**`. Bookkeeping only.
- Built-in PaymentStatus values to prefer (do not invent new ones): `partially_captured`, `partially_refunded`, `refund_pending`, `refund_failed`, `refund_completed`, `setup_completed`, `paid`, `pending`, `processing`, `authorized`.
- Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split IDs

**NEW-PERF-1 (B PayPal + D Moyasar)**

- **B:** PayPal `parseWebhookEvent` payload hash should be compact identity (`id` / `type` / `create_time` / `resource.id`), Stripe PERF-6 shape. Do not break hash-source honesty tests; if a test locks full-body hash, flip it to compact identity and document.
- **D:** Moyasar webhook payload hash should be compact identity like Stripe, not the full tree. **D** must not edit `paypal.gateway.ts`.

**NEW-STORE-3 (F, not E)**

Leftover-r4 closed **webhooks** `memory-store.ts` `complete` / `renew` (token-fence first). This-pass **NEW-STORE-3** is **testkit** webhook `complete` / `renew` (`packages/testkit/src/memory/**`). **E** must not edit testkit.

**NEW-CORE-11 (G, not E)**

`handleWebhook` rematch already covers cancelled / failed / refunded (leftover-r4 NEW-CORE-8). **G** thickens `coerceStableSucceededToDomainStatus` and applies it to Stripe / PayPal / Moyasar catalog returns. **G** must not edit `client.ts`.

---

## Recommended close (audit §)

1. NEW-PAYPAL-7  
2. NEW-STRIPE-REFUND-0  
3. NEW-MOYASAR-JSON-1  
4. NEW-WH-KEY-1  
5. NEW-ROUTE-CCY-1  
6. NEW-STORE-3 / NEW-STORE-4 / NEW-STORE-5  
7. NEW-CORE-11  
8. P2 pack  

Items **1–5** are this pass’s ship gate (blocking). Items **6–7** are this-pass other P1s — gate may promote still-present money / fence lies. Item **8** is cheap honesty / redaction / mock / perf — do not leave as a silent money or secret lie.

---

## Already closed (do not re-open)

From leftover-audit-r5 “Prior closed IDs”, leftover-r4, leftover-r3, the first-pass ship-gate, and the session-audit fix-gate. Do **not** re-open unless current code still has the **original** lie.

```
NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX,
NEW-PAYPAL-3 (GET / webhook / order map),
NEW-CORE-8 (handleWebhook rematch),
NEW-STRIPE-VOID-1,
PAYMOB-FENCE-1/2/3, CORE-INF-1/2, MONEY-1, WEBHOOKS-403,
NEW-WEBHOOKS-2 (legacy {status} bags only),
WEBHOOKS-1, CORE-1–8 (original), STRIPE-1/2, STRIPE-CKO-1/CHG-1,
NEW-STRIPE-3 / CKO-200 / 1 / 2, PAYPAL-1/3, PAYPAL-IDEM-1 / DW-1 / ID-1,
NEW-PAYPAL-1, PAYMOB-1/2, PAYMOB-TOCTOU, AUTH-REDIR,
NEW-PAYMOB-2/TTL/REFUND-0, MOYASAR-CAP-0, NEW-MOYASAR-1/2/3,
CORE-HW-1, NEW-CORE-1–7, REDIS-1, RECON-1/2/3,
NEW-RECON-1/2, PERF-1/2, NEW-WEBHOOKS-1, historical PP0–ST1,
NEW-STRIPE-INV-1 / CKO-URL / SETUP-1,
NEW-CORE-9 / NEW-CORE-10, NEW-MONEY-3,
NEW-PAYPAL-4 / 5 / 6, NEW-MOYASAR-4XX, NEW-WH-1, NEW-ROUTE-1,
NEW-STORE-2, leftover-r4 NEW-STORE-3 (webhooks memory only),
NEW-TESTKIT-6/7/8, NEW-OBS-2, NEW-PKG-2, NEW-SQL-1, NEW-PERF-8
```

These are leftover **adjacent** classes, not regressions of the original IDs:

| Prior close | This-pass leftover |
| --- | --- |
| leftover-r4 **NEW-PAYPAL-3** GET / webhook / order map require `final_capture === true` | **NEW-PAYPAL-7** sale/order `capturePayment` still falls back to `requestFinalCapture=true` when the capture omits `final_capture` |
| leftover-r4 **NEW-WEBHOOKS-2** processed keys for legacy `{status}` bags | **NEW-WH-KEY-1** documented `event: webhookEvent.event` (`PaymentEvent`) still has no top-level `status`; processed keys stay `paymob:TRANSACTION:{id}` |
| leftover-r4 **NEW-CORE-8** `handleWebhook` rematch of `capture.completed` / `refund.completed` | **NEW-CORE-11** public mapper rematch still thinner; catalog Stripe/PayPal skip cancelled/failed/refunded |
| leftover-r4 **NEW-STORE-3** webhooks `memory-store.ts` token-first | **NEW-STORE-3** testkit webhook `complete` / `renew` still wipe-before-token |
| leftover-r4 **NEW-PERF-8** webhook/recon `deleteExpired` default 1000 | **NEW-PERF-9** SQL/DO **idempotency** `deleteExpired` omitted `limit` still unbounded |
| leftover-r4 **NEW-OBS-2** `pi_*_secret_*` | **NEW-OBS-3** `seti_*_secret_*` and PayPal `A21AA…` still leak |
| leftover-r4 **NEW-ROUTE-1** complementary currency / country / method | **NEW-ROUTE-2** tenant partitions still unconstrained-fallback; **NEW-ROUTE-CCY-1** `input.currency` vs `amount.currency` still routes |
| leftover-r4 **NEW-TESTKIT-7** `stripeCustomerId` / `paymobIntegrationId` | **NEW-TESTKIT-FP-1** `stripeSetupFutureUsage` / `paymobIframeId` still omitted |
| leftover-r4 Stripe PERF-6 compact webhook identity hash | **NEW-PERF-1** PayPal / Moyasar still hash the full tree |

---

## Stream J status

Wrote this ownership + residual checklist. Stream J did **not** edit `packages/**`. Integrate verified A–I landings, fixed one TypeScript seam in Stream A (`stripe.gateway.ts` PaymentEvent `"payment" in` guard), and recorded landed-vs-remaining below.

**fixed_ids (this stream):** none — J is bookkeeping only.

**This file does not claim a gate pass.** Formal gate artifact is `leftover-audit-r5-fix-result-2026-08-18.md` (not this file). Integrate landed-vs-remaining is below.

---

## Integrate result (2026-08-18, uncommitted)

**Do not commit** (integrate instruction). Working tree is the A–I leftover-audit (round-5) diffs plus this bookkeeping file. This file is still **not** a formal gate result.

**Verify:** `bun run typecheck` green across the monorepo after one Stream-A seam (PaymentEvent union). `bun test` on core / webhooks / reconciliation / routing / testkit / observability / store-contracts / sql-foundation / store-d1 / store-durable-objects / store-redis / store-postgres / store-sqlite / store-turso → **2853 pass / 35 skip / 0 fail**.

No leftover-lie tests found that still lock omitted-`final_capture`-as-`paid`, empty Stripe refund list as `totalRefunded: 0`, Moyasar mutating HTTP 200 invalid JSON as a thrown API error, PaymentEvent `payment.status` as un-qualified Paymob inbox keys, or USD `input.currency` + EUR Money as a routed match.

### Integrate seam

Parallel Stream G thickened rematch + Stream A added Stripe webhook rematch helpers that read `event.event.payment`. `PaymentEvent` refund/dispute/setup arms have no `payment`. Typecheck failed (`TS2339`). Integrate used the same `"payment" in event.event` guard as PayPal / Moyasar. No money-path change.

### Invariant cross-check (blocking)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **NEW-PAYPAL-7** | landed | Sale/order `capturePayment` maps `paid` only when **response** `final_capture === true`. Omitted / `undefined` / `false` → `partially_captured` + `outcome: requires_action` (`isPaidOutcome` false). Does **not** fall back to request intent (sale/order never send `final_capture`). Same rule as GET / webhook. Test `'should capture order and return capture ID'` flipped; dedicated omitted-`final_capture` case added. |
| **NEW-STRIPE-REFUND-0** | landed | `getTotalRefundedForPaymentIntent` returns `undefined` on empty / pending-only / `<= 0` (not major `0`). Catch **and** unproven-list recover `charge.amount_refunded` only when finite **and** `> 0`. Succeeded refund + empty list omits `totalRefunded`. |
| **NEW-MOYASAR-JSON-1** | landed | Mutating HTTP 2xx invalid JSON throws `NetworkError({ afterProviderSubmit: true })`, not `GatewayApiError` status 200. `executeWithHooks` → `indeterminate`; fence stays `unknown`; same key does not POST again. GET / non-mutating 2xx stay `GatewayApiError`. |
| **NEW-WH-KEY-1** | landed | `extractInboxDomainStatus` reads `status`, `payment.status`, `refund.status`, and those paths on nested `event`. Recommended `event: webhookEvent.event` (PaymentEvent) produces `paymob:TRANSACTION:{id}:{status}`. Later same-id void is not `already_completed`. Redirect still ignores status. |
| **NEW-ROUTE-CCY-1** | landed | Conflicting `input.currency` vs `Money.currency` / `amountCurrency` throws `NoRouteMatchError` (`currency_mismatch_honesty`) **before** rule or fallback match. A USD rule does not match EUR Money. Unconstrained fallback is not used. Incomplete money (only one side) is not a conflict. |

### Other P1

| ID | Verdict |
| --- | --- |
| **NEW-STORE-3** | landed — testkit webhook `complete` / `renew` token-fence first; expired complete fails closed without wipe-then-lose. |
| **NEW-STORE-4** | landed — testkit idempotency `get` is read-only (no `expireIfNeeded`); `markIndeterminate` is token-first so A4 hang still parks after expiry. |
| **NEW-STORE-5** | landed — recon-package and testkit recon `complete` / `renew` / `markManualReview` / `fail` are token-first. |
| **NEW-CORE-11** | landed — public mapper rematch table matches `handleWebhook` (cancelled / reversed / failed / refunded / authorized / open money) and is applied to Stripe / PayPal / Moyasar catalog settlement names. |

### P2 pack

| ID | Verdict |
| --- | --- |
| **NEW-STRIPE-0** | landed — `fromStripeAmount(undefined\|null)` returns `undefined` (does not invent major `0`). |
| **NEW-PERF-9** | landed — SQL / DO idempotency `deleteExpired` omitted `limit` binds default 1000 (not unbounded DELETE). |
| **NEW-PERF-1** | landed — PayPal and Moyasar webhook `payloadHash` use compact identity (`id` / `type` / time / resource.id), Stripe PERF-6 shape. |
| **NEW-OBS-3** | landed — logger + observability redact `seti_*_secret_*` and PayPal `A21AA…` / long `A21…` on allow-listed leaves and span / log messages. |
| **NEW-ROUTE-2** | landed — complementary **tenant** partitions honesty-block unconstrained fallback after the matching tenant bucket is excluded or unhealthy. |
| **NEW-TESTKIT-FP-1** | landed — mock create fingerprint includes `stripeSetupFutureUsage` / `paymobIframeId`. |

### Documented leftovers (not NEW-*)

| ID | Verdict |
| --- | --- |
| **PERF-4** | **cheap cut closed** — ZRANGE + one list-GET EVAL. N hashes still read inside the script. |
| **PERF-5** | **cheap cut closed for partitions===1** (skip peek). `partitions>1` still peeks every isolate. |
| **PERF-7** | **cheap cut closed for claimDue** (concurrent). `processDue` stays one-at-a-time (NEW-RECON-2). |

---

## Residual ID checklist (copy for critic / gate)

Flipped by integrate against current uncommitted source + tests. Formal gate still writes `leftover-audit-r5-fix-result-2026-08-18.md`.

### Blocking (ship gate)

- [x] NEW-PAYPAL-7
- [x] NEW-STRIPE-REFUND-0
- [x] NEW-MOYASAR-JSON-1
- [x] NEW-WH-KEY-1
- [x] NEW-ROUTE-CCY-1

### Other P1

- [x] NEW-STORE-3
- [x] NEW-STORE-4
- [x] NEW-STORE-5
- [x] NEW-CORE-11

### P2 pack

- [x] NEW-STRIPE-0
- [x] NEW-PERF-9
- [x] NEW-PERF-1 (PayPal **B** + Moyasar **D**)
- [x] NEW-OBS-3
- [x] NEW-ROUTE-2
- [x] NEW-TESTKIT-FP-1

### Documented leftovers (not NEW-\*; unowned unless already in-stream)

- [x] PERF-4 cheap cut (ZRANGE + one list-GET EVAL; N hashes still inside the script)
- [x] PERF-5 cheap cut (`partitions===1` skips peek; N>1 still peeks)
- [x] PERF-7 cheap cut (`claimDue` concurrent; `processDue` still serial)
