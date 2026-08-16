# PayKernel Deep Audit (2026-08-16)

**Scope:** packages/core, webhooks, store-*, reconciliation, routing, testkit, observability, sql-foundation  
**Baseline:** typecheck green (15 workspace packages); 1785 tests / 0 failures / 69 files (8.73s)  
**Verdict:** **SHIP_BLOCKED**

---

## Verdict

Ship is blocked by **WEBHOOKS-1** (confirmed P0, money-security). The documented inbox / dedupe key is `WebhookEvent.id`. Paymob sets that id to the same transaction id on redirect `TRANSACTION_RESPONSE` (`payment.processing`) and processed `TRANSACTION` (`payment.succeeded`). A normal handler return on the documented redirect completes `paymob:<txnId>`, so the later paid (or any later snapshot on that id) is ACK-suppressed as `duplicate_completed` and fulfillment never runs.

Blocking P1s are production money / status lies, not residual/custom/recovery/perf:

| ID | Class | Why it blocks ship |
| --- | --- | --- |
| WEBHOOKS-1 | P0 | Inbox key is shared Paymob txn id; processing ACK swallows later paid |
| CORE-1 | P1 | Uncertain refund pending is forged `failed` → retry can double-refund |
| STRIPE-1 | P1 | `refund.failed` / `pending` / `canceled` overwrite payment status |
| STRIPE-2 | P1 | `payment_intent.succeeded` ignores charge refunds; dual-writes paid |
| PAYPAL-1 | P1 | `PAYMENT.CAPTURE.REFUNDED` fail-opens full `refunded` on refund-shaped resources |
| PAYPAL-3 | P1 | `ORDER.COMPLETED` invents paid from `related_ids.capture_id` |
| PAYMOB-2 | P1 | Intention HTTP 200 with missing id / checkout URL releases the create fence |

Remaining P1s (CORE-2/3/4, MONEY-1, PAYMOB-1, WEBHOOKS-2/3/4, REDIS-1, RECON-1/2/3, PERF-1/2) are confirmed residual / custom / recovery / perf holes, not disputed. Historical PP0–ST1 are not re-found in original form.

**PAYMOB-1 is not a confirmed live default payload.** Official Paymob refund/void bodies use `is_refunded: true` / `is_voided: true`. The child-flag fail-open (`is_refund`/`is_void` true + current-state false) is a real mapping hole and is ranked **P1 residual**, not P0.

```
GATE
pass=false
summary=SHIP_BLOCKED. WEBHOOKS-1 confirmed P0: documented inbox/dedupe key is WebhookEvent.id; Paymob uses the same txn id on redirect TRANSACTION_RESPONSE (payment.processing) and processed TRANSACTION (payment.succeeded); handler return completes the key so later paid is ACK-suppressed. Blocking P1s are production money/status lies: refund pending forged failed (double-refund), Stripe refund.* overwriting payment status, PI.succeeded ignoring charge refunds, PayPal CAPTURE.REFUNDED fail-open full refunded, ORDER.COMPLETED inventing paid from related_ids.capture_id, Paymob 200 validation releasing the create fence. Remaining P1s confirmed as residual/custom/recovery/perf, not disputed. Historical PP0–ST1 not re-found in original form.
blocking:
- WEBHOOKS-1
- CORE-1
- STRIPE-1
- STRIPE-2
- PAYPAL-1
- PAYPAL-3
- PAYMOB-2
non_blocking:
- CORE-2
- CORE-3
- CORE-4
- MONEY-1
- PAYMOB-1
- WEBHOOKS-2
- WEBHOOKS-3
- WEBHOOKS-4
- REDIS-1
- RECON-1
- RECON-2
- RECON-3
- PERF-1
- PERF-2
disputed:
```

---

## Baseline (typecheck/tests)

```
VERIFY: typecheck_ok=true tests_ok=true ok=true
```

- Monorepo typecheck passed for all **15** workspace packages.
- Requested test suite passed: **1785 tests, 0 failures, 69 files in 8.73s**.

Green tests do **not** cover the blocking holes. Several suites lock the current (wrong) behavior:

- Stripe tests never assert `refund.failed` status mapping; succeeded-PI tests expect `paid` when refund fields are absent (`stripe.gateway.test.ts` ~1239–1260, 1350–1375).
- PayPal tests cover `resource_type: capture` + `PARTIALLY_REFUNDED` / `REFUNDED` only; `ORDER.COMPLETED` + `related_ids.capture_id` asserts `gatewayPaymentId`, not status.
- Paymob tests lock `is_refund:true` + `is_refunded:false` → `paid` (`paymob.gateway.test.ts` ~2727–2741).
- Inbox tests treat `already_completed` + different hash as `duplicate_completed` (correct for Stripe-style replay; fatal for Paymob’s reused txn id).

---

## Blocking findings (P0 / confirmed money-security)

### P0 — WEBHOOKS-1 — Inbox key is Paymob txn id shared by redirect and processed TRANSACTION

**Evidence**

- `packages/core/src/gateways/paymob/paymob.gateway.ts:1242-1250` — processed `TRANSACTION` sets `id` / `gatewayPaymentId` to `String(obj.id)`.
- `packages/core/src/gateways/paymob/paymob.gateway.ts:1345-1350` — redirect `TRANSACTION_RESPONSE` sets `id` / `gatewayPaymentId` to `String(payload.id)`.
- Tests use the same value for both (`paymob.gateway.test.ts` ~156 and ~3273–3289, `123456789`).
- Docs tell integrators to inbox-dedupe on `event.id` and to no-op redirect (`packages/core/docs/webhook-events.md:212-217,277`; `packages/core/docs/paymob.md:215`; `packages/webhooks/README.md:55-59`; `packages/core/docs/webhooks.md:274-276`).
- `deriveWebhookEventKey` → `paymob:<txnId>`.
- `packages/webhooks/src/engine.ts:1111-1112` maps claim `already_completed` → `duplicate_completed` and does not re-run the handler.
- `packages/webhooks/src/store.ts:187-189` (and memory store `:196-198`) keep terminal rows terminal even when `payloadHash` differs.

