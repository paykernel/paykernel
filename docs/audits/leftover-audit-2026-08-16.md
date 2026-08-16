# PayKernel leftover audit (2026-08-16, round 3)

**Scope:** leftover money / fence / dual-write / lease / mock / perf holes after the 2026-08-16 ship-gate and session-audit fix-gates.  
**Prior closed IDs:** WEBHOOKS-1, CORE-1–8 (original forms), STRIPE-1/2, PAYPAL-1/3, PAYMOB-1/2, PAYMOB-FENCE-1/2/3, STRIPE-CKO-1/CHG-1, CORE-INF-1/2, CORE-HW-1, MONEY-1, REDIS-1, RECON-1/2/3, PERF-1/2, TESTKIT-1–4, OBS-1/2, PKG-1. Do **not** re-open unless the original lie is still in source.

**Verdict at pass start:** **SHIP_BLOCKED** on post-submit uncertainty classified as a clean failure, plus Stripe Checkout hardcoded `success: true`.

---

## Blocking (must close)

| ID | Sev | One-line |
| --- | --- | --- |
| **NEW-STRIPE-3** | P1 | `stripeRequest` HTTP 200 empty/`{}`/non-JSON is returned as success. Create/capture map missing status to `failed`; refund maps missing status to `pending` + `success: true`; `fromStripeAmount(undefined)` is `0` on create using caller currency. |
| **NEW-STRIPE-CKO-200** | P1 | `createCheckoutSession` / `getCheckoutSession` hardcode `success: true` with no `id`/`url` assert. Empty 200 → `{ success: true, sessionId: undefined }`. |
| **NEW-CORE-1** | P1 | Caller abort after a mutating POST is `PaymentAbortedError`. `tryIndeterminateFromNetworkError` only accepts `NetworkError.afterProviderSubmit`. Retry-as-cancel can double-charge / double-refund. Paymob already wraps abort; Stripe/PayPal/Moyasar do not. |
| **NEW-PAYPAL-1** | P1 | HTTP 200 missing `id`/`status` throws `PayPalApiError` status 0 (not indeterminate). App-level retry mints a new `PayPal-Request-Id`. |
| **NEW-PAYMOB-2** | P1 | Mutation HTTP 429 (and other non-5xx `!ok`) after POST is `GatewayApiError`/`RateLimitError`; `executeIdempotent` **deletes** the fence. Moyasar keeps 429. |
| **NEW-MOYASAR-1** | P1 | Create HTTP 200 `{}` maps missing status to `failed` / `declined` with undefined `gatewayId`. No create fence. Caller mints a new `given_id`. |

---

## Other P1 (fix in this pass)

| ID | One-line |
| --- | --- |
| **NEW-CORE-2** | `handleWebhook` rematch changes `stableType` only; nested `event.payment.status` can stay `paid`. |
| **NEW-CORE-3** | Rematch ignores envelope `pending` / `failed` / `cancelled` / `reversed` (mapper already rematches). |
| **NEW-CORE-4** | Paymob `is_capture` + `partially_captured` dual-writes `capture.completed`. |
| **NEW-CORE-5** | `applyOutcomeToGatewayRefundResult` does not coerce outcome vs status (payment apply does). |
| **NEW-WEBHOOKS-1** | `processRetryable` claims N keys in parallel then runs handlers serially; later leases expire → peer reclaim + this worker still handles (double-run). |
| **NEW-RECON-2** | `processDue` same parallel-claim / serial-handler lease overrun. |
| **NEW-RECON-1** | In-flight `pending`/`processing` + `capturedAmount=0` vs `local.amount` invents drift → `apply_drift_review` (bypasses `retry_later`). |
| **NEW-PAYMOB-TTL** | Completed Paymob fences expire at 24h and in-memory evicts completed at 1000; `delete`+`reserve` of expired completed is not atomic. No native Paymob idempotency. |
| **NEW-STRIPE-1** | `getPayment` refund math ignores `charges.data[0]` when `latest_charge` is omitted (webhook helper already reads it). |
| **NEW-STRIPE-2** | Id-only charge object `{ id: "ch_…" }` is treated as an observed snapshot; missing `amount_refunded` means “no refund” → `paid`. |
| **NEW-PAYMOB-REFUND-0** | Refund mutation `success: true` + `refunded_amount_cents: 0` → `completed` + `totalRefunded: 0`. |

---

## P2 (fix if cheap; do not leave as silent money lie)

| ID | One-line |
| --- | --- |
| **NEW-PAYMOB-VOID-P** | Void ignores `pending` (capture/refund honor it). |
| **NEW-PAYMOB-FP** | Local `JSON.stringify` fingerprint (Date vs ISO); not shared `fingerprintParams`. |
| **NEW-MOYASAR-2** | Verified `card_auth_*` parse throws `InvalidWebhookError` → handleWebhook remaps retryable. |
| **NEW-MOYASAR-3** | `confirmStcPayOtp` is an unfenced mutation POST. |
| **NEW-WEBHOOKS-2** | Processed Paymob inbox key is still one `obj.id`; later same-id snapshot is `already_completed`. Child refunds have new ids. |
| **NEW-STORE-1** | Redis list leaves ghost ZSET members when GET is missing. |
| **NEW-CORE-6** | `outcome: declined/failed` can persist with `status: paid`. |
| **NEW-CORE-7** | After-hook freeze omits `refundedAt`; Dates shared by reference. |
| **NEW-MONEY-1** | `applyOutcomeToGatewayResult` can publish non-finite / currency-less amounts. |
| **NEW-MONEY-2** | Webhook payload redaction misses PAN/CVC keys the logger already scrubs. |
| **NEW-TESTKIT-1** | Mock create fingerprint omits `orderId` / payment-method identity. |
| **NEW-TESTKIT-2** | Partial refund freezes remaining capturable hold. |
| **NEW-TESTKIT-3** | `getPayment` + `outcome: "succeeded"` overwrites ledger to `paid`. |
| **NEW-TESTKIT-4** | `capture: false` without authorization capability silently pays. |
| **NEW-TESTKIT-5** | Fixture safety misses `cs_live_` / PI client secrets. |
| **NEW-OBS-1** | OTEL span status messages still pass PANs. |
| **NEW-PAYPAL-2** | Docs say partial capture `outcome: succeeded`; code is `requires_action`. |

Residual PERF-5/6/7 stay documented leftovers unless a stream can cheaply improve them without breaking fencing.

---

## Recommended close

1. NEW-STRIPE-3 / NEW-STRIPE-CKO-200  
2. NEW-CORE-1  
3. NEW-PAYPAL-1 / NEW-PAYMOB-2 / NEW-MOYASAR-1  
4. NEW-CORE-2 / NEW-CORE-3 / NEW-CORE-4 / NEW-CORE-5  
5. NEW-WEBHOOKS-1 / NEW-RECON-2  
6. NEW-RECON-1 / NEW-PAYMOB-TTL / NEW-STRIPE-1 / NEW-STRIPE-2 / NEW-PAYMOB-REFUND-0  
7. P2 pack
