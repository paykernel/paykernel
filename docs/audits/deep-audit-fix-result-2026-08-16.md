# PayKernel 2026-08-16 deep-audit fix-gate result

**Date:** 2026-08-16  
**Original audit:** [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md)  
**Fix-pass bookkeeping:** [`deep-audit-fix-pass-2026-08-16.md`](./deep-audit-fix-pass-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-audit-fix-gate.rhai`  
**Reviewer stance:** fail-closed. Implement summaries were **not** trusted. Residual P0/P1 paths were re-grepped in source.  
**Working tree:** uncommitted fix-stream diffs. Not a release commit.

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
summary=PASS. Ship-gate WEBHOOKS-1/CORE-1/STRIPE-1/STRIPE-2/PAYPAL-1/PAYPAL-3/PAYMOB-2 closed in source; remaining P1s are not still money lies. Typecheck green; 2611 pass / 35 skip / 0 fail. Residual P2: PERF-5/6/7, MOYASAR-3.
blocking:
non_blocking:
- PERF-5
- PERF-6
- PERF-7
- MOYASAR-3
```

---

## Verify

```
VERIFY: typecheck_ok=true tests_ok=true invariants_ok=true ok=true
tests=2611 pass / 35 skip / 0 fail / 154 files
```

- `bun run typecheck`: all 15 workspace packages exit 0.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso`: **2611 pass, 0 fail**. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3). Isolated bun:sqlite multi-connection WAL flake did **not** fire.

Ship-gate invariants (audit items 1–7) hold in source and in tests that would have failed the audit.

---

## Implement

Ten parallel streams (`fix:stripe`, `fix:paypal`, `fix:paymob`, `fix:moyasar`, `fix:webhooks`, `fix:stores-perf`, `fix:core-money`, `fix:recon-routing`, `fix:testkit-obs`, `fix:docs-audit`) plus integrate. **ok=10 fail=0**. No remediating gate cycle.

---

## What was fixed vs remaining

### Closed — ship gate (P0 + P1 blocking)

These were the audit `SHIP_BLOCKED` set. All seven are closed in source.

| ID | Audit hole | In-tree close |
| --- | --- | --- |
| **WEBHOOKS-1** (P0) | Inbox key `paymob:<txnId>` completed on documented redirect `payment.processing`; later paid `TRANSACTION` ACK-suppressed as `duplicate_completed` | Redirect `event.id` is `{txnId}:redirect`; processed keeps raw txn id; engine qualifies `paymob:{TRANSACTION\|TRANSACTION_RESPONSE}:{id}` |
| **CORE-1** | `inferRefundOperationOutcome` forged `failed` on `success:false` + `pending` → retry could double-refund | P610-INF-2: `!success` (or omitted) + `pending`/`processing`/`approved` → `indeterminate` |
| **STRIPE-1** | `refund.failed` / `pending` / `canceled` overwrote **payment** status | Maps to `refund_failed` / `refund_pending` |
| **STRIPE-2** | `payment_intent.succeeded` ignored charge refunds and dual-wrote `paid` after money returned | Reads `amount_refunded` / `refunded`; unexpanded `latest_charge` id → `processing` |
| **PAYPAL-1** | `PAYMENT.CAPTURE.REFUNDED` fail-opened full `refunded` on refund-shaped resources | Refund-resource / unknown status fail-closes to `partially_refunded`; omits this-op face |
| **PAYPAL-3** | `ORDER.COMPLETED` invented `paid` from `related_ids.capture_id` | Nested captures only; capture-id string → `processing` |
| **PAYMOB-2** | Intention HTTP 200 missing id / checkout URL released the create fence | `requireMutationString` → `PaymobIndeterminateResponseError`; fence kept |

### Closed — remaining P1s (not still money lies)

Audit ranked these residual / custom / recovery / perf. Re-grepped. **None remain as the audited money lie.**

| ID | Close |
| --- | --- |
| **CORE-2** | After-hooks restore money/identity from `freezeOriginal` between composed handlers |
| **CORE-3** | `handleWebhook` awaits a thenable from `verifyWebhook`; requires `=== true` |
| **CORE-4** | Thin 3-field `PaymentEvent` fails `isPaymentEvent`; handleWebhook rebuilds + demotes |
| **MONEY-1** | `JMD` / `XCG` / `XAD` in `TWO_DECIMAL_CURRENCIES` |
| **PAYMOB-1** | `is_refund` / `is_void` kept when current-state is present-and-false; HMAC `has_parent_transaction` used |
| **WEBHOOKS-2** | Missing / unrefusable durable snapshot → `handler_failed { retryable: true }`, not `invalid_webhook` |
| **WEBHOOKS-3** | Parse `InvalidWebhookError` is retryable; forgery class is verify-failure messages only |
| **WEBHOOKS-4** | Inline persists `payloadRef` when materializable; missing ref on redrive is retryable (`restoreAttempt`), not dead-letter |
| **REDIS-1** | Renew `ZADD`s due/retry ZSET at the new `lease_expires_ms` |
| **RECON-1** | Auth-hold + `capturedAmount=0` vs `local.amount` is not drift |
| **RECON-2** | Incremental capture / unaccounted totals refuse `mark_consistent` |
| **RECON-3** | `retry_later` does not consume `maxAttempts` dead-letter budget |
| **PERF-1** | `listDue` / `listRetryable` are ZRANGE + keyed GET; SCAN is repair-only |
| **PERF-2** | SQL expired-lease UPDATE is `WHERE key IN (SELECT … LIMIT $limit)` |

### Closed — P2 pack (not residual)

CORE-5/6/7/8, MONEY-2/3, PAYPAL-2, PAYMOB-3/4, MOYASAR-1/2, WEBHOOKS-5, SQLFOUND-1, RECON-4, ROUTE-1 (intentional fail-closed, documented), TESTKIT-1/2/3/4, OBS-1/2, PKG-1, PERF-3/4. PERF-7 oversample cap is 200 (was up to 1000) when `maxInFlightByGateway` is set.

Historical PP0–ST1 stay already fixed. Disputed list is empty.

### Remaining — non-blocking residual P2

Not money-integrity ship blockers. Documented leftovers.

| ID | Residual |
| --- | --- |
| **PERF-5** | DO hash `listDue` / `listRetryable` still fans out to every enumerable isolate (`store-durable-objects/src/client.ts`). Per-shard UPDATE is bounded (PERF-2). No cheaper correct global earliest-`limit` without a cross-isolate index. |
| **PERF-6** | Webhook path still parse / clone / stringify / SHA-256s large Stripe bodies more than once. |
| **PERF-7** | `processDue` / `processRetryable` still list-then-serial-claim N+1. Oversample reduced (3× / +16, cap 200) when `maxInFlightByGateway` is set; default 10 stays 10. |
| **MOYASAR-3** | Adapter + `moyasar.md` reject raw `creditcard` before HTTP. Generic `CreatePaymentParams.moyasarSource` JSDoc in `payment.types.ts` still says “Supports: creditcard, …”. Type-checks then fail-closed; no card-data leak. |

---

## P0 / P1 blocking — re-read in source

### WEBHOOKS-1 — CLOSED (not still the same inbox key)

**Audit hole:** Paymob redirect `TRANSACTION_RESPONSE` and processed `TRANSACTION` both set `WebhookEvent.id` to the raw txn id. Inbox key `paymob:<txnId>` completed on documented `payment.processing`, so later paid was `duplicate_completed`.

**Current code:**

- Redirect `event.id` is `${txnId}:redirect`; processed `TRANSACTION` keeps the raw txn id. `gatewayPaymentId` stays the signed txn id on both (`paymob.gateway.ts` `paymobWebhookEventId`, `parseRedirectWebhookEvent`, processed parse).
- Engine `deriveWebhookEventKey(paymob, id, notificationClass)` qualifies as `paymob:{TRANSACTION|TRANSACTION_RESPONSE}:{txnId}` (`event-key.ts`). A `{txnId}:redirect` suffix is stripped and treated as `TRANSACTION_RESPONSE` so `event.id` alone and `event.id` + class share one inbox row.
- `extractInboxNotificationClass` prefers `provider.eventType` then `event.type`.

**Tests that would have failed the audit:** `engine.test.ts` “WEBHOOKS-1 Paymob redirect then processed is not duplicate_completed” — processed is `processed`, not `duplicate_completed`. `paymob.gateway.test.ts` asserts redirect `id === "123456789:redirect"`. `event-key.test.ts` asserts class-qualified keys differ.

**Residual (not a money lie on the documented path):** a caller who keys **only** `gatewayPaymentId` and **omits** `event` / notification class still collides. Docs (`webhooks.md`, README) now forbid raw `event.id` alone and require class or the qualified id.

### CORE-1 — CLOSED (uncertain refund pending is not `failed`)

`inferRefundOperationOutcome` (`operation-result.ts`): `success:false` or omitted success + `pending` / `processing` / `approved` → `indeterminate`, not `failed`. Explicit `outcome` is still coerced against gateway status.

**Test:** `operation-result.test.ts` “P610-INF-2 / CORE-1” asserts `success:false` + `pending` and omitted success + `pending` are `indeterminate`, and `mapGatewayRefundToOperationResult` sets `reconciliationRequired`.

**Residual (not the audit hole):** explicit `outcome: "failed"` + `status: "pending"` stays `failed` via coerce (same family as payment infer when outcome is set). The forged-from-bare-`!success` path is gone.

### STRIPE-1 — CLOSED (refund entity status, not payment failed)

`mapStripeRefundWebhookStatus`: Stripe refund `failed` / `canceled` → domain `refund_failed`; other in-flight → `refund_pending`. `refund.failed` event type hard-maps to `refund_failed` (`stripe.gateway.ts`).

**Tests:** `refund.failed` / `refund.updated` canceled / pending cases assert `refund_failed` / `refund_pending` and not payment `failed` / `pending`.

### STRIPE-2 — CLOSED (succeeded PI reads charge refunds; unexpanded fail-closes)

`succeededPaymentIntentWebhookStatus`: unexpanded `latest_charge` string → `processing`; expanded charge `amount_refunded > 0` / `refunded: true` → `refunded` / `partially_refunded`; missing settled totals → `processing`. Dual-write on refunded snapshots is `refund.completed`, not `payment.succeeded`.

**Tests:** “STRIPE-2: payment_intent.succeeded with amount_refunded is not paid” plus partial-refund / unexpanded-charge cases.

**Residual (not the audit hole):** if `latest_charge` is **omitted** (not an unexpanded id) and refunds live only on `charges.data[0]`, webhook settled math can still reach `paid`. Thin-event hydration (the documented trap) leaves `latest_charge` as a string id and is fail-closed.

### PAYPAL-1 — CLOSED (no fail-open full `refunded`)

`mapWebhookStatus('PAYMENT.CAPTURE.REFUNDED')` only returns full `refunded` / `partially_refunded` when the **capture** resource status maps that way. Refund-shaped `COMPLETED` (and missing/unknown status) fail-closes to `partially_refunded`. `extractSingleCaptureWebhookHeldAmount` returns `null` for `resource_type=refund` so this-op face is omitted.

**Test:** “CAPTURE.REFUNDED refund-resource COMPLETED partial amount is not full refunded” — status `partially_refunded`, amount omitted.

### PAYPAL-3 — CLOSED (capture id string is not settlement)

`ORDER.COMPLETED` `hasCapture` is `Boolean(lastOrderCapture)` from nested `purchase_units[].payments.captures` only. `related_ids.capture_id` is identity (`extractWebhookCaptureId`), not a synthesized `COMPLETED` capture. Absent nested captures → `mapPaymentResultStatus` refuses order `COMPLETED` → `paid` and returns `processing`.

**Tests:** supplementary `capture_id` only, and dedicated PAYPAL-3 case, assert `status === "processing"`, `isPaidOutcome === false`.

### PAYMOB-2 — CLOSED (Intention 200 missing id/URL keeps fence)

`createPaymentViaIntention` uses `requireMutationString` for `data.id` and checkout URL. That throws `PaymobIndeterminateResponseError`. `executeIdempotent` keeps the in-memory + stored fence for `isPaymobIndeterminateError` (does **not** delete the key).

**Tests:** empty `{}` body and `{ id }` without checkout URL → first result `indeterminate`; retry same `idempotencyKey` throws `InvalidRequestError`; `fetchCalls.length === 1`.

---

## Remaining P1s — still money lies?

These were residual / custom / recovery / perf. Re-grepped. **None remain as the audited money lie.**

| ID | Status | Evidence |
| --- | ------ | -------- |
| **CORE-2** | closed | `hooks.manager.ts` restores money/identity from `freezeOriginal` between composed after-hooks and `onAfter` (`restoreMoneyIdentityFields`). Later handlers cannot see a forged paid/status/amount. |
| **CORE-3** | closed | `client.ts` `handleWebhook` awaits `verifyWebhookAsync` **or** a thenable from sync `verifyWebhook`, then requires `isVerified === true`. A Promise is not truthy-verified. |
| **CORE-4** | closed | `isPaymentEvent` now requires complete `ProviderEventMetadata` + the type’s entity arm. A 3-field `{schemaVersion, type, provider:{}}` is not trusted; handleWebhook rebuilds + demotes. |
| **PAYMOB-1** | closed | `sanitizeWebhookTransactionForStatus` keeps `is_refund` / `is_void` when current-state is present-and-false. `mapTransactionStatus` uses HMAC `has_parent_transaction` + action flags. Test no longer locks `paid`. |
| **WEBHOOKS-2** | closed | Missing / unrefusable durable snapshot → `handler_failed { retryable: true }`, not `invalid_webhook`. |
| **WEBHOOKS-3** | closed | `isForgeryClassVerifyError` is verify-failure messages only. Parse `InvalidWebhookError` (Paymob / Moyasar / “parse failed”) is retryable. Unknown `InvalidWebhookError` fail-opens retryable. |
| **WEBHOOKS-4** | closed | Inline `processVerified` persists `payloadRef` when materializable. `processRetryable` on missing payload fails **retryable** with `restoreAttempt` — does not dead-letter. |
| **REDIS-1** | closed | `WEBHOOK_RENEW_LUA` / `RECON_RENEW_LUA` `ZADD` the retry/due index at the new `lease_expires_ms`. JS passes `[record, indexKey]`. |
| **RECON-1** | closed | `compareSnapshots` treats auth-hold + `capturedAmount=0` vs `local.amount` as consistent, not drift. |
| **RECON-2** | closed | Auth-hold incremental capture emits `capturedAmount` drift. Policy `providerAuthOrPartialWithUnaccountedTotals` refuses `mark_consistent` on authorized / partial + unaccounted capture/refund totals. |
| **RECON-3** | closed | `processDue` skips `maxAttempts` dead-letter when disposition is `retry_later`. |
| **MONEY-1** | closed | `TWO_DECIMAL_CURRENCIES` includes `JMD`, `XCG`, `XAD`. |
| **PERF-1** | closed (not a money lie) | `listDue` / `listRetryable` are ZRANGEBYSCORE + keyed GET. SCAN is repair-only (`softReleaseExpiredClaimedViaScan`). |
| **PERF-2** | closed (not a money lie) | SQL expired-lease UPDATE is `WHERE key IN (SELECT … LIMIT $limit)`. |

None of the remaining P1s are listed **blocking**. They are not still false-paid / double-refund / ACK-suppressed paid on built-in default paths.

---

## Invariant greps (this report)

Re-checked against current tree. Do not invent closures not present.

| ID | Grep / read that holds |
| --- | --- |
| WEBHOOKS-1 | `paymobWebhookEventId` → `` `${providerTxnId}:redirect` ``; `deriveWebhookEventKey("paymob", "123456789", "TRANSACTION_RESPONSE")` ≠ `TRANSACTION`; engine test not `duplicate_completed` |
| CORE-1 | `inferRefundOperationOutcome` returns `"indeterminate"` on `!result.success` + `pending`/`processing`/`approved` |
| STRIPE-1 | `mapStripeRefundWebhookStatus`: `failed`/`canceled` → `"refund_failed"`; else `"refund_pending"` |
| STRIPE-2 | `succeededPaymentIntentWebhookStatus` fail-closes unexpanded `latest_charge` to `"processing"`; `stripeSucceededIntentRefundStatus` reads `amount_refunded` / `refunded` |
| PAYPAL-1 | `PAYMENT.CAPTURE.REFUNDED` default return is `"partially_refunded"`, not `"refunded"`; refund resource held-amount is `null` |
| PAYPAL-3 | `hasCapture: Boolean(lastOrderCapture)` from nested captures only; comment + `mapPaymentResultStatus` refuse invented COMPLETED capture |
| PAYMOB-2 | Intention `requireMutationString` throws `PaymobIndeterminateResponseError` |
| CORE-2 | `restoreMoneyIdentityFields(freezeOriginal, …)` between composed after-hooks |
| CORE-3 | `isThenable` + `isVerified !== true` |
| CORE-4 | `isPaymentEvent` requires provider metadata + entity arm |
| PAYMOB-1 | delete `is_refund`/`is_void` only when current-state `=== true`; `childAction` uses `has_parent_transaction` |
| WEBHOOKS-2 | `!snap.ok` / missing `payloadRef` on ack-after-claim → `outcomeHandlerFailed(true)` |
| WEBHOOKS-3 | parse-stage `InvalidWebhookError` excluded from `isForgeryClassVerifyError` |
| WEBHOOKS-4 | inline stores `payloadRef`; missing redrive uses `restoreAttempt: true` |
| REDIS-1 | renew Lua `ZADD` at `leaseExpiresMs` |
| RECON-1/2/3 | compare/policy/scheduler tests + `retry_later` skip attempt budget |
| MONEY-1 | `JMD`, `XCG`, `XAD` in ISO table |
| PERF-1/2 | Redis poll tests assert no SCAN; postgres UPDATE `LIMIT $2` |

---

## Adjacent notes (not new blocking IDs)

- **WEBHOOKS-1 integrator misuse:** `gatewayPaymentId`-only inbox keys without `event` still collide. Fixed identity is `event.id` and/or `deriveWebhookEventKey(..., notificationClass)`.
- **STRIPE-2 adjacent:** `charges.data[0].amount_refunded` is not read when `latest_charge` is omitted entirely. The audited thin-event (unexpanded id) and expanded-charge cases are closed.
- **PAYPAL-1 conservatism:** refund-resource CAPTURE.REFUNDED is `partially_refunded` (omit amount), not remaining-held rewrite. Fail-closed, not fail-open full `refunded`.

---

```json
{
  "final_pass": true,
  "typecheck_ok": true,
  "tests_ok": true,
  "invariants_ok": true,
  "gate_pass": true,
  "implement_ok": 10,
  "implement_fail": 0,
  "pass": true,
  "blocking": [],
  "non_blocking": [
    "PERF-5",
    "PERF-6",
    "PERF-7",
    "MOYASAR-3"
  ],
  "summary": "PASS. Ship-gate WEBHOOKS-1/CORE-1/STRIPE-1/STRIPE-2/PAYPAL-1/PAYPAL-3/PAYMOB-2 closed in source; remaining P1s are not still money lies. Typecheck green; 2611 pass / 35 skip / 0 fail. Residual P2: PERF-5/6/7, MOYASAR-3.",
  "report_path": "docs/audits/deep-audit-fix-result-2026-08-16.md"
}
```