**Impact**

A handler that returns normally on documented redirect `payment.processing` marks `paymob:<txnId>` completed. The later processed `TRANSACTION` with `payment.succeeded` — or a later void / refund snapshot on the same `obj.id` — is ACK’d as `duplicate_completed` (typical HTTP 200). Fulfillment never runs after a real paid callback.

This is a **false-success inbox ACK on a different notification**, not Stripe-style replay of the same immutable event.

---

### P1 blocking — CORE-1 — `inferRefundOperationOutcome` still forges `failed` on uncertain pending

**Evidence**

- `packages/core/src/types/operation-result.ts:329-345` maps payment `success:false` + `pending` / `processing` / `approved` → indeterminate (P610-INF-2).
- `packages/core/src/types/operation-result.ts:969-970` — `inferRefundOperationOutcome` treats any `!result.success` as `failed`, including `status: "pending"`.
- Docs (`operation-result.ts:780-782`, `docs/operation-results.md` Engineering Rule 3) say refunds follow the same post-submit rule.

**Impact**

A bare `{success:false, status:"pending"}` refund (or any adapter that omits `outcome` after an ambiguous API response) looks like a definitive failure. Callers retry the refund and can **double-refund**. Payments were explicitly fixed against this class of lie; refunds were not.

---

### P1 blocking — STRIPE-1 — `refund.failed` / `pending` / `canceled` overwrite payment status

**Evidence**

- `packages/core/src/gateways/stripe/stripe.gateway.ts:851-854` — `mapStripeRefundWebhookStatus` maps Stripe refund `failed` / `canceled` → domain `"failed"`, else `"pending"`.
- `:2231-2232` hardcodes `refund.failed` → `"failed"`.
- Domain already has `refund_failed` / `refund_pending` (`packages/core/src/types/payment.types.ts:60-64`).
- `behavioral-contracts.md:217`: `refund_failed` means the original capture may still be paid.
- PayPal already maps `PAYMENT.REFUND.FAILED` → `refund_failed` (`paypal.gateway.ts:2971`) and `PAYMENT.REFUND.PENDING` → `refund_pending` (`:2965`).
- Stripe Phase-7 failed/cancelled/refunded test (`stripe.gateway.test.ts:1612`) only covers `payment_intent.payment_failed`, `payment_intent.canceled`, and `charge.refunded`.

**Impact**

A failed or in-flight refund does not un-capture the charge. Status-only handlers that persist `event.status` onto the payment mark a still-captured charge `failed` or `pending`: false decline, retry / re-charge, or cancel fulfillment while funds remain collected. Dual-write **type** is correctly `refund.failed` / `refund.pending`; the lie is `WebhookEvent.status`.

---

### P1 blocking — STRIPE-2 — `payment_intent.succeeded` ignores charge refunds

**Evidence**

- `packages/core/src/gateways/stripe/stripe.gateway.ts:2676-2691` — `succeededPaymentIntentWebhookStatus` only compares `resolveStripeCapturedMinor` (`amount_received` → `amount_captured`) to authorized amount. It never reads `latest_charge.amount_refunded` or `refunded`.
- `parseWebhookEvent` uses that helper for `payment_intent.succeeded` (`:2090-2091`).
- `getPayment` already knows the trap (`:1591-1607`): Stripe keeps PI status `succeeded` after refunds and maps `amount_refunded > 0` to `refunded` / `partially_refunded`.
- `stripe.md:262` tells integrators to hydrate the current Stripe object for thin events.
- Tests lock the lie (`stripe.gateway.test.ts:1239-1260`, `1350-1375` expect `paid` when `amount_received`/`amount_captured` == `amount` with no refund fields). `getPayment` test `3713-3742` expects `refunded` for the same PI shape plus `amount_refunded`.

**Impact**

Stripe does not decrement `amount_received` on refund and leaves PI status `succeeded`. Default success-time snapshots are still correct. Documented thin-event hydration of the current PI (`latest_charge` usually an unexpanded id), or any succeeded PI snapshot whose expanded `latest_charge` already has refunds, dual-writes `status=paid` + `payment.succeeded` **after money was returned**. `getPayment` of the same id would return `refunded` / `partially_refunded`.

---

### P1 blocking — PAYPAL-1 — `PAYMENT.CAPTURE.REFUNDED` fail-opens to full `refunded`

**Evidence**

- `packages/core/src/gateways/paypal/paypal.gateway.ts:2921-2929` — `mapWebhookStatus('PAYMENT.CAPTURE.REFUNDED')` returns the mapped resource status only when it is already `partially_refunded` or `refunded`. Every other mapped status (including `COMPLETED` → `paid`) and a missing status default to `refunded`.
- `extractSingleCaptureWebhookHeldAmount` (`:2649-2655`) returns `undefined` for `resource_type === 'refund'`, so remaining-held rewrite never runs.
- `extractWebhookAmount` (`:2631-2632`) then publishes `resource.amount` (this-op refund face).
- Tests only cover `resource_type: 'capture'` + `PARTIALLY_REFUNDED` / `REFUNDED` (`paypal.gateway.test.ts:1332-1408`), never the common refund-resource shape (`resource_type: 'refund'`, `status: 'COMPLETED'`, amount = this-op).

**Impact**

A partial refund delivered as a refund resource (`status COMPLETED`, amount e.g. `5.00` of a `100.00` capture) is normalized to status `refunded` (full) with amount `5`. Merchants that close the order, restock, or write off remaining captured funds on `status === 'refunded'` / `stableType refund.completed` treat a slice refund as settlement of the whole capture.

---

### P1 blocking — PAYPAL-3 — `ORDER.COMPLETED` with only `related_ids.capture_id` invents paid

**Evidence**

- `packages/core/src/gateways/paypal/paypal.gateway.ts:1234-1249` — `parseWebhookEvent` synthesizes `captureForMap = { status: raw.resource.status ?? 'COMPLETED' }` when `extractWebhookCaptureId` finds `supplementary_data.related_ids.capture_id` but `purchase_units[].payments.captures` is absent.
- `mapPaymentResultStatus` (`:3036-3049`) then maps `COMPLETED` → `paid` with no `final_capture` and no capture resource.
- Test `paypal.gateway.test.ts:636-664` exercises this payload and only asserts `gatewayPaymentId`; it does not assert status.
- Bare `COMPLETED` without that id is correctly `processing` (`:987-1016`).

