# PayKernel 2026-08-16 session-audit fix-gate result

**Date:** 2026-08-16  
**Original audit:** [`session-audit-2026-08-16.md`](./session-audit-2026-08-16.md)  
**Fix-pass bookkeeping:** [`session-audit-fix-pass-2026-08-16.md`](./session-audit-fix-pass-2026-08-16.md)  
**Gate re-read:** [`session-audit-fix-gate-2026-08-16.md`](./session-audit-fix-gate-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-fix-gate.rhai`  
**Reviewer stance:** fail-closed. Implement summaries were **not** trusted. Residual P1 fence / dual-write / 403 / money-lie paths were re-grepped in source.  
**Working tree:** uncommitted session-audit leftover diffs. Not a release commit.

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
summary=PASS. Session-audit fence/idempotency/403/money-lie IDs are closed in source (PAYMOB-FENCE-1/2/3, PAYPAL-IDEM-1, PAYPAL-DW-1, WEBHOOKS-403, STRIPE-CKO/CHG, CORE-INF/HW/6-EXT, PAYPAL-ID-1, PAYMOB-TOCTOU, RECON-LEASE-1, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR). Typecheck green; 2708 pass / 35 skip / 0 fail. Residual PERF-5/6/7 only.
blocking:
non_blocking:
- PERF-5
- PERF-6
- PERF-7
```

---

## Verify

```
VERIFY: typecheck_ok=true tests_ok=true invariants_ok=true ok=true
tests=2708 pass / 35 skip / 0 fail / 156 files
```

- `bun run typecheck`: all 15 workspace packages exit 0.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso scripts/`: **2708 pass, 0 fail**. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3). Isolated bun:sqlite multi-connection WAL flake did **not** fire.

Session-audit invariants (audit recommended close 1–7) hold in source and in tests that would have failed the leftover audit.

---

## Implement

Ten parallel streams (`fix:stripe`, `fix:paypal`, `fix:paymob`, `fix:moyasar`, `fix:webhooks`, `fix:stores-perf`, `fix:core-infer`, `fix:recon-routing`, `fix:testkit-obs`, `fix:docs-audit`) plus integrate. **ok=10 fail=0**. No remediating gate cycle.

| Stream | Label | Residual IDs closed |
| --- | --- | --- |
| **A** | STRIPE | STRIPE-CKO-1, STRIPE-CHG-1 |
| **B** | PAYPAL | PAYPAL-IDEM-1, PAYPAL-DW-1, PAYPAL-ID-1 |
| **C** | PAYMOB | PAYMOB-FENCE-1, PAYMOB-FENCE-2, PAYMOB-FENCE-3, PAYMOB-TOCTOU |
| **D** | MOYASAR | MOYASAR-CAP-0, MOYASAR-3 |
| **E** | WEBHOOKS + `handleWebhook` | WEBHOOKS-403, CORE-HW-1, WH-LIST-FAIL (engine) |
| **F** | STORES + sql-foundation | RECON-LEASE-1 (store), SQL-UPD-1 / WH-LIST-FAIL (list UPDATE), PERF-3/4, REDIS-CLEAN-1; PERF-5 documented |
| **G** | CORE infer + webhook-event-map | CORE-INF-1, CORE-INF-2, CORE-6-EXT, PAYMOB-AUTH-REDIR |
| **H** | RECON scheduler | RECON-LEASE-1 (hang budget); PERF-7 documented (oversample cap 200) |
| **I** | TESTKIT + OBS | no leftover money IDs; ledger settles on domain status even when outcome is `requires_action` |
| **J** | DOCS audit bookkeeping | this result + ownership checklist |

---

## What was fixed vs remaining

Audit start: **SHIP_BLOCKED** on fence-release / dual-write leftovers. Prior ship-gate IDs (WEBHOOKS-1, CORE-1, STRIPE-1/2, PAYPAL-1/3, PAYMOB-2 Intention) stay closed and were not re-opened.

### Closed — P1 blocking (audit § “must close”)

These were the leftover ship-gate set. All six are closed in source.

| ID | Audit hole | In-tree close |
| --- | --- | --- |
| **PAYMOB-FENCE-1** | Durable `reserveStoredIdempotencyRecord` deleted any row with expired `expiresAt`, including `unknown` / `in_progress`. After 24h an indeterminate refund/capture/void re-entered the mutation. | `isStoredIdempotencyReplayExpired` is `status === "completed"` **and** `expiresAt <= now` only. Reserve/get never `delete` expired `unknown` / `in_progress`. Expired `in_progress` is retained as `unknown`. |
| **PAYMOB-FENCE-2** | Caller abort after a mutating POST was `PaymentAbortedError`. `fetchPaymobMutation` only wrapped `NetworkError`. `executeIdempotent` then **deleted** the fence. | `fetchPaymobMutation` wraps `NetworkError` **and** `PaymentAbortedError` as `PaymobIndeterminateNetworkError`. Indeterminate catch keeps the local + durable fence. |
| **PAYMOB-FENCE-3** | Legacy Egypt create used `requireNumber` / `requireString` → `GatewayApiError` on HTTP 200 missing order id / payment token, which **released** the fence. Intention was already fixed. | Orders uses `requireMutationNumber` (`id`); Payment Keys uses `requireMutationString` (`token`). Missing HTTP-200 id/token → `PaymobIndeterminateResponseError`; fence kept. |
| **PAYPAL-IDEM-1** | `getRequestId("")` kept the empty string; `if (requestId)` skipped `PayPal-Request-Id`. In-process `withRetry` after timeout/5xx could double-mutate. | `getRequestId` trims; empty / whitespace / omitted mint `runtime.randomUUID()`. `createJsonHeaders` **always** sets `PayPal-Request-Id`. |
| **PAYPAL-DW-1** | `PAYMENT.CAPTURE.REFUNDED` domain status is fail-closed `partially_refunded`, but static map still dual-wrote `refund.completed`. Demote only ran for `status === "refund_completed"`. | After attach, `demoteIncompleteRefundWebhookDualWrite` rematches **both** `status === "refund_completed"` **and** `type === PAYMENT.CAPTURE.REFUNDED && status === "partially_refunded"` off `refund.completed` → `refund.pending`. Proven `refunded` stays `refund.completed`. |
| **WEBHOOKS-403** | `InvalidWebhookError` is always HTTP **403**. Parse-stage then hit `isPermanentClientHttpStatus(403)`. `processWithVerifier` + `parseWebhookEvent` could drop a signature-valid paid body as non-retryable. | `isPermanentNonRetryableVerifyError` excludes non-verify `InvalidWebhookError` before the 4xx fall-through. Parse-stage / unknown InvalidWebhook → `handler_failed { retryable: true }`. Forgery stays verify-false only. `handleWebhook` still rewrites parse to `InvalidRequestError`. |

### Closed — other P1 (not still money lies)

| ID | In-tree close |
| --- | --- |
| **STRIPE-CKO-1** | `checkout.session.completed` (`payment_status: paid`) and `async_payment_succeeded` run `stripeCheckoutPaidSessionStatus`. Hydrated PI/charge rematches refunds; missing charge snapshot → `processing`; rematch dual-write `payment.succeeded` + refunded → `refund.completed`. Classic **unhydrated** string `payment_intent` still stays `paid` (documented). |
| **STRIPE-CHG-1** | `stripeChargeSnapshotForRefundStatus` uses expanded `latest_charge`, then `charges.data[0]` when `latest_charge` is omitted. Unexpanded string id stays unobservable / `processing`. |
| **CORE-INF-1** | `inferOperationOutcome`: `!success` + `paid` / `authorized` / `partially_captured` / `refunded` / `partially_refunded` → `indeterminate` (retry-as-failed cannot double-charge). |
| **CORE-INF-2** | `inferRefundOperationOutcome`: `!success` + `completed` → `indeterminate` (retry cannot double-refund). |
| **CORE-HW-1** | `handleWebhook` always rematches a complete v1 `payment.succeeded` arm against `processing` / `partially_captured` / `authorized` / `approved`. |
| **CORE-6-EXT** | `coerceStableSucceededToDomainStatus` remaps `authorized` / `approved` / `partially_captured` / `refunded` / `partially_refunded` → `payment.processing`. |
| **PAYPAL-ID-1** | Webhook `gatewayPaymentId` prefers `selectSingleRefundableCaptureId` (still-held sibling) over last / `related_ids.capture_id`; >1 refundable keeps order id. |
| **PAYMOB-TOCTOU** | Store without `reserve()` throws `InvalidRequestError`. No get-then-set fallthrough. |
| **RECON-LEASE-1** | `reconciliationFailTemplates` / `markManualReview` match `lease_token` + `status = claimed` only (no `lease_expires_at > now`). Scheduler hang budget + `failAndReschedule` after overrun so `maxAttempts` can dead-letter. `complete` stays unexpired-only. |
| **WH-LIST-FAIL** | Outer `UPDATE … WHERE status = 'claimed'` (SQL-UPD-1). Engine: fail after `listRetryable` wiped token → `lease_lost` → best-effort reclaim + `handler_failed { retryable: true }`, **never** `complete`. Soft-release of expired claimed is still required for poll recovery. Not a remaining money lie. |
| **MOYASAR-CAP-0** | `paid` + missing / non-finite / finite `0` `captured` → `processing` on map + webhook money snapshot. |
| **PAYMOB-AUTH-REDIR** | `TRANSACTION_RESPONSE` + `authorized` / `is_auth` demotes to `payment.processing`. Processed `TRANSACTION` still publishes `payment.authorized`. |

### Closed — P2 pack (not residual)

| ID | Close |
| --- | --- |
| **MOYASAR-3** | `moyasarSource` / `CreditCardSource` JSDoc state backend `createPayment` **rejects** raw `creditcard`. |
| **SQL-UPD-1** | Expired-claim `UPDATE` re-checks `status = 'claimed'` in the outer `WHERE` (postgres / sqlite / d1 / turso / do). |
| **PERF-3** | sql-foundation v2 `CREATE INDEX IF NOT EXISTS` composites; D1 Wrangler `0002_list_indexes.sql`. Applied v1 not rewritten. |
| **PERF-4** | Redis poll is ZRANGE + one `Promise.all` wave of keyed Lua GETs. SCAN stays off the list path. |
| **REDIS-CLEAN-1** | `deleteExpired` default `limit` is `1000` (`DEFAULT_DELETE_EXPIRED_LIMIT`). Explicit higher allowed. |

Historical first-pass IDs stay already closed: WEBHOOKS-1, CORE-1/2/3/4, STRIPE-1/2, PAYPAL-1/3, PAYMOB-2, MONEY-1, REDIS-1, RECON-1/2/3, PERF-1/2, OBS-1/2, TESTKIT-1/2/3/4, PKG-1. Disputed list is empty.

### Remaining — non-blocking residual P2

Not money-integrity ship blockers. Documented leftovers.

| ID | Residual |
| --- | --- |
| **PERF-5** | DO hash `listDue` / `listRetryable` still fans out to every enumerable isolate at full `limit` (`store-durable-objects/src/client.ts` `fanOutListByKey`). Per-shard UPDATE is bounded (PERF-2). No cheaper correct global earliest-N without a cross-isolate index. |
| **PERF-6** | Webhook path still parse / redact / stringify / SHA-256 / deep-clone large Stripe bodies more than once. Unowned for a code change this pass (`stripe.gateway.ts` is stream A; infer stream must not edit it). |
| **PERF-7** | `processDue` / `processRetryable` stay list-then-serial-claim (list is discovery; claim is the fence). Oversample still capped at **200** when `maxInFlightByGateway` is set; default 10 stays 10. |

---

## P1 blocking — re-read in source

### PAYMOB-FENCE-1 — CLOSED (expired unknown / in_progress is not a free key)

**Audit hole:** `reserveStoredIdempotencyRecord` deleted any durable row with expired `expiresAt`, including fences stamped `unknown` / `in_progress` after an indeterminate mutation (`expiresAt: now+24h`). After 24h the same key re-entered the mutation (double-apply). In-memory prune already kept those statuses.

**Current code** (`paymob.gateway.ts`):

- `isStoredIdempotencyReplayExpired` is `status === "completed" && expiresAt <= now` only (~3141–3149).
- `reserveStoredIdempotencyRecord` deletes and re-reserves **only** expired `completed` rows (~3102–3113). Expired `unknown` / `in_progress` are retained.
- `getStoredIdempotencyRecord` never `delete`s expired non-completed rows (~3131–3134).
- Expired `in_progress` is rewritten to `unknown` (`retainStoredIdempotencyFence`, ~3156–3169).

**Tests that would have failed the audit:** `paymob.gateway.test.ts` — expired durable unknown refuses re-reserve; expired durable `in_progress` is treated as `unknown` and is not re-reserved.

### PAYMOB-FENCE-2 — CLOSED (caller abort after POST keeps the fence)

**Audit hole:** caller abort after a mutating POST became `PaymentAbortedError`. `fetchPaymobMutation` only wrapped `NetworkError`. `executeIdempotent` then **deleted** the fence. Timeout on the same body-read was already indeterminate.

**Current code:**

- `fetchPaymobMutation` wraps **both** `NetworkError` and `PaymentAbortedError` as `PaymobIndeterminateNetworkError` (~2883–2899).
- `mapHttpAbortError` still maps caller abort to `PaymentAbortedError`; that type no longer reaches `executeIdempotent` as a retryable delete.
- Indeterminate catch keeps the local + durable fence (~3014–3030).

**Tests:** abort after Intention POST and after refund POST keep the fence.

### PAYMOB-FENCE-3 — CLOSED (legacy Egypt HTTP 200 missing id/token keeps the fence)

**Audit hole:** Intention already used mutation helpers. Legacy Egypt Orders / Payment Keys still used `requireNumber` / `requireString` → `GatewayApiError` on HTTP 200 missing order id / payment token, which released the fence.

**Current code:**

- Orders: `requireMutationNumber` for `id` (~685–690).
- Payment Keys: `requireMutationString` for `token` (~728–733).
- Missing HTTP-200 id/token throws `PaymobIndeterminateResponseError` (keeps fence), not `GatewayApiError`.
- Bare `requireNumber` / `requireString` remain only on inquiry / HMAC / currency (not post-mutation create).

**Tests:** missing token / missing order id keep the fence.

### PAYPAL-IDEM-1 — CLOSED (empty key still sends PayPal-Request-Id)

**Audit hole:** `getRequestId("")` kept `""`; `if (requestId)` skipped the header. In-process `withRetry` after timeout/5xx could double-mutate. Stripe already trimmed empty keys and always generated.

**Current code** (`paypal.gateway.ts`):

- `getRequestId` trims; empty / whitespace / omitted mint `runtime.randomUUID()` (~1905–1924).
- `createJsonHeaders` **always** sets `PayPal-Request-Id` (~1880–1890). Empty string is not left as `""` for `if (requestId)` to skip.

**Tests:** empty / whitespace key still generates and the header is sent.

### PAYPAL-DW-1 — CLOSED on the product path

**Audit hole:** `PAYMENT.CAPTURE.REFUNDED` domain status is fail-closed `partially_refunded`, but the static map dual-wrote `refund.completed`. Demote only ran for `status === "refund_completed"`. Type-only handlers could close the capture as fully refunded.

**Current code:**

- `mapWebhookStatus` still fail-closes refund-shaped `PAYMENT.CAPTURE.REFUNDED` to `partially_refunded` (~2931–2947).
- After `attachPaymentEvent`, `demoteIncompleteRefundWebhookDualWrite` rematches **both** `status === "refund_completed"` **and** `type === PAYMENT.CAPTURE.REFUNDED && status === "partially_refunded"` off `refund.completed` → `refund.pending` (~3341–3369).
- Proven `refunded` stays `refund.completed`.

**Tests:** refund-resource COMPLETED is not type-only `refund.completed`.

**Residual (non-blocking):** static `PAYPAL_EVENT_TYPE_MAP` still names `refund.completed` without status (`webhook-event-map.ts` ~305). Type-only handlers that only call the mapper with no status still see that name; `parseWebhookEvent` rematch is what dual-write consumers get.

### WEBHOOKS-403 — CLOSED (parse-stage 403 is retryable)

**Audit hole:** `InvalidWebhookError` is always constructed with HTTP **403**. Parse-stage messages skipped *forgery* but then hit `isPermanentClientHttpStatus(403)`. `processWithVerifier` + `parseWebhookEvent` could drop a signature-valid paid body as non-retryable. `handleWebhook` was already safe (rewrites to `InvalidRequestError`).

**Current code:**

- `InvalidWebhookError` is still HTTP 403 (`errors.ts`).
- `isPermanentNonRetryableVerifyError` excludes non-verify `InvalidWebhookError` before the 4xx fall-through (`engine.ts` ~323–330).
- `classifyVerifyThrow` → `processWithVerifier` maps parse-stage / unknown InvalidWebhook to `handler_failed { retryable: true }` (~1272–1293).
- Forgery stays verify-false message only.

**Tests:** `engine.test.ts` WEBHOOKS-403 — core `InvalidWebhookError` parse messages stay retryable.

---

## Other P1 — re-grep evidence

| ID | Source evidence |
| --- | --- |
| **STRIPE-CKO-1** | `stripeCheckoutPaidSessionStatus` (~998–1036). `checkout.session.completed` paid arm and `async_payment_succeeded` both call it (~2379–2428). Hydrated refunds rematch; missing charge snapshot → `processing`. |
| **STRIPE-CHG-1** | `stripeChargeSnapshotForRefundStatus` (~877–891): expanded `latest_charge`, else `charges.data[0]`. Unexpanded string id returns `undefined` → `processing`. Tests lock omitted `latest_charge` + `charges.data` refunds as not `paid`. |
| **CORE-INF-1** | `inferOperationOutcome` (~330–352): `!success` + paid / authorized / partially_captured / refunded / partially_refunded → `indeterminate`. Test: `operation-result.test.ts` CORE-INF-1. |
| **CORE-INF-2** | `inferRefundOperationOutcome` (~1002–1014): `!success` + `completed` → `indeterminate`. |
| **CORE-HW-1** | `rematchSucceededWebhookDualWriteAgainstDomainStatus` (`client.ts` ~147–178) always applied after parse (~824–843). Tests rematch complete v1 `payment.succeeded` + processing / authorized. |
| **CORE-6-EXT** | `coerceStableSucceededToDomainStatus` (`webhook-event-map.ts` ~584–606) remaps authorized / approved / partially_captured / refunded / partially_refunded → `payment.processing`. Test: `payment-event.test.ts` CORE-6-EXT. |
| **PAYPAL-ID-1** | Webhook `gatewayPaymentId` prefers `selectSingleRefundableCaptureId` (~1276–1287, ~3178–3186). Tests: last/related REFUNDED + one held sibling uses held capture; two held siblings keep order id. |
| **PAYMOB-TOCTOU** | Store without `reserve()` throws `InvalidRequestError` (~3086–3095). Test: store lacking `reserve()` on mutations. |
| **RECON-LEASE-1** | Fail / markManualReview templates match `lease_token` + `status = 'claimed'` only (`templates.ts` ~847–877, ~921–931). Scheduler hang budget + `failAndReschedule` (`scheduler.ts` ~154–168, ~424–459). Tests: store fail-after-expiry; hang/lease_lost still budgets. |
| **WH-LIST-FAIL** | Engine fail after wipe is `lease_lost` → best-effort reclaim + retryable `handler_failed`, never `complete` (`engine.ts` ~929–959). Test: `engine.test.ts` “WH-LIST-FAIL fail after listRetryable soft-release”. |
| **MOYASAR-CAP-0** | Map (~1342–1349) and webhook snapshot (~1792–1803): `paid` + missing / non-finite / `captured <= 0` → `processing`. Tests on getPayment + `payment_paid` / `payment_captured`. |
| **PAYMOB-AUTH-REDIR** | `PAYMOB_REDIRECT_DEMOTE_STABLE` includes `payment.authorized` (`webhook-event-map.ts` ~365–368). Redirect + mapped authorized demotes to `payment.processing` (~561–567). Test: `payment-event.test.ts` PAYMOB-AUTH-REDIR. |

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

```json
{
  "final_pass": true,
  "typecheck_ok": true,
  "tests_ok": true,
  "invariants_ok": true,
  "gate_pass": true,
  "implement_ok": 10,
  "implement_fail": 0,
  "blocking": [],
  "non_blocking": ["PERF-5", "PERF-6", "PERF-7"],
  "audit": "docs/audits/session-audit-2026-08-16.md",
  "summary": "PASS. Session-audit fence/idempotency/403/money-lie IDs are closed in source (PAYMOB-FENCE-1/2/3, PAYPAL-IDEM-1, PAYPAL-DW-1, WEBHOOKS-403, STRIPE-CKO/CHG, CORE-INF/HW/6-EXT, PAYPAL-ID-1, PAYMOB-TOCTOU, RECON-LEASE-1, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR). Typecheck green; 2708 pass / 35 skip / 0 fail. Residual PERF-5/6/7 only."
}
```
