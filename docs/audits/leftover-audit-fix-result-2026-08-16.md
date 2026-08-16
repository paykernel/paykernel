# PayKernel leftover-audit fix-gate result (2026-08-16)

**Date:** 2026-08-16  
**Original audit:** [`leftover-audit-2026-08-16.md`](./leftover-audit-2026-08-16.md)  
**Fix-pass bookkeeping:** [`leftover-audit-fix-pass-2026-08-16.md`](./leftover-audit-fix-pass-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-fix-gate.rhai`  
**Reviewer stance:** fail-closed. Implement summaries and leftover-audit-fix-pass checkboxes were **not** trusted. Blocking and other-P1 money / fence / lease paths were re-grepped in source.  
**Working tree:** leftover-audit (round-3) diffs. Not a release commit.

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
summary=PASS. Leftover-audit P1 blocking IDs and other-P1 money/fence/lease IDs are closed in source. Typecheck green; 2738 pass / 35 skip / 0 fail. Residual PERF-5/6/7 plus documented NEW-WEBHOOKS-2 and NEW-PAYPAL-2.
blocking:
non_blocking:
- PERF-5
- PERF-6
- PERF-7
- NEW-WEBHOOKS-2
- NEW-PAYPAL-2
```

---

## Verify

```
VERIFY: typecheck_ok=true tests_ok=true invariants_ok=true ok=true
tests=2738 pass / 35 skip / 0 fail
```

- `bun run typecheck`: workspace packages exit 0.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso`: **2738 pass, 0 fail**. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3). Isolated bun:sqlite multi-connection WAL flake did **not** fire.

Leftover-audit invariants (audit recommended close 1–6) hold in source and in tests that would have failed this leftover audit. Residual P1 money / fence / lease code paths were re-grepped; the original lies are not in current source.

---

## Implement

Ten parallel streams (`fix:stripe`, `fix:paypal`, `fix:paymob`, `fix:moyasar`, `fix:webhooks`, `fix:stores`, `fix:core`, `fix:recon`, `fix:testkit-obs`, `fix:docs-audit`) plus integrate. **ok=10 fail=0**. No remediating gate cycle.

| Stream | Label | Residual IDs closed in this pass |
| --- | --- | --- |
| **A** | STRIPE | NEW-STRIPE-3, NEW-STRIPE-CKO-200, NEW-STRIPE-1, NEW-STRIPE-2 |
| **B** | PAYPAL | NEW-PAYPAL-1; NEW-PAYPAL-2 docs honesty (`paypal.md` matches `requires_action`) |
| **C** | PAYMOB | NEW-PAYMOB-2, NEW-PAYMOB-TTL, NEW-PAYMOB-REFUND-0, NEW-PAYMOB-VOID-P, NEW-PAYMOB-FP |
| **D** | MOYASAR | NEW-MOYASAR-1, NEW-MOYASAR-2, NEW-MOYASAR-3 |
| **E** | WEBHOOKS + `handleWebhook` rematch | NEW-CORE-2, NEW-CORE-3, NEW-WEBHOOKS-1; NEW-WEBHOOKS-2 docs / event-key honesty |
| **F** | STORES (Redis) | NEW-STORE-1 |
| **G** | CORE abort + apply + map + freeze | NEW-CORE-1, NEW-CORE-4, NEW-CORE-5, NEW-CORE-6, NEW-CORE-7, NEW-MONEY-1, NEW-MONEY-2 |
| **H** | RECON compare + scheduler | NEW-RECON-1, NEW-RECON-2 |
| **I** | TESTKIT + OBS | NEW-TESTKIT-1–5, NEW-OBS-1 |
| **J** | DOCS audit bookkeeping | this result + leftover-audit-fix-pass checklist |

---

## What was fixed vs remaining

Audit start (`leftover-audit-2026-08-16.md`): **SHIP_BLOCKED** on post-submit uncertainty classified as a clean failure, plus Stripe Checkout hardcoded `success: true`. Prior ship-gate and session-audit IDs stay closed and were not re-opened.

### Closed — P1 blocking (must close)

| ID | Audit hole | In-tree close |
| --- | --- | --- |
| **NEW-STRIPE-3** | `stripeRequest` HTTP 200 empty/`{}`/non-JSON returned as a PaymentIntent/Refund. Create/capture mapped missing status to `failed`; refund mapped missing status to `pending` + `success: true`; `fromStripeAmount(undefined)` invented major `0`. | Empty / non-JSON 200 throws `NetworkError` (`afterProviderSubmit` on mutations). Parsed `{}` / missing PI `id` or `status` on create/capture, and missing refund `id`/`status`, throw post-submit `NetworkError` → `outcome: indeterminate`. Create/capture omit amount unless minor is finite. |
| **NEW-STRIPE-CKO-200** | `createCheckoutSession` / `getCheckoutSession` hardcoded `success: true` with no `id` assert. Empty 200 → `{ success: true, sessionId: undefined }`. | Create requires string `id` via `requireStripeMutationId`. Get throws `NetworkError` when `id` is missing. Empty / `{}` 200 is not `success: true`. Checkout `url` may still be null on a valid session (Stripe-legal). |
| **NEW-CORE-1** | Caller abort after a mutating POST was `PaymentAbortedError`. `tryIndeterminateFromNetworkError` only accepts `NetworkError.afterProviderSubmit`. | `mapHttpAbortError` + `afterProviderSubmit: true` always returns `NetworkError({ afterProviderSubmit: true })`, including caller-signal abort. Stripe / PayPal / Moyasar pass the flag on mutating fetch; Paymob still wraps abort in-gateway. Pre-submit GET / token abort stays `PaymentAbortedError`. |
| **NEW-PAYPAL-1** | HTTP 200 missing `id`/`status` threw `PayPalApiError` status 0. App retry minted a new `PayPal-Request-Id`. | Mutation asserts pass `{ afterProviderSubmit: true }` → `NetworkError.afterProviderSubmit` → `outcome: indeterminate`. GET / token / webhook-verify still use status-0 `PayPalApiError`. |
| **NEW-PAYMOB-2** | Mutation HTTP 429 after POST was `GatewayApiError`/`RateLimitError`; `executeIdempotent` **deleted** the fence. | `throwPaymobApiError({ unknownOnServerError })` treats 429 like 5xx (`PaymobIndeterminateGatewayError`). `shouldRetainPaymobMutationFence` also keeps `RateLimitError` / raw 429. Fence stays `unknown`. |
| **NEW-MOYASAR-1** | Create HTTP 200 `{}` mapped missing status to `failed`/`declined` with undefined `gatewayId`. No create fence; caller minted a new `given_id`. | `assertObservedPaymentId` throws `NetworkError.afterProviderSubmit` before status mapping. `executeWithHooks` returns indeterminate. |

### Closed — other P1 (not still money lies)

| ID | In-tree close |
| --- | --- |
| **NEW-CORE-2** | `rematchSucceededWebhookDualWriteAgainstDomainStatus` rebuilds nested `event.payment` via `paymentFromWebhookEvent` so `status` cannot stay `paid` when the envelope is rematched. |
| **NEW-CORE-3** | Rematch covers envelope `pending` / `failed` / `cancelled` / `reversed` (plus processing / partial / authorized / refunded). |
| **NEW-CORE-4** | `mapPaymobCaptureSettle` / `mapPaymobFromFlags`: `is_capture` + `partially_captured` (or partial amounts) → `payment.processing`, never `capture.completed`. Full paid capture stays capture-domain. |
| **NEW-CORE-5** | `applyOutcomeToGatewayRefundResult` coerces stored outcome vs `base.status` (`succeeded`+`pending` → `pending`; `succeeded`+`failed` → `failed`; `pending`+`completed` → `succeeded`). |
| **NEW-WEBHOOKS-1** | `processRetryable` claims one listed row at a time (next `store.claim` after the previous handler returns). List is discovery only. |
| **NEW-RECON-2** | `processDue` claims one-at-a-time. `claimListedDue` (parallel) is only used by `claimDue`, not `processDue`. |
| **NEW-RECON-1** | In-flight `pending`/`processing` + `capturedAmount=0` vs `local.amount` is not invented capture drift; policy routes leftover compare inequality to `retry_later`, not `apply_drift_review`. Non-zero in-flight capture is still drift. |
| **NEW-PAYMOB-TTL** | `isStoredIdempotencyReplayExpired` is always `false`. Completed / unknown / in_progress fences are never a free key. In-memory prune is a no-op; cache-full refuses new keys instead of FIFO-evicting fences. |
| **NEW-STRIPE-1** | `getPayment` refund math falls through to `charges.data[0]` when `latest_charge` is omitted (same helper as webhooks). |
| **NEW-STRIPE-2** | Id-only `{ id: "ch_…" }` is unobservable (same as a string charge id) → `processing`, not `paid`. |
| **NEW-PAYMOB-REFUND-0** | `success: true` + missing/`<=0` `refunded_amount_cents` is `pending` and omits `totalRefunded` unless inquiry + this request proves a positive cumulative. |

P2 pack (NEW-PAYMOB-VOID-P / FP, NEW-MOYASAR-2/3, NEW-STORE-1, NEW-CORE-6/7, NEW-MONEY-1/2, NEW-TESTKIT-1–5, NEW-OBS-1) is present in source and is **not** a leftover silent money lie on built-in default paths. Not re-opened as blocking.

### Remaining — non-blocking residual

| ID | Residual |
| --- | --- |
| **PERF-5** | Documented leftover. DO hash `listDue` / `listRetryable` still peek every enumerable isolate (correct global earliest-N has no shared index). Full list runs only on occupied shards; expired `claimed` counts as occupied. No cheaper correct global earliest-N. |
| **PERF-6** | Documented leftover. Gateway webhook parse / redact / stringify / SHA-256 of large Stripe bodies still happens more than once in `stripe.gateway.ts`. Owned `handleWebhook` clone is a shallow `rawPayload` root copy (not a deep Stripe-body clone). |
| **PERF-7** | Documented leftover. `processDue` / `processRetryable` stay list-then-serial-claim (list is not a fence). NEW-WEBHOOKS-1 / NEW-RECON-2 closed the lease-overrun money class (one claim at a time). `claimDue` still bulk-claims by design. |
| **NEW-WEBHOOKS-2** | Documented honesty. Processed Paymob `TRANSACTION` inbox key remains `obj.id`; later same-id snapshot is `already_completed`; child refunds have new ids. Do not complete fulfillment on Paymob `payment.processing`. |
| **NEW-PAYPAL-2** | Docs honesty. `paypal.md` says partial capture `outcome: requires_action` (matches code). |

Adjacent leftover from the gate (missing approval link after 200 with id+status) is now closed: that path also throws `NetworkError.afterProviderSubmit` → `outcome: indeterminate`.

---

## P1 blocking — re-read in source

### NEW-STRIPE-3 — CLOSED (empty / `{}` / non-JSON 200 is not a PaymentIntent / Refund)

**Audit hole:** `stripeRequest` returned parsed JSON (or `{}`) on HTTP 200 even when the body was empty or non-JSON. Create/capture then mapped missing `status` to `failed`. Refund mapped missing `status` to `pending` + `success: true`. `fromStripeAmount(undefined)` published major `0` on create using caller currency.

**Current code** (`packages/core/src/gateways/stripe/stripe.gateway.ts`):

- `stripeRequestOnce` after `response.ok`: empty or `JSON.parse` failure throws `NetworkError` (`afterProviderSubmit` when the method is mutating) (~2969–2979). It does **not** return `{}` / `{error:{message}}` as `T`.
- Create / capture call `requireStripeMutationId` + `requireStripeMutationStatus` (~1606–1615, ~1684–1693). Missing identity throws `NetworkError({ afterProviderSubmit: true })`.
- Refund requires string `id` and string `status` (~1783–1793) before `mapStripeRefundStatus` / `applyOutcomeToGatewayRefundResult`.
- Create/capture only call `fromStripeAmount` when `amountMinor` is finite (~1641–1646).

`executeWithHooks` + `tryIndeterminateFromNetworkError` maps those tagged `NetworkError`s to `outcome: indeterminate` + `reconciliationRequired: true`.

**Tests that would have failed the leftover audit:** empty / `{}` / non-JSON create; id-without-status create/capture/refund; empty / `{}` refund.

### NEW-STRIPE-CKO-200 — CLOSED (`success: true` only after a string session id)

**Audit hole:** create/get Checkout Session hardcoded `success: true` with no `id` assert.

**Current code:**

- `createCheckoutSession` POST then `requireStripeMutationId(response.id, …)` (~2252–2256). `success: true` is only returned after that assert (~2258–2263).
- `getCheckoutSession` throws `NetworkError` when `session.id` is missing (~2101–2108). GET is not tagged `afterProviderSubmit` (correct — query).

**Tests:** empty / `{}` createCheckoutSession reject `NetworkError`; `{}` getCheckoutSession is not `{ success: true, sessionId: undefined }`.

### NEW-CORE-1 — CLOSED (caller abort after POST is `NetworkError.afterProviderSubmit`)

**Audit hole:** `mapHttpAbortError` mapped caller abort to `PaymentAbortedError`. `tryIndeterminateFromNetworkError` only accepts `NetworkError.afterProviderSubmit`. Retry-as-cancel could double-charge / double-refund.

**Current code** (`packages/core/src/runtime/abort.ts` ~220–232): when `options.afterProviderSubmit === true`, always return `NetworkError` tagged `afterProviderSubmit` (timeout-only, caller-only, or both). Stripe / PayPal / Moyasar pass the flag on mutating fetch. Paymob wraps abort as `PaymobIndeterminateNetworkError` inside `fetchPaymobMutation`.

`BaseGateway.tryIndeterminateFromNetworkError` still requires `NetworkError.afterProviderSubmit` — that is now the abort path after submit.

**Tests:** `abort.test.ts` NEW-CORE-1; Stripe / Moyasar mid-flight create abort is indeterminate. Pre-submit GET / token abort stays `PaymentAbortedError`.

### NEW-PAYPAL-1 — CLOSED (200 missing id/status is indeterminate)

**Audit hole:** `createMalformedResponseError` was always `PayPalApiError` status 0.

**Current code** (`paypal.gateway.ts` ~1826–1836): `afterProviderSubmit: true` → `NetworkError`. Create / capture / refund / void / authorize pass the flag on `assertOrderResponse` / `assertRefundResponse` / `assertPaymentResource`. Empty 200 parses to `{}` then hits the same assert.

**Tests:** create / refund HTTP 200 missing id; empty body → `outcome === 'indeterminate'`.

### NEW-PAYMOB-2 — CLOSED (429 after POST keeps the fence)

**Audit hole:** mutation HTTP 429 was `GatewayApiError`/`RateLimitError`; `executeIdempotent` deleted the key.

**Current code:**

- `throwPaymobApiError` with `unknownOnServerError` treats `status >= 500` **or** `status === 429` as `PaymobIndeterminateGatewayError` (~2751–2754).
- Intention / Orders / PaymentKey / capture / refund / void all pass `{ unknownOnServerError: true }`.
- `shouldRetainPaymobMutationFence` keeps indeterminate errors **and** `RateLimitError` / raw 429 `GatewayApiError` (~351–359). Catch path sets local + durable `unknown` instead of `delete` (~3050–3067).

**Tests:** refund POST HTTP 429 keeps fence; second same-key call throws `InvalidRequestError` without a second refund POST.

### NEW-MOYASAR-1 — CLOSED (create 200 `{}` is not failed/declined)

**Audit hole:** create HTTP 200 `{}` ran `mapPaymentResponse`, mapped missing status to `failed`/`declined`, `gatewayId` undefined. Create is not fenced; retry minted a new `given_id`.

**Current code:** `mapPaymentResponse` calls `assertObservedPaymentId` first (~1325–1326). Missing/blank `id` throws `NetworkError({ afterProviderSubmit: true })` (~1583–1594). `executeWithHooks` maps that to indeterminate.

**Tests:** HTTP 200 `{}`; HTTP 200 paid-without-id → indeterminate, not declined/failed.

---

## Other P1 — re-read (would have been blocking if still a money lie)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **NEW-CORE-2** | closed | `client.ts` ~237–252 rebuilds `payment` from envelope via `paymentFromWebhookEvent`. Test: rematch `payment.succeeded` + `processing` overwrites nested `paid`. |
| **NEW-CORE-3** | closed | `rematchSucceededTypeFromDomainStatus` covers `pending` / `failed` / `cancelled` / `reversed`. Tests in `client.test.ts`. |
| **NEW-CORE-4** | closed | `webhook-event-map.ts` ~409–416, ~441–447. Test: `payment-event.test.ts` TRANSACTION `is_capture` + `partially_captured` → `payment.processing`. |
| **NEW-CORE-5** | closed | `operation-result.ts` ~926–966 + `coerceRefundOutcomeToGatewayStatus` ~1076–1090. Test: `operation-result.test.ts` NEW-CORE-5. |
| **NEW-WEBHOOKS-1** | closed | `engine.ts` ~1400–1465 serial claim-then-handle. Test: `engine.modes.test.ts` claims-at-first-handler === 1. |
| **NEW-RECON-2** | closed | `scheduler.ts` `processDue` ~450–458. Test: mid-handler only one row `claimed`. |
| **NEW-RECON-1** | closed | `compare.ts` ~210–217 skips invented capture drift; `policy.ts` ~655–668 `retry_later`. Tests in `compare.test.ts` / `policy.test.ts`. |
| **NEW-PAYMOB-TTL** | closed | `isStoredIdempotencyReplayExpired` always false (~3149–3153); prune no-op (~3228–3231); cache-full refuse (~3091–3099). Tests: expired completed replay; no delete+re-reserve. |
| **NEW-STRIPE-1** | closed | `getPayment` ~1925–1940 + `stripeChargeSnapshotForRefundStatus` ~956–969. Test: omitted `latest_charge` + `charges.data[0].amount_refunded` is `refunded`. |
| **NEW-STRIPE-2** | closed | `isObservableStripeChargeSnapshot` requires `refunded === true` or finite `amount_refunded` (~872–882). Tests: webhook + getPayment id-only charge → `processing`. |
| **NEW-PAYMOB-REFUND-0** | closed | `paymob.gateway.ts` ~1070–1110. Test: success + `refunded_amount_cents: 0` is `pending`, `totalRefunded` omitted. |

---

## P2 pack — present in source (not residual money lies)

| ID | In-tree close |
| --- | --- |
| **NEW-PAYMOB-VOID-P** | Void honors `pending` like capture/refund (~968–975). |
| **NEW-PAYMOB-FP** | Shared `fingerprintParams`; AbortSignal stripped before fingerprint (~3233–3235). |
| **NEW-MOYASAR-2** | Verified `card_auth_*` parses as `provider.unmapped` (no `InvalidWebhookError` retry loop) (~1165–1170). |
| **NEW-MOYASAR-3** | `confirmStcPayOtp` is fenced via `runIdempotentMutation` (~1056–1060). |
| **NEW-STORE-1** | Redis list GET Lua `ZREM`s ghost ZSET members when the hash is missing. |
| **NEW-CORE-6** | `declined`/`failed` does not persist on paid-like status (status wins → stored `succeeded`) (~488–493). |
| **NEW-CORE-7** | After-hook freeze includes `refundedAt`; Dates are cloned (`money-identity.ts`). |
| **NEW-MONEY-1** | `applyOutcomeToGatewayResult` publishes finite amounts only with currency. |
| **NEW-MONEY-2** | Webhook payload redaction includes PAN/CVC keys (`number` / `cvc` / `cvv` / `pan` / `card`). |
| **NEW-TESTKIT-1** | Mock create fingerprint includes `orderId` / payment-method identity (token/source ids only). |
| **NEW-TESTKIT-2** | Partial refund does not freeze remaining capturable hold. |
| **NEW-TESTKIT-3** | `getPayment` + `outcome: "succeeded"` does not overwrite ledger to `paid`. |
| **NEW-TESTKIT-4** | `capture: false` without authorization capability is `OperationNotSupportedError`. |
| **NEW-TESTKIT-5** | Fixture safety matches `cs_live_` / PI client secrets. |
| **NEW-OBS-1** | OTEL span status messages redact embedded PANs + credential-shaped leaves. |

---

## Residual P1 / perf paths — grepped, not invented

These are **documented leftovers**, not unfixed money lies from the leftover-audit blocking set.

- **PERF-5** (`packages/store-durable-objects/src/client.ts` ~251–281): hash partitions still have no global due/retry index. Fan-out peeks every enumerable isolate, then full-lists only occupied shards. Missing peek RPC fails closed to full list. Residual cost is O(partitions) peeks, not a fence hole.
- **PERF-6** (`packages/core/src/client.ts` ~73–86): owned hook clone is a shallow `rawPayload` root copy. Stripe gateway parse/hash of large bodies is unchanged and still residual.
- **PERF-7** (`packages/reconciliation/src/scheduler.ts` ~177–181, ~390–403): list remains discovery; `claimDue` still issues listed claims concurrently. `processDue` / `processRetryable` are serial claim-then-handle (NEW-RECON-2 / NEW-WEBHOOKS-1).
- **NEW-WEBHOOKS-2** (`packages/webhooks/src/event-key.ts` ~11–19, `packages/webhooks/README.md`, `packages/webhooks/docs/inbox-engine.md`): processed Paymob `TRANSACTION` key is still `obj.id`. No `paymob.gateway.ts` `event.id` change this pass.
- **NEW-PAYPAL-2** (`packages/core/docs/paypal.md` ~69, ~316): partial capture is documented as `outcome: requires_action` and `isPaidOutcome` false — matches capture mapping.

No remaining tests found that lock the leftover empty-200-as-success, abort-after-POST-as-`PaymentAbortedError`, PayPal missing-id status-0, Paymob 429 fence-delete, or Moyasar create-`{}`-as-declined lies.

---

## Prior closed IDs

Not re-opened. Original lies are not in current source: WEBHOOKS-1, CORE-1–8 (original forms), STRIPE-1/2, PAYPAL-1/3, PAYMOB-1/2, PAYMOB-FENCE-1/2/3, STRIPE-CKO-1 / STRIPE-CHG-1, CORE-INF-1/2, CORE-HW-1, MONEY-1, REDIS-1, RECON-1/2/3, PERF-1/2, TESTKIT-1–4 (original), OBS-1/2, PKG-1, SQL-UPD-1, REDIS-CLEAN-1, PAYPAL-IDEM-1 / PAYPAL-DW-1 / PAYPAL-ID-1, WEBHOOKS-403, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR, PAYMOB-TOCTOU, RECON-LEASE-1, WH-LIST-FAIL, CORE-6-EXT.