**Impact**

A capture id string is treated as settlement evidence. Callers using `CHECKOUT.ORDER.COMPLETED` + `isPaidOutcome` / `status === 'paid'` can fulfill without capture status, `final_capture`, or nested payments — the exact class of false paid the PayPal adapter comments say they refuse.

---

### P1 blocking — PAYMOB-2 — Intention HTTP 200 with missing id / checkout URL releases the create fence

**Evidence**

- `packages/core/src/gateways/paymob/paymob.gateway.ts:545-563` — `createPaymentViaIntention` uses `fetchPaymobMutation` then `requireString` for `data.id` and the checkout URL.
- `requireString` (`:3174-3179`) throws `GatewayApiError`, not `PaymobIndeterminateResponseError`.
- `executeIdempotent` (`:2959-2986`) only keeps the fence for `isPaymobIndeterminateError`. Other errors delete the in-memory key and the store record.
- Comment at `:2960` (“HTTP-200 body validation failures all fence”) is true only for capture / refund / void `requireMutationBoolean` (`:3204-3217`) and missing refund id (`:1036-1041`), not Intention.

**Impact**

A 200 with empty / malformed JSON (`parseJson` returns `{}`, `:2653-2658`) after Intention POST looks like a preflight failure. Retry with the same `idempotencyKey` creates a **second payable intention / checkout**. The customer can pay both if the first session is still open. Capture / refund already fence this class of 200.

---

## High findings (P1)

These are confirmed. They are residual, custom-adapter, recovery, or poll-stall holes — not ship-blocking money lies on the default built-in happy path, and not disputed.

### CORE-2 — After-hook composition forwards unfrozen money / identity to later handlers

**Evidence:** `packages/core/src/hooks/hooks.manager.ts:173-204,394-430` pass `first.modifiedResult` to the next after-hook / `onAfter` with no restore. `packages/core/src/gateways/base.gateway.ts:511-521` only calls `restoreMoneyIdentityFields` on the value returned to the client. Docs (`hooks.types.ts:90-97`, `hooks.md:92-117`) claim hooks cannot flip paid / status / amount; that freeze is return-path only.

**Impact:** A composed `afterCapture` / `afterCreatePayment` (constructor hook + `addHook`, or specific + `onAfter`) can show later handlers `success:true` / `status:paid` / forged amounts. Side-effecting after-hooks (fulfillment, ledger, analytics that debit) can over-ship or mis-book while the caller still receives the honest gateway result.

### CORE-3 — `handleWebhook` treats a Promise from sync `verifyWebhook` as verified

**Evidence:** `packages/core/src/client.ts:720-726` — if `verifyWebhookAsync` is absent, `isVerified = gw.verifyWebhook(...)` with no `await` and no boolean check. A Promise is truthy, so `if (!isVerified)` never fires. `PaymentGateway.verifyWebhook` is typed `boolean` (`gateway.interface.ts:78-82`) but a JS `async verifyWebhook` returns `Promise<boolean>`.

**Impact:** Custom / plugin adapters that implement `async verifyWebhook` (common when verification needs I/O) **fail-open**: unverified payloads are parsed and `onWebhookVerified` runs. That is webhook forgery → false fulfillment. Built-in Stripe / Moyasar / Paymob stay sync; PayPal uses `verifyWebhookAsync`.

### CORE-4 — `handleWebhook` safety-net accepts a 3-field `PaymentEvent` and skips incomplete-money demotes

**Evidence:** `packages/core/src/types/payment-event.ts:213-221` — `isPaymentEvent` only checks `schemaVersion === "1"`, `typeof type === "string"`, and `provider` is an object. `packages/core/src/client.ts:773-783` skips `attachPaymentEvent` + `demoteIncompleteSettledWebhookDualWrite` / `demoteIncompleteRefundWebhookDualWrite` when that guard passes. Test `client.test.ts:2638-2678` locks “do not overwrite a valid v1 event” even if the body is thin.

**Impact:** A `parseWebhookEvent` that sets `event: {schemaVersion:"1", type:"payment.succeeded", provider:{}}` while status is `processing` / `failed` is treated as trusted dual-write. Type-only fulfillment (documented Phase 7 path) can mark paid without money / status coherence. Built-ins attach full events; this is the custom / safety-net hole.

### MONEY-1 — ISO 4217 table omits active JMD / XCG / XAD

**Evidence:** `packages/core/src/utils/currency.ts:87-118` — `TWO_DECIMAL_CURRENCIES` has ILS→INR with no JMD; XCD / YER present, no XCG / XAD. `isKnownCurrencyCode` and `getCurrencyExponent` treat them as unknown and throw (`allowUnknown` defaults false). Confirmed ISO 4217 active 2026-01-01: JMD exp 2, XCG exp 2 (replaced ANG 2025-03-31), XAD exp 2. Downstream Stripe (`stripe.gateway.ts:252-258`) and PayPal (`paypal.gateway.ts:2363-2368`) reject the same codes.

**Impact:** JMD / XCG / XAD charges via `money()`, Stripe, PayPal, Paymob, Moyasar, and the testkit mock fail closed as “unknown” instead of scaling ×100. Not a silent 10× / 100× rescale — a production outage for valid ISO currencies the tables claim to cover.

### PAYMOB-1 — HMAC-covered `has_parent_transaction` unused; `is_refund` / `is_void` dropped when `is_refunded` / `is_voided` are present-and-false

