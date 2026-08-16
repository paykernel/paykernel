# PayKernel session audit (2026-08-16, round 2)

**Scope:** leftover money / fence / dual-write / recovery / perf holes after the 2026-08-16 ship-gate.  
**Source:** independent source re-read (not the first-pass report).  
**Prior ship-gate IDs (WEBHOOKS-1, CORE-1, STRIPE-1/2, PAYPAL-1/3, PAYMOB-2 Intention):** treated as **already closed**. Do not re-open unless current code still has the original lie.

**Verdict at pass start:** **SHIP_BLOCKED** on new fence-release / dual-write leftovers.

---

## Blocking (must close)

| ID | Sev | One-line |
| --- | --- | --- |
| **PAYMOB-FENCE-1** | P1 | Durable `reserveStoredIdempotencyRecord` deletes any row with expired `expiresAt`, including `unknown` / `in_progress`. Indeterminate refund/capture/void is stamped `expiresAt: now+24h`. After 24h the same key re-enters the mutation (double-apply). In-memory cache correctly never evicts those fences. |
| **PAYMOB-FENCE-2** | P1 | Caller abort after a mutating POST becomes `PaymentAbortedError`. `fetchPaymobMutation` only wraps `NetworkError` as indeterminate. `executeIdempotent` then **deletes** the fence. Timeout on the same body-read is indeterminate; `AbortController` / worker cancel is not. |
| **PAYMOB-FENCE-3** | P1 | Legacy Egypt create still uses `requireNumber` / `requireString` → `GatewayApiError` on HTTP 200 missing order id / payment token, which **releases** the fence. Intention was fixed; this path was not. |
| **PAYPAL-IDEM-1** | P1 | `getRequestId("")` keeps the empty string; `if (requestId)` skips `PayPal-Request-Id`. In-process `withRetry` after timeout/5xx can double-mutate. Stripe trims empty keys and always generates. |
| **PAYPAL-DW-1** | P1 | `PAYMENT.CAPTURE.REFUNDED` domain status is fail-closed `partially_refunded`, but static map still dual-writes `refund.completed`. Demote only runs for `status === "refund_completed"`. Type-only handlers can close the capture as fully refunded. |
| **WEBHOOKS-403** | P1 | `InvalidWebhookError` is always constructed with HTTP **403**. Parse-stage messages skip *forgery* but then hit `isPermanentClientHttpStatus(403)`. `processWithVerifier` + `parseWebhookEvent` can drop a signature-valid paid body as non-retryable. `handleWebhook` is safe (rewrites to `InvalidRequestError`). |

---

## Other P1 (fix in this pass)

| ID | One-line |
| --- | --- |
| **STRIPE-CKO-1** | `checkout.session.completed` (`payment_status: paid`) and `async_payment_succeeded` ignore refunds. Docs tell integrators to hydrate the current Stripe object; Checkout stays `paid` after refunds. PI.succeeded was fixed; Checkout was not. |
| **STRIPE-CHG-1** | `stripeSucceededIntentRefundStatus` only reads expanded `latest_charge`. If `latest_charge` is omitted and refunds live on `charges.data[0]`, settled math can still reach `paid`. |
| **CORE-INF-1** | `inferOperationOutcome`: `success: false` + `paid` / `authorized` / `partially_captured` / `refunded` → `failed` (P610-INF-2 only lists pending/processing/approved). Retry-as-failed can double-charge. |
| **CORE-INF-2** | `inferRefundOperationOutcome`: `success: false` + `status: "completed"` → `failed`. Retry can double-refund. |
| **CORE-HW-1** | `handleWebhook` skips demote when `isPaymentEvent` passes. A complete v1 `payment.succeeded` arm with envelope `processing` / `partially_captured` is trusted. Built-ins rematch first; custom / dishonest attach skips the safety net. |
| **CORE-6-EXT** | `coerceStableSucceededToDomainStatus` only remaps failed/pending/processing. Already-stable `payment.succeeded` + `authorized` / `approved` / `partially_captured` stays succeeded. |
| **PAYPAL-ID-1** | Webhook `gatewayPaymentId` uses last / `related_ids.capture_id` unless `refundableCaptureCount > 1`. Siblings `[COMPLETED $50, later REFUNDED $50]` attach remaining-held money to the **refunded** capture. `getPayment` would have published the held id. |
| **PAYMOB-TOCTOU** | Store without `reserve()` is get-then-set. Moyasar throws; Paymob warns and continues. Concurrent workers can double-apply. |
| **RECON-LEASE-1** | Recon `fail` / `complete` still require `lease_expires_at > now`. Handler overrun → `lease_lost` → `listDue` restores an attempt → reclaim forever. `maxAttempts` never dead-letters. |
| **WH-LIST-FAIL** | `listRetryable` / `listDue` wipe lease token on expired claimed. A late `fail()` then cannot record (token gone). Concurrent poller defeats post-expiry fail. |
| **MOYASAR-CAP-0** | `paid` + finite `captured: 0` is not demoted (only missing captured is). Dual-write can stay `payment.succeeded` and publish full amount. |
| **PAYMOB-AUTH-REDIR** | AUTH redirect (`is_auth` + success) dual-writes `payment.authorized`. Sale redirect is demoted to `payment.processing`; AUTH is not. |

---

## P2 (fix if cheap; do not leave as silent money lie)

| ID | One-line |
| --- | --- |
| **MOYASAR-3** | Public `moyasarSource` / `CreditCardSource` JSDoc still advertise raw `creditcard`. Runtime rejects. Honesty only. |
| **SQL-UPD-1** | Postgres expired-claim `UPDATE … WHERE key IN (SELECT claimed …)` does not re-check `status = 'claimed'`. Concurrent pollers can double-decrement `attempts`. |
| **PERF-3** | Composite list indexes exist in sql-foundation v1 DDL only. `migrate()` skips applied v1. D1 Wrangler `0001_foundation.sql` is still single-column. |
| **PERF-4** | Redis `listDue` / `listRetryable` is ZRANGE + N Lua GETs. |
| **PERF-5** | DO `listDue` wakes every hash isolate at full `limit`. |
| **PERF-6** | Webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. |
| **PERF-7** | `processDue` / `processRetryable` still list-then-serial-claim. |
| **REDIS-CLEAN-1** | `deleteExpired` default `limit` is `Infinity` (SCAN + per-key EVAL). |

---

## Already closed (do not re-open)

WEBHOOKS-1 (redirect vs processed inbox key), CORE-1 (refund pending infer), STRIPE-1 (refund entity status), STRIPE-2 (PI.succeeded + unexpanded charge), PAYPAL-1 (domain status on CAPTURE.REFUNDED), PAYPAL-3 (no invented COMPLETED capture), PAYMOB-2 Intention fence, CORE-2/3/4 original forms, MONEY-1 JMD/XCG/XAD, REDIS-1 rescore, RECON-1/2/3 original forms, PERF-1/2 original forms, OBS-1/2, TESTKIT-1/2/3/4, PKG-1.

---

## Recommended close

1. PAYMOB-FENCE-1 / 2 / 3  
2. PAYPAL-IDEM-1  
3. PAYPAL-DW-1  
4. WEBHOOKS-403  
5. STRIPE-CKO-1 / STRIPE-CHG-1  
6. CORE-INF-1 / CORE-INF-2 / CORE-HW-1 / CORE-6-EXT  
7. PAYPAL-ID-1, PAYMOB-TOCTOU, RECON-LEASE-1, WH-LIST-FAIL, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR  
8. P2 pack
