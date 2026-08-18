# PayKernel leftover audit (2026-08-18, round 5)

**Scope:** leftover money / fence / inbox / routing / store / redaction holes after leftover-audit-r4 ship-gate.  
**Prior closed IDs:** leftover-r4 set (NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3 GET/webhook/order map, NEW-CORE-8 handleWebhook rematch, NEW-STRIPE-VOID-1, PAYMOB-FENCE-1/2/3, CORE-INF-1/2, MONEY-1, WEBHOOKS-403, NEW-WEBHOOKS-2 for *legacy* `{status}` bags only).  
Do **not** re-open those unless the original lie is still in source.

**Verdict at pass start:** **SHIP_BLOCKED** on sale-intent PayPal `capturePayment` omitted `final_capture` as `paid`, Stripe refund list `totalRefunded: 0`, Moyasar mutating HTTP 200 invalid JSON as a thrown API error, Paymob inbox keys missing PaymentEvent domain status, and routing `input.currency` ≠ `amount.currency`.

---

## Blocking (must close)

| ID | Sev | One-line |
| --- | --- | --- |
| **NEW-PAYPAL-7** | P1 | Sale/order `capturePayment` falls back to `requestFinalCapture=true` when the capture omits `final_capture`. GET / webhook still require `=== true`. Same capture fulfills on capture then looks open on poll. Test `'should capture order and return capture ID'` locks the lie. Evidence: `paypal.gateway.ts` ~626–694. |
| **NEW-STRIPE-REFUND-0** | P1 | `getTotalRefundedForPaymentIntent` starts at `0` and returns major `0` on empty / pending-only list. Catch fallback to `charge.amount_refunded` runs only on **throw**. Completed refund can ledger `totalRefunded: 0`. Evidence: `stripe.gateway.ts` ~1842–1882, ~2869–2906. |
| **NEW-MOYASAR-JSON-1** | P1 | `parseJsonResponse` throws `GatewayApiError` with HTTP 200 on invalid JSON. Fence stays `unknown` (good) but `executeWithHooks` only maps `NetworkError.afterProviderSubmit` → indeterminate. Caller throw + new key double-applies. Evidence: `moyasar.gateway.ts` ~1774–1786. |
| **NEW-WH-KEY-1** | P1 | `extractInboxDomainStatus` reads only top-level `status`. Documented path is `event: webhookEvent.event` (`PaymentEvent` has `payment.status` / `refund.status`). Processed Paymob keys stay `paymob:TRANSACTION:{id}`; later same-id void is `already_completed`. NEW-WEBHOOKS-2 test uses a legacy `{status}` bag. Evidence: `webhooks/src/engine.ts` ~713–720; README ~61. |
| **NEW-ROUTE-CCY-1** | P1 | Rule currency matches `input.currency` only. Money `amount.currency` is ignored unless the rule has min/max. `{ currency: "USD", amount: { amount: "10.00", currency: "EUR" } }` routes to a USD gateway. Evidence: `routing/src/match.ts` ~76–79, `amount-range.ts` ~23–27. |

---

## Other P1 / residual (fix in this pass)

| ID | One-line |
| --- | --- |
| **NEW-STORE-3** | Testkit webhook `complete` / `renew` still `releaseExpiredLease` **before** token fence (`testkit/src/memory/memory-stores.ts` ~572–599). In-package webhooks memory was fixed. |
| **NEW-STORE-4** | Testkit idempotency `expireIfNeeded` mutates expired `reserved` → `expired` and clears the token in `get` / `markIndeterminate`. A4 hang `markIndeterminate` becomes `lease_lost`; next reserve is a free key. |
| **NEW-STORE-5** | Recon-package `complete` / `renew` / `markManualReview` still wipe-before-token. `fail` is already token-first (RECON-LEASE-1). Testkit recon `fail` still wipes first. |
| **NEW-CORE-11** | Public mapper `coerceStableSucceededToDomainStatus` rematches `capture.completed` / `refund.completed` only for `partially_captured` / `processing`. Catalog Stripe/PayPal hits skip cancelled/failed/refunded rematch. `handleWebhook` rematch is thicker. |

---

## P2 (fix if cheap; do not leave as silent money/secret lie)

| ID | One-line |
| --- | --- |
| **NEW-STRIPE-0** | `fromStripeAmount(undefined\|null)` returns `0`. Call sites currently guard; helper must not invent $0. |
| **NEW-PERF-9** | SQL/DO idempotency `deleteExpired` with omitted `limit` is unbounded DELETE (webhook/recon already default 1000). |
| **NEW-PERF-1** | PayPal / Moyasar webhook parse still hash the full tree; Stripe hashes compact identity. |
| **NEW-OBS-3** | Logger / observability miss `seti_*_secret_*` and PayPal `A21AA…` access tokens on allow-listed leaves / span messages. |
| **NEW-ROUTE-2** | Complementary honesty covers currency / country / method, not `tenant`. After exclude, unconstrained fallback can cross tenant partitions. |
| **NEW-TESTKIT-FP-1** | Mock create fingerprint still omits `stripeSetupFutureUsage` / `paymobIframeId` (false idempotent hit). |

Residual **PERF-4 / PERF-5 / PERF-7** were followed up without changing fencing: Redis list is one EVAL, DO peek skips when `partitions === 1`, `claimDue` is concurrent (`processDue` stays serial). See leftover-audit-r5-fix-result.

---

## Recommended close

1. NEW-PAYPAL-7  
2. NEW-STRIPE-REFUND-0  
3. NEW-MOYASAR-JSON-1  
4. NEW-WH-KEY-1  
5. NEW-ROUTE-CCY-1  
6. NEW-STORE-3 / NEW-STORE-4 / NEW-STORE-5  
7. NEW-CORE-11  
8. P2 pack  

Items **1–5** are this pass’s ship gate (blocking).