**Evidence:** `packages/core/src/gateways/paymob/paymob.gateway.ts:1393-1398` — `sanitizeWebhookTransactionForStatus` deletes `is_refund` / `is_void` whenever `is_refunded` / `is_voided !== undefined` (including `false`). `mapTransactionStatus` (`:1991-2060`) then requires `is_refunded === true` or (`success && is_refund`) before treating a refund; otherwise `success` falls through to `paid`. `HMAC_FIELDS` includes `has_parent_transaction` and `is_standalone_payment` (`:125-146`) but neither is read for status. Types document the action / state split (`packages/core/src/types/webhook.types.ts:237-248`). Tests lock the fail-open (`paymob.gateway.test.ts:2727-2741`, `:2936-2950`).

**Impact:** A parented refund / void child with current-state flags false + `success` true dual-writes `paid` + `payment.succeeded` on the parent order. **Not confirmed as the live default Paymob payload** (official refund/void uses `is_refunded: true`). Ranked residual P1, not P0.

### WEBHOOKS-2 — `durable_retry` missing / unrefusable payload classified as `invalid_webhook` (forgery / 400)

**Evidence:** `packages/webhooks/src/engine.ts:1061-1089` — `outcomeInvalidWebhook` when `resolveDurablePayloadRef` fails (`DURABLE_PAYLOAD_REQUIRED` / `DURABLE_RAW_REFUSED` at `:535-538`). `ackAfterClaim` without `payloadRef` is the same outcome at `:1086-1089`. `README.md:95-97` maps `invalid_webhook` to “typically 400 — forgery / bad input only”. `types.ts:336-338` reserves `invalid_webhook` for `{ok:false}` / `InvalidWebhookError`.

**Impact:** An authentic paid delivery that hits `durable_retry` without a materializable snapshot is labeled forgery. Adapters that 400 `invalid_webhook` stop provider redelivery on providers that do not retry 4xx.

### WEBHOOKS-3 — `processWithVerifier` treats gateway parse `InvalidWebhookError` as forgery unless the message contains `parse failed`

**Evidence:** `packages/webhooks/src/engine.ts:220-239` — `isForgeryClassVerifyError` classifies `name === InvalidWebhookError` as forgery unless `message` includes `"parse failed"`. `classifyVerifyThrow` (`:363-369`) maps that to `invalid_webhook`. Paymob `parseWebhookEvent` throws `InvalidWebhookError("Invalid Paymob transaction webhook payload")` (`paymob.gateway.ts:2736-2741`, also `:1216`, `:1317`). Moyasar throws `InvalidWebhookError("Invalid Moyasar webhook payload")` (`moyasar.gateway.ts:1542`). `handleWebhook` (`packages/core/src/client.ts:747-765`) reclassifies parse `InvalidWebhookError` to `InvalidRequestError` (retryable); direct parse does not.

**Impact:** A signature-valid Paymob / Moyasar body that fails parse (new shape, bad timestamp, `card_auth_*`) becomes `invalid_webhook` (~400). Providers stop retrying authentic events. `handleWebhook` composition is safe; the documented verify+parse verifier is not.

### WEBHOOKS-4 — Inline claims store no `payloadRef`; durable `processRetryable` then dead-letters the paid row

**Evidence:** `packages/webhooks/src/engine.ts:1061-1082` — `processVerified` only snapshots `payloadRef` in `durable_retry`; inline without envelope writes no `payloadRef`. `processRetryable` (`:1320-1356`) `fail({deadLetter:true})` and returns `handler_failed {retryable:false}` when the event cannot be materialized. After `dead_letter`, a later `processVerified` maps `duplicate_failed` to `handler_failed {retryable:false}` (`:1117-1119`).

**Impact:** Migrating from `inline` to `durable_retry`, or running a worker against rows created by an inline engine, converts retryable pending paid events into terminal `dead_letter`. Money webhooks are not redriven.

### REDIS-1 — Webhook / recon renew leaves due / retry ZSET scored at the original lease expiry

**Evidence:** Claim scripts `ZADD` the retry / due index at `leaseExpiresMs` (`store-redis/src/scripts/webhook-inbox.lua.ts:68-70,145-147`; `reconciliation.lua.ts:183-186`). `WEBHOOK_RENEW_LUA` / `RECON_RENEW_LUA` only `HSET` the new `lease_expires_ms` / token (`webhook-inbox.lua.ts:206-216`; `reconciliation.lua.ts:245-256`) and JS passes a single `KEYS[1]` record with no index (`webhook-inbox-store.ts:144-155`; `reconciliation-store.ts:170-181`). `listRetryable` / `listDue` then `ZRANGEBYSCORE(-inf, now) LIMIT 0,limit` and keep only pending / scheduled after `GET_LUA`. `GET_LUA` correctly refuses to soft-release a still-active hash lease, so stale-scored claimed members occupy the LIMIT window.

**Impact:** After enough renews, `listDue` / `listRetryable` `LIMIT` returns `[]` while due paid redrive / recon work exists. Key-addressed claim / get still fence correctly (no double acquire); scheduler-driven follow-up and crash redrive stall.

### RECON-1 — `compareSnapshots` treats auth-hold `capturedAmount=0` vs `local.amount` as money drift

**Evidence:** `packages/reconciliation/src/compare.ts:125-138` compares `provider.capturedAmount` to `local.amount` whenever local omitted `capturedAmount`, with no status gate. Authorized + amount 10 + `capturedAmount` 0 (Stripe `requires_capture` → `authorized`) always emits `capturedAmount` drift. `policy.ts:444-521` then `apply_drift_review` instead of `mark_consistent`. Tests only cover paid + captured 4 (`compare.test.ts:120-131`).

**Impact:** Every thorough auth-hold recon that includes `local.amount` and a present zero `capturedAmount` is parked in `apply_drift_review`. Recovery of auth-only creates never auto-completes; ops noise can hide real capture drift.

### RECON-2 — `mark_consistent` ignores capture / refund totals on determinate auth / partial statuses

**Evidence:** `packages/reconciliation/src/policy.ts:242-266` — `providerPaidWithCaptureMismatch` / `providerPaidWithRefunds` return false unless `isPaidLikePaymentStatus` (paid only). Open-incomplete blocking (`:140-145,406-416`) requires `isIndeterminateLocal` (`pending` / `processing` only). Authorized / `partially_captured` / `approved` / `partially_refunded` locals skip both. `compare.ts:88,125-128` emits no diff when those locals omit `amount` / `capturedAmount`. Fall-through `:437-441` returns `mark_consistent` `safe:true` while `provider.capturedAmount` or `refundedAmount` is non-zero.

