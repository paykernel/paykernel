# PayKernel session-audit-fix-gate (2026-08-16)

**Stance:** fail-closed. Implement summaries in `session-audit-fix-pass-2026-08-16.md` were **not** trusted. Each blocking ID was re-read in source (`read_file` / `grep`).  
**Audit:** [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-fix-gate.rhai`  
**Date:** 2026-08-16

```
GATE
pass=true
typecheck_ok=true
tests_ok=true
blocking:
non_blocking:
- PERF-5
- PERF-6
- PERF-7
```

| Field | Value |
| --- | --- |
| **pass** | `true` (no blocking fence / dual-write / money-lie leftovers) |
| **typecheck** | `bun run typecheck` — 15 packages exit 0 |
| **tests** | `2708` pass / `35` skip / `0` fail / `156` files (live-adapter skips only; sql-foundation WAL flake did not fire) |

---

## Blocking set (must still be money/fence lies to fail)

### PAYMOB-FENCE-1 — closed

`isStoredIdempotencyReplayExpired` is `status === "completed"` **and** `expiresAt <= now` only (`paymob.gateway.ts` ~3140–3149).  
`reserveStoredIdempotencyRecord` deletes and re-reserves **only** expired `completed` rows (~3102–3113). Expired `unknown` / `in_progress` are retained; expired `in_progress` is rewritten to `unknown` (~3156–3169). In-memory prune already skipped those statuses.  
Lock: `paymob.gateway.test.ts` expired durable unknown / in_progress refuse re-reserve.

### PAYMOB-FENCE-2 — closed

`fetchPaymobMutation` wraps **both** `NetworkError` and `PaymentAbortedError` as `PaymobIndeterminateNetworkError` (~2883–2899). `mapHttpAbortError` still maps caller abort to `PaymentAbortedError`; that type no longer reaches `executeIdempotent` as a retryable delete. Indeterminate catch keeps the local + durable fence (~3014–3030).  
Lock: abort after Intention POST and after refund POST.

### PAYMOB-FENCE-3 — closed

Legacy Egypt Orders uses `requireMutationNumber` for `id`; Payment Keys uses `requireMutationString` for `token` (~685–732). Missing HTTP-200 id/token throws `PaymobIndeterminateResponseError` (keeps fence), not `GatewayApiError`. Intention path already used mutation helpers. Bare `requireNumber` / `requireString` remain only on inquiry / HMAC / currency (not post-mutation create).

### PAYPAL-IDEM-1 — closed

`getRequestId` trims; empty / whitespace / omitted mint `runtime.randomUUID()` (~1905–1924). `createJsonHeaders` **always** sets `PayPal-Request-Id` (~1880–1890). Empty string is not left as `""` for `if (requestId)` to skip.  
Lock: empty/whitespace key still generates and the header is sent.

### PAYPAL-DW-1 — closed on the product path

`mapWebhookStatus` still fail-closes refund-shaped `PAYMENT.CAPTURE.REFUNDED` to `partially_refunded` (~2931–2947). After `attachPaymentEvent`, `demoteIncompleteRefundWebhookDualWrite` rematches **both** `status === "refund_completed"` **and** `type === PAYMENT.CAPTURE.REFUNDED && status === "partially_refunded"` off `refund.completed` → `refund.pending` (~3341–3369). Proven `refunded` stays `refund.completed`.  
`mapPayPalEventType` status-gates `PAYMENT.CAPTURE.REFUNDED` (`refunded` → `refund.completed`; else `refund.pending`). Catalog map still names the proven-full-refund arm.

### WEBHOOKS-403 — closed

`InvalidWebhookError` is still HTTP 403 (`errors.ts` ~108–115). `isPermanentNonRetryableVerifyError` excludes non-verify `InvalidWebhookError` before the 4xx fall-through (`engine.ts` ~323–330). `classifyVerifyThrow` → `processWithVerifier` maps parse-stage / unknown InvalidWebhook to `handler_failed { retryable: true }` (~1272–1293). Forgery stays verify-false message only. `handleWebhook` still rewrites parse to `InvalidRequestError`.  
Lock: `engine.test.ts` WEBHOOKS-403.

---

## Other money-lie IDs (blocking if still present)

| ID | Verdict | Source evidence |
| --- | --- | --- |
| **STRIPE-CKO-1** | closed | `checkout.session.completed` (`payment_status: paid`) and `async_payment_succeeded` run `stripeCheckoutPaidSessionStatus`. Hydrated PI/charge rematches refunds; missing charge snapshot → `processing`; rematch dual-write `payment.succeeded` + refunded → `refund.completed` (`stripe.gateway.ts` ~998–1036, ~1285–1314, ~2379–2428). Classic **unhydrated** string `payment_intent` still stays `paid` (documented). |
| **STRIPE-CHG-1** | closed | `stripeChargeSnapshotForRefundStatus` uses expanded `latest_charge`, then `charges.data[0]` when `latest_charge` is omitted. Unexpanded string id stays unobservable / `processing` (~877–891). |
| **CORE-INF-1** | closed | `inferOperationOutcome`: `!success` + `paid` / `authorized` / `partially_captured` / `refunded` / `partially_refunded` → `indeterminate` (`operation-result.ts` ~330–352). |
| **CORE-INF-2** | closed | `inferRefundOperationOutcome`: `!success` + `completed` → `indeterminate` (~1002–1014). |
| **CORE-HW-1** | closed | `handleWebhook` always rematches a complete v1 `payment.succeeded` arm against `processing` / `partially_captured` / `authorized` / `approved` (`client.ts` ~147–178, ~824–843). |
| **CORE-6-EXT** | closed | `coerceStableSucceededToDomainStatus` remaps `authorized` / `approved` / `partially_captured` / `refunded` / `partially_refunded` → `payment.processing` (`webhook-event-map.ts` ~584–606). |
| **PAYPAL-ID-1** | closed | Webhook `gatewayPaymentId` prefers `selectSingleRefundableCaptureId` (still-held sibling) over last / `related_ids.capture_id`; >1 refundable keeps order id (`paypal.gateway.ts` ~1276–1287). |
| **PAYMOB-TOCTOU** | closed | Store without `reserve()` throws `InvalidRequestError`. No get-then-set fallthrough (~3086–3095). |
| **RECON-LEASE-1** | closed | `reconciliationFailTemplates` / `markManualReview` match `lease_token` + `status = claimed` only (no `lease_expires_at > now`). Scheduler hang budget + `failAndReschedule` after overrun. `complete` stays unexpired-only. |
| **MOYASAR-CAP-0** | closed | `paid` + missing / non-finite / finite `0` `captured` → `processing` on map + webhook money snapshot (`moyasar.gateway.ts` ~1342–1349, ~1792–1803). |
| **PAYMOB-AUTH-REDIR** | closed | `TRANSACTION_RESPONSE` + `authorized` / `is_auth` demotes to `payment.processing`. Processed `TRANSACTION` still publishes `payment.authorized` (`webhook-event-map.ts` ~365–368, ~561–567). |

**WH-LIST-FAIL** (other P1, not in the money-lie must-block list): `listRetryable` still soft-releases expired claimed (token wiped — required for poll recovery). Engine `fail` after wipe is `lease_lost` → best-effort reclaim + fail / retryable `handler_failed`, **never** `complete` (`engine.ts` ~929–959). Outer `UPDATE … WHERE status = 'claimed'` closes SQL-UPD-1 double-decrement. Not treated as a remaining money lie.

---

## P2 residuals (non-blocking, documented)

| ID | Status |
| --- | --- |
| **PERF-5** | closed — peek every enumerable isolate; full-list only occupied shards. |
| **PERF-6** | closed (owned clone path) — no deep-clone of `rawPayload` on hook isolation. Stripe gateway parse/hash unchanged. |
| **PERF-7** | closed — listed claims run concurrently; handlers stay serial. Oversample cap 200. |
| **MOYASAR-3** | closed — `moyasarSource` / `CreditCardSource` JSDoc state backend `createPayment` **rejects** raw `creditcard`. |
| **REDIS-CLEAN-1** | closed — `DEFAULT_DELETE_EXPIRED_LIMIT = 1000` (`store-redis/src/limits.ts`). |

---

## Commands

```
bun run typecheck                          # 15 packages, exit 0
bun test packages/core … store-* scripts/  # 2708 pass / 35 skip / 0 fail
```

Skipped tests are live postgres / redis / turso / better-sqlite3 integration only.

---

## Verdict

**PASS.** Session-audit fence-release, empty PayPal-Request-Id, type-only incomplete `refund.completed`, parse-stage 403 drop, and the listed money-lie IDs are not still present in source. Residual PERF-5/6/7 are documented and non-blocking.