**Impact:** Stripe incremental capture stays `requires_capture` (`authorized`) while `amount_received` grows. Recon completes as consistent; the app may later full-capture / void or skip fulfillment of already-moved funds.

### RECON-3 — `processDue` `maxAttempts` dead-letters in-flight `retry_later` settlement

**Evidence:** `packages/reconciliation/src/policy.ts:393-403` (comments `:80-82`) maps sparse / pending + provider pending / processing to `retry_later` specifically to avoid `manual_review` dead-letter. `scheduler.ts:211-219` defaults `maxAttempts=10`, backoff 1s–15m. `scheduler.ts:419-430` converts any retry (including `retry_later` and `do_not_create_replacement`) to `markManualReview` when `record.attempts >= maxAttempts`. Policy `retry_later` for in-flight sets no `retryAfterMs`.

**Impact:** Bank transfer / 3DS / async methods still settling after ~10 claims are parked. If webhooks also miss, local stays pending after provider paid. That is a replacement-charge window.

### PERF-1 — Redis `listDue` / `listRetryable` SCAN + EVAL every record on every poll

**Evidence:** `packages/store-redis/src/stores/shared.ts:139-167` — `softReleaseExpiredClaimedViaScan` does `SCAN MATCH COUNT 50` until cursor 0 then `EVAL GET_LUA` on every key. Invoked from `reconciliation-store.ts:287-330` and `webhook-inbox-store.ts:233-278` on every list. Comments at `shared.ts:134-137` say SCAN is extra because claim already `ZADD`s `lease_expires_ms`. `deleteExpired` uses the same SCAN + per-key EVAL with default limit `Infinity`.

**Impact:** Each tick is O(all keys), including completed / dead-letter history. 100k inbox rows become ~2k SCAN round-trips plus 100k Lua evals per poll. Multi-worker schedulers multiply this and can stall Redis and delay paid webhook redrive.

### PERF-2 — SQL `listDue` / `listRetryable` unbounded UPDATE of all expired claimed rows

**Evidence:** `store-postgres/src/stores/reconciliation-store.ts:343-382` — `UPDATE` all claimed `WHERE lease_expires_at <= now` with no `LIMIT`, then `SELECT LIMIT`. Same UPDATE in postgres webhook-inbox-store (`:307-318`), store-d1 recon (`:375-409`) and webhook (`:364-398`), store-sqlite recon (`:373-407`) and webhook (`:355-389`), store-turso recon (`:375-408`), store-durable-objects recon (`:371-405`). `SKIP LOCKED` is only a comment (postgres recon `:368-371`); `SELECT` is unfenced.

**Impact:** Every poll rewrites every abandoned lease. Concurrent workers lock-storm then contend on the same due prefix. Write amplification is independent of the requested limit and spikes after deploys / crashes.

---

## Medium / Low (P2/P3)

Honesty, docs, testkit, observability, and secondary perf. None of these are confirmed false-paid / double-refund on built-in default paths.

### Core / money

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| CORE-5 | `applyOutcomeToGatewayResult` can persist `success:true` + `outcome:succeeded` with `failed` / `pending` status | `packages/core/src/types/operation-result.ts:592,625-627` | Callers branching on `result.outcome` treat a failed / pending payment as a successful operation (`isPaidOutcome` stays false) |
| CORE-6 | Stable-name short-circuit ignores domain status when attaching `PaymentEvent` | `packages/core/src/types/webhook-event-map.ts:590-594` | `WebhookEvent.type` already `payment.succeeded` with status `failed` / `pending` dual-writes `payment.succeeded` |
| CORE-7 | Post-submit create / OTP abort / timeout indeterminate results use `gatewayId` `"unknown"` | `packages/core/src/gateways/base.gateway.ts:566-611` | Operators cannot reconcile via `getPayment(gatewayId)` and may retry create |
| CORE-8 | Docs tell integrators to call `isPaidOutcome` on `WebhookEvent`; that is always false | `packages/core/docs/webhooks.md:30`; `operation-result.ts:695-714` | Follow-the-docs webhook fulfillment never ships; others skip paid-like guards |
| MONEY-2 | `fingerprintParams` encodes `Date` as JSON ISO-8601 and collides with the same string | `packages/core/src/utils/idempotency.ts:373-376` | Distinct `{at:Date}` vs `{at:isoString}` replay a cached mutation |
| MONEY-3 | `redact()` only matches whole-string PAN / secret leaves | `packages/core/src/utils/logger.ts:114-130`; `client.ts:707-711,735-740` | Embedded `sk_live_` / PAN in `hookError` messages logged in cleartext |

### Gateway honesty / docs

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| PAYPAL-2 | Docs say `PAYMENT.REFUND.COMPLETED` dual-writes `refund.completed`; code emits `refund.pending` | `paypal.gateway.ts:3321-3345`; `paypal.md:365`; `webhook-events.md:189` | Type-only handlers written from docs never book the live event (under-refund) |
| PAYMOB-3 | HMAC-covered `error_occured` is never used in status mapping | `paymob.gateway.ts:129,1998-2060` | Signed `error_occured=true` + `success=true` still dual-writes `payment.succeeded` |
| PAYMOB-4 | `webhook-events.md` says `is_capture` + success → `capture.completed`; gateway emits `processing` | `webhook-events.md:197`; `paymob.gateway.ts:2042-2046` | Handlers written from that page miss capture fulfillment |
| MOYASAR-1 | `payment_voided` webhooks are not fail-closed on residual paid / authorized snapshots | `moyasar.gateway.ts:1157-1167,1844-1856` | Type-only handlers can restock while funds remain captured (unguarded inconsistent-snapshot hole, not a proven live payload) |
| MOYASAR-2 | `idempotencyStore` typed / documented optional but mutations throw without it | `config.types.ts:33-40`; `moyasar.gateway.ts:354-380` | Callers following MoyasarConfig JSDoc get production `InvalidRequestError` on every capture / refund / void |
| MOYASAR-3 | Generic create types / JSDoc still advertise raw `creditcard` sources the adapter rejects | `payment.types.ts:189-194`; `moyasar.gateway.ts:461-463,671-674`; `validation.ts:353-358,417-418` | Type-checks, then fail-closed. No card-data leak and no HTTP |

### Webhooks / stores / recon / routing

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| WEBHOOKS-5 | Docs still lie about park `lease_lost`, inline `not_available`, and hash-source fallback | `engine.ts:1120-1163` vs `crash-boundaries.md:107-108,254` | Operators may 200 a park that never persisted or mix rawBody vs object hashes under an active lease |
| SQLFOUND-1 | `atomic-claims.md` says webhook `payload_hash` mismatch is never an overwrite; adapters supersede idle hashes | `sql-foundation/docs/atomic-claims.md:122` vs `claims/algorithm.ts` `decideWebhookClaim` | A second digest can take a paid-event key while pending / expired and ACK it |
| RECON-4 | `processDue` docs complete paid / failed without applying the local update | `packages/reconciliation/docs/scheduling.md:198-204` | Apps copying the snippet complete the job while local remains pending |
| ROUTE-1 | Complementary amount-split rules make select-time fallback always honesty-blocked | `packages/routing/src/router.ts:163-174,117-127` | Amount-split + fallback has no post-attempt recovery (fail-closed, unexplained `NoRouteMatchError`) |

### Testkit / observability / packages

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| TESTKIT-1 | Mock `capturePayment` settles money after void / failed / pending | `packages/testkit/src/mock/mock-gateway.ts:1362-1415` | Golden-path mock trains void-then-capture resurrection that production gateways reject |
| TESTKIT-2 | Mock capture / refund convert majors with caller currency, not payment currency | `mock-gateway.ts:1369-1373,1535-1539` | Tests accept currency mismatch Stripe / Paymob reject and can over / under-capture |
| TESTKIT-3 | `parseWebhookEvent` defaults missing type to `payment_paid` → `payment.succeeded` | `mock-gateway.ts:1793-1808` | Typeless paid-status payload fulfills as a real `payment.succeeded` |
| TESTKIT-4 | `paymentStatusToOperationOutcome` maps `refund_failed` (and unknown) to `succeeded` | `packages/testkit/src/mock/outcomes.ts:183-207` | Scripted `refund_failed` snapshots dual-write `outcome=succeeded` / `success=true` |
| OBS-1 | OTEL bridge forwards `span.end()` `status.message` unsanitized | `packages/observability/src/otel.ts:69-90` | Direct bridge users leak tokens / PANs / `sk_live` into APM |
| OBS-2 | Allow-listed span keys leak Stripe `cs_live_` / client-secret values | `packages/core/src/utils/logger.ts:114-129`; `observability` `instrumentation.ts:155-182` | `cs_live_` on `internalReference` / `providerObjectId` is exported unchanged |
| PKG-1 | sql-foundation root export includes test fakes whose executor always succeeds | `packages/sql-foundation/src/index.ts:204-214`; `fixtures/migration-fixtures.ts:37-68` | Callers can import `createFakeExecutor` next to `migrate()` and observe “success” with no durable schema |

### Secondary perf

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| PERF-3 | SQL indexes are single-column; list / cleanup predicates cannot use them efficiently | `sql-foundation/src/migrations/definitions.ts:102-167` | `listDue` / `listRetryable` degrade to status scans as terminal history dominates |
| PERF-4 | Redis `listDue` / `listRetryable` is ZRANGE plus serial N+1 GET after the full SCAN | `store-redis` `reconciliation-store.ts:312-330`; `webhook-inbox-store.ts:258-277` | `limit=100` is 1+100 EVALs on top of PERF-1 |
| PERF-5 | DO hash `listDue` / `listRetryable` fans out to all partitions times full limit | `store-durable-objects/src/client.ts:218-258,575-583` | `partitions=32` and `limit=10` wakes 32 isolates and runs 32 unbounded UPDATEs |
| PERF-6 | Webhook path parses, clones, stringifies, and SHA-256s the full payload multiple times | `stripe.gateway.ts:1974-2316`; `client.ts:65-129`; `engine.ts:448-638` | Large Stripe bodies pay two SHA-256s plus 3–5 tree clones on the HTTP thread |
| PERF-7 | `processDue` / `processRetryable` list-then-serial-claim N+1 and 10× oversample | `reconciliation/src/scheduler.ts:244-267,335-374`; `webhooks/src/engine.ts:1259-1308` | Default 10 jobs is 1+2N serial store round-trips; caps pull up to 1000 rows |

---

## Historical recheck (still present vs fixed)

```
RECHECK
CONFIRMED still present: (none in original form)
ALREADY FIXED:
- PP0 PP1 PP2 PP3 PP4 PP5 PP6
- S1 S2 S3 S4 S5 S6 S7
- PM1 PM2 PM3
- M1 M2 M3 M4
- C1 C2 C3 C4 C5 C6 C7
- R1 W1 ST1
```

All **31** historical defects are already fixed in `packages/core/src` (and routing / webhooks / store for R1 / W1 / ST1). None remain in the original form.

| Family | Original defect | Current state |
| --- | --- | --- |
| PayPal PP0–PP6 | Raw webhook JSON without trim; no transmission-time check; partial `final_capture` default true; first-capture preference; sync verify throw missing; failed authorize / refund mapped paid | Embeds raw webhook JSON without trim, validates transmission-time (aged soft-accept + far-future reject), defaults partial `final_capture` false, prefers last capture, throws on sync verify, maps failed authorize / refund to `declined` / `failed` |
| Stripe S1–S7 | Refunds vs charge amount (not captured base); PI success / `capturePayment` not partial; webhook skew missing; `no_payment_required` / `trialing` as paid / setup; `authentication_required` not declined | Refunds compare `amount_refunded` to captured base; maps partial PI success and `capturePayment` to `partially_captured`; ±300s webhook skew; does not treat `no_payment_required` / `trialing` as paid / setup; maps `authentication_required` to `CardDeclinedError` |
| Paymob PM1–PM3 | Capture amounts after `is_auth`; refunds vs original amount; partials dual-write succeeded | Evaluates capture amounts before `is_auth`, refunds vs `captured_amount`, dual-writes partials as `payment.processing` |
| Moyasar M1–M4 | `verified` not setup; `3ds_auth_error` not declined; mutations unguarded; `secret_token` leaked | Maps `verified` → `setup_completed`, `3ds_auth_error` → `CardDeclinedError`, requires mutation idempotency, strips `secret_token` |
| Core C1–C7 | After-hooks abort committed money ops; `onWebhookVerified` not fail-fast; incomplete money-identity freeze; non-finite amounts / `javascript:` URLs / empty idempotencyKey accepted; ISK / MGA exponents wrong; fingerprint `null`/`undefined` collide; `withRetry` unbounded | After-hooks cannot abort committed money ops; `onWebhookVerified` fail-fasts; `MONEY_IDENTITY_KEYS` freeze is complete; validation rejects non-finite amounts, `javascript:` URLs, and empty `idempotencyKey`; ISK=0 / MGA=2; fingerprint distinguishes `null` / `undefined`; `withRetry` clamps `maxAttempts` |
| Routing R1 | Post-money fallback allowed | Denies post-money fallback |
| Webhooks W1 | Inbox claim not atomic / no payload conflict | Inbox claim is atomic with `payload_conflict` |
| Store ST1 | Stores report false success on stale tokens | Stores fence stale tokens instead of false success |

New findings in this audit (WEBHOOKS-1, CORE-1 refund infer, Stripe refund-status / PI-succeeded, PayPal CAPTURE.REFUNDED / ORDER.COMPLETED, Paymob Intention fence) are **not** regressions of those 31 IDs. They are leftover classes adjacent to the historical fixes.

---

## Disputed / false positives

**None.** The disputed list is empty.

Severity was revised once, not dropped:

- Stream CORE/PAYMOB initially labeled **PAYMOB-1** as P0 (child refund/void → `paid` + `payment.succeeded`).
- Official Paymob payloads use `is_refunded: true` / `is_voided: true` for refund / void current state. The fail-open requires present-and-false current-state flags plus unused `has_parent_transaction`. That is a real mapping hole, **not a confirmed live default**. Ranked **P1 residual**.
- Stream PERF labeled **PERF-1** as P0. It is a production poll stall, not a money-integrity lie. Ranked **P1 non-blocking**.
- Stream PAYPAL labeled **PAYPAL-3** as P2. GATE ranks it **P1 blocking** because `ORDER.COMPLETED` invents paid from a capture id string. That ranking is kept.
- Stream OBS labeled TESTKIT-1/2/3 as P1. SYNTH ranks them **P2** (mock trains false invariants; not a live adapter money path). That ranking is kept.

No finding in this report was invented without an evidence path.

---

## Clean areas

These were re-checked and are solid on the built-in happy path:

- **Money kernel.** ISO 0/2/3/4 tables are correct for every code they list (ISK 0, MGA 2, UGX 0). Conversion is bigint. Idempotency fences do not expire. Retry is opt-in. No silent 100× rescale and no retry-without-idempotency bug in the five money files.
- **CORE paid-like rules (payments).** `inferOperationOutcome` still treats payment `success:false` + pending / processing / approved as indeterminate. URL / amount / empty-idempotency validation fail closed. Return-path money / identity freeze is complete. After-hooks cannot abort a committed money op.
- **Stripe.** Signature verification, currency math, charge caps, partial-capture / refund captured-base arithmetic, incomplete-snapshot fail-closed dual-write, and mutation idempotency hold. Default success-time snapshots (no refunds yet) are correct.
- **PayPal.** Verify, `final_capture`, capture / refund request construction, and remaining-held math are conservative and match the docs. Bare `ORDER.COMPLETED` without a capture id stays `processing`.
- **Paymob HMAC / unsigned amounts.** Forged `captured_amount` / `refunded_amount_cents` cannot mint paid or full refunds. AUTH cannot silently use a sale integration. Capture / refund / void mutations fence indeterminate 200s.
- **Moyasar.** Status, 3DS, creditcard blocking, webhook secret handling, and mutation idempotency are fail-closed. No P0 false-paid or unguarded double-refund path in `packages/core/src/gateways/moyasar`.
- **Webhook inbox engine (leases).** Atomic claim, token fencing, no processed-on-uncertain-complete, no stub redrive events. `handleWebhook` composition reclassifies parse failures as retryable. Built-in Stripe / Moyasar / Paymob verify stay sync.
- **Stores (claims).** Sampled claim / write adapters implement engine-level claims, token fencing, attempt rules, and fail-closed transactions. No P0 false-paid or double-acquire path in the sampled adapters.
- **Routing.** Fail-closed on replacement charges and post-attempt multi-gateway retry. Amount-split fallback is honesty-blocked (ROUTE-1), not an unbounded charge.
- **Observability (core path).** Package is honest about redaction, span error rates, and drift metrics, and does not attach incomplete money fields to spans. Residual leaks are `end()` messages and `cs_live_` on allow-listed keys (OBS-1/2).

---

## Recommended fix order

1. **WEBHOOKS-1 (P0).** Stop using raw `WebhookEvent.id` as the Paymob inbox key. Key redirect vs processed (and later status updates) separately — e.g. include notification type / HMAC-bound `has_parent_transaction` / a Paymob-specific event identity — or refuse to complete the inbox row on `payment.processing` when a later settlement snapshot is expected on the same provider id. Update `packages/webhooks/README.md` and `packages/core/docs/webhooks.md` in the same change.
2. **CORE-1.** Apply the payment P610-INF-2 rule to `inferRefundOperationOutcome`: `success:false` + `pending` / omitted success must be indeterminate, not `failed`.
3. **STRIPE-1.** Map `refund.failed` / `canceled` → `refund_failed` and in-flight refund → `refund_pending`. Do not overwrite payment status.
4. **STRIPE-2.** `succeededPaymentIntentWebhookStatus` must read charge refund totals (or fail closed to `processing` when `latest_charge` is unexpanded). Align webhook status with `getPayment`.
5. **PAYPAL-1.** Do not default `PAYMENT.CAPTURE.REFUNDED` to full `refunded`. Treat `resource_type=refund` + `COMPLETED` as this-op refund, not capture settlement. Run remaining-held rewrite or fail closed.
6. **PAYPAL-3.** Do not invent a `COMPLETED` capture from `related_ids.capture_id`. Absent nested captures → `processing`.
7. **PAYMOB-2.** Intention HTTP 200 missing `id` / checkout URL must throw `PaymobIndeterminateResponseError` (or otherwise keep the idempotency fence), matching capture / refund.
8. **WEBHOOKS-2 / WEBHOOKS-3 / WEBHOOKS-4.** Stop classifying missing durable snapshots and parse `InvalidWebhookError` as forgery. Persist `payloadRef` (or refuse inline→durable migration) so `processRetryable` cannot dead-letter paid rows.
9. **CORE-3 / CORE-4.** Await / boolean-check `verifyWebhook`; reject thin 3-field `PaymentEvent`s before skipping demotes.
10. **CORE-2.** Restore / freeze money-identity between composed after-hooks, not only on the client return path.
11. **PAYMOB-1 (residual).** Use HMAC-covered `has_parent_transaction` / action flags; do not drop `is_refund` / `is_void` when current-state flags are present-and-false.
12. **REDIS-1 + RECON-1/2/3.** Renew must rescore due / retry ZSETs. Auth-hold / incremental-capture compare and policy must be status-aware. `retry_later` settlement must not dead-letter at default `maxAttempts`.
13. **MONEY-1.** Add JMD / XCG / XAD to the ISO tables.
14. **PERF-1 / PERF-2.** Drop per-poll full SCAN; bound SQL expired-lease UPDATE.
15. **P2 pack.** Docs (CORE-8, PAYPAL-2, PAYMOB-4, WEBHOOKS-5, SQLFOUND-1, RECON-4, MOYASAR-2), testkit money machine, redact / OTEL leaks, remaining perf.

Do not ship until items 1–7 are fixed and covered by tests that would have failed this audit.

---

## Appendix — stream summaries (raw)

- **CORE.** Money / identity freeze, URL / amount / idempotency validation, and paid-like rules are solid on the happy path. Highest-risk leftovers: refund infer still forges failed on uncertain pending; after-hook composition can show later handlers a paid / forged snapshot before freeze; `handleWebhook` fail-opens if sync `verifyWebhook` returns a Promise; the dual-write safety net trusts a 3-field `PaymentEvent`.
- **MONEY.** Kernel is in good shape after prior MONEY-1..6 work. Main hole is table completeness (JMD / XCG / XAD). Remaining issues are a Date-vs-ISO fingerprint collision and redaction that misses secrets embedded in `hookError` strings.
- **STRIPE.** Signature, currency math, charge caps, partial-capture / refund captured-base arithmetic, incomplete-snapshot fail-closed dual-write, and mutation idempotency hold. Remaining bugs are status-mapping lies (`refund.*` → payment failed / pending; `payment_intent.succeeded` ignores charge refunds).
- **PAYPAL.** Verify, `final_capture`, capture / refund construction, and remaining-held math match the docs. Live money bug is `PAYMENT.CAPTURE.REFUNDED` fail-open. Honesty gaps: `REFUND.COMPLETED` docs vs `refund.pending` code; `ORDER.COMPLETED` invents paid from `related_ids.capture_id`.
- **PAYMOB.** Webhook HMAC and unsigned-amount stripping are solid. Intention create still releases the idempotency fence on HTTP 200 with a missing id / checkout URL. Child refund / void mapping is residual (not confirmed live default).
- **MOYASAR.** Status, 3DS, creditcard blocking, webhook secret handling, and mutation idempotency are fail-closed. Remaining issues: `payment_voided` residual-paid hole; store typed optional but required; generic creditcard JSDoc.
- **WEBHOOKS.** Inbox is a solid at-least-once lease engine. Production-money hole is key identity (WEBHOOKS-1), not leases. Secondary: durable refusals and parse `InvalidWebhookError` labeled forgery; inline rows without `payloadRef` dead-lettered by `processRetryable`.
- **STORES.** Adapters implement claims, token fencing, attempt rules, and fail-closed transactions. Remaining high-confidence hole is Redis recovery indexing (renew does not rescore). Foundation doc still denies idle hash supersede that the code implements.
- **RECON / ROUTING.** Fail-closed on replacement charges and post-attempt multi-gateway retry. Remaining money holes are recovery-completion lies (auth-hold drift, mark_consistent on incremental capture, `maxAttempts` dead-letter of `retry_later`).
- **OBS / TESTKIT / PKG.** Observability is largely honest. Serious leftover is testkit fakes that train false money invariants. OTEL `end()` messages and `cs_live_` allow-list leaks are P2. sql-foundation root-exports a fake executor.
- **PERF.** Expensive production paths are discovery polls, not keyed claims. Redis full SCAN, SQL unbounded expired-lease UPDATE, DO fan-out, webhook clone/hash pile-up, and list-then-serial-claim N+1.

```
SYNTH
verdict=SHIP_BLOCKED
summary=Ship is blocked by WEBHOOKS-1: the documented inbox key is WebhookEvent.id, Paymob sets that id to the same transaction id on redirect TRANSACTION_RESPONSE and processed TRANSACTION, and a normal return on the documented payment.processing redirect permanently ACK-suppresses the later payment.succeeded. Remaining P1s are real money/security holes (refund-infer double-refund, webhook verify fail-open, Stripe/PayPal status lies, Paymob intention fence, Redis/SQL recovery stalls, recon completing or dead-lettering in-flight settlement). Historical PP0–ST1 stay fixed; baseline typecheck/tests are green. PAYMOB-1 is not a confirmed live default payload (official is_refunded:true) and is ranked P1 residual, not P0.
```
