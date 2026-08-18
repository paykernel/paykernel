# PayKernel leftover-audit r5 fix-gate result (2026-08-18)

**Date:** 2026-08-18  
**Original audit:** [`leftover-audit-r5-2026-08-18.md`](./leftover-audit-r5-2026-08-18.md)  
**Fix-pass bookkeeping:** [`leftover-audit-r5-fix-pass-2026-08-18.md`](./leftover-audit-r5-fix-pass-2026-08-18.md)  
**Workflow:** `.grok/workflows/paykernel-leftover-audit-r5-fix-gate.rhai`  
**Reviewer stance:** fail-closed. Implement summaries and leftover-audit-r5-fix-pass checkboxes were **not** trusted. Blocking IDs, NEW-STORE-4, NEW-CORE-11, and the listed P2 money/secret lies were re-grepped and re-read in source. A later follow-up closed the cheap PERF-4/5/7 cuts (one Redis list-GET EVAL; skip DO peek when `partitions===1`; concurrent `claimDue`). Fencing is unchanged (`processDue` still serial).  
**Working tree:** leftover-audit (round-5) diffs plus PERF follow-up. Not a release commit.

---

## Result fields

```
final_pass=true
typecheck_ok=true
tests_ok=true
invariants_ok=true
gate_pass=true
implement_ok=9
implement_fail=0
```

| Field | Value |
| --- | --- |
| **final_pass** | `true` (`gate_pass && typecheck_ok && tests_ok && invariants_ok`) |
| **typecheck_ok** | `true` |
| **tests_ok** | `true` |
| **invariants_ok** | `true` |
| **gate_pass** | `true` |
| **implement** | **9 / 0** (streams A, B, D, E, F, G, H, I, J all `ok`; no Stream C this pass) |

```
GATE
pass=true
summary=PASS. leftover-audit-r5 blocking IDs and money-lie extras (NEW-STORE-4, NEW-CORE-11) closed in source. Typecheck green; 2853 pass / 35 skip / 0 fail. Cheap PERF-4/5/7 cuts closed after the gate; structural remainder only.
blocking:
non_blocking:
- PERF-4 (N hashes still inside one list-GET EVAL)
- PERF-5 (peek-all when partitions>1)
- PERF-7 (processDue stays serial)
```

---

## Verify

```
VERIFY: typecheck_ok=true tests_ok=true invariants_ok=true ok=true
tests=2853 pass / 35 skip / 0 fail
```

- `bun run typecheck`: all workspace packages exit 0.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso`: **2853 pass, 0 fail**. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3). Isolated bun:sqlite multi-connection WAL flake did **not** fire.

Leftover-audit-r5 invariants (recommended close 1–5: NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1) hold in source and in tests that would have failed this leftover audit. NEW-STORE-4 and NEW-CORE-11 were re-read as money/fence lies; the original lies are not in current source.

No leftover-lie tests found that still lock omitted-`final_capture`-as-`paid`, empty Stripe refund list as `totalRefunded: 0`, Moyasar mutating HTTP 200 invalid JSON as a thrown API error, PaymentEvent `payment.status` as un-qualified Paymob inbox keys, or USD `input.currency` + EUR Money as a routed match.

---

## Implement

Nine parallel streams (`fix:stripe`, `fix:paypal`, `fix:moyasar`, `fix:webhooks`, `fix:stores`, `fix:core`, `fix:routing`, `fix:testkit-obs`, `fix:docs-audit`) plus integrate. **ok=9 fail=0**. No Stream **C** (Paymob gateway) this pass. No remediating gate cycle.

| Stream | Label | Residual IDs closed in this pass |
| --- | --- | --- |
| **A** | STRIPE | NEW-STRIPE-REFUND-0, NEW-STRIPE-0 |
| **B** | PAYPAL | NEW-PAYPAL-7, NEW-PERF-1 (PayPal compact hash) |
| **D** | MOYASAR | NEW-MOYASAR-JSON-1, NEW-PERF-1 (Moyasar compact hash) |
| **E** | WEBHOOKS engine | NEW-WH-KEY-1 |
| **F** | STORES + recon/testkit memory | NEW-STORE-3, NEW-STORE-4, NEW-STORE-5, NEW-PERF-9 |
| **G** | CORE MAP | NEW-CORE-11 |
| **H** | ROUTING | NEW-ROUTE-CCY-1, NEW-ROUTE-2 |
| **I** | OBS + logger + testkit mock | NEW-OBS-3, NEW-TESTKIT-FP-1 |
| **J** | DOCS | this result + leftover-audit-r5-fix-pass checklist (bookkeeping only) |

---

## What was fixed vs remaining

Audit start ([`leftover-audit-r5-2026-08-18.md`](./leftover-audit-r5-2026-08-18.md)): **SHIP_BLOCKED** on sale-intent PayPal `capturePayment` omitted `final_capture` as `paid`, Stripe refund list `totalRefunded: 0`, Moyasar mutating HTTP 200 invalid JSON as a thrown API error, Paymob inbox keys missing PaymentEvent domain status, and routing `input.currency` ≠ `amount.currency`. Prior leftover-r4, leftover-r3, session-audit, and first-pass ship-gate IDs stay closed and were not re-opened.

### Closed — P1 blocking (must close)

| ID | Audit hole | In-tree close |
| --- | --- | --- |
| **NEW-PAYPAL-7** | Sale/order `capturePayment` fell back to `requestFinalCapture=true` when the capture omitted `final_capture`. GET / webhook already required `=== true`. Same capture fulfilled on capture then looked open on poll. Test `'should capture order and return capture ID'` locked `paid`. | `paid` only when **response** `final_capture === true`. Omitted / `undefined` / `false` → `partially_captured` + `outcome: requires_action` (`isPaidOutcome` false). No `requestFinalCapture` identifier remains in `paypal.gateway.ts`. Sale/order captures still do not send `final_capture`. |
| **NEW-STRIPE-REFUND-0** | `getTotalRefundedForPaymentIntent` started at `0` and returned major `0` on empty / pending-only list. Catch fallback to `charge.amount_refunded` ran only on throw. | Helper returns `undefined` when succeeded-refund sum is `<= 0`. Refund POST recovers `charge.amount_refunded` on throw **and** on unproven list, only when finite **and** `> 0`. `applyOutcomeToGatewayRefundResult` omits the field when undefined. |
| **NEW-MOYASAR-JSON-1** | `parseJsonResponse` threw `GatewayApiError` status 200 on invalid JSON. `executeWithHooks` only maps `NetworkError.afterProviderSubmit` → indeterminate. Caller throw + new key double-applied. | Mutating HTTP 2xx invalid JSON throws `NetworkError({ afterProviderSubmit: true })`. GET / non-mutating 2xx stay `GatewayApiError`. Fence stays `unknown`; same key does not POST again. |
| **NEW-WH-KEY-1** | `extractInboxDomainStatus` read only top-level `status`. Documented `event: webhookEvent.event` (`PaymentEvent`) has no top-level `status`. Processed keys stayed `paymob:TRANSACTION:{id}`; later same-id void was `already_completed`. | Domain status is `status`, `payment.status`, `refund.status`, or those paths on nested `event`. Recommended PaymentEvent path produces `paymob:TRANSACTION:{id}:{status}`. Redirect still ignores status. |
| **NEW-ROUTE-CCY-1** | Rule currency matched `input.currency` only. Money `amount.currency` was ignored unless the rule had min/max. `{ currency: "USD", amount: { amount: "10.00", currency: "EUR" } }` routed to a USD gateway. | `select` throws `NoRouteMatchError` (`currency_mismatch_honesty`) **before** rule or fallback match when both currencies are present and differ. USD rule does not match EUR Money. Post-attempt fallback preserves the honesty reason. |

### Closed — other P1 money/fence (gate-promoted if still lying)

| ID | In-tree close |
| --- | --- |
| **NEW-STORE-4** | Testkit idempotency `get` is read-only (no `expireIfNeeded`). `markIndeterminate` is token-first so A4 hang still parks after expiry. `complete` after expiry fails closed without clearing the token. `reserve` still soft-expires before reclaim (intended). SQL/DO `get` is a read-only select. |
| **NEW-CORE-11** | Public mapper rematch tables match `handleWebhook` (`cancelled` / `reversed` / `failed` / `refunded` / `authorized` / open money). Catalog Stripe / PayPal / Moyasar settlement names run through `coerceStableSucceededToDomainStatus`. `payment_intent.succeeded` + `refunded`/`failed` is not `payment.succeeded`. `PAYMENT.CAPTURE.COMPLETED` + `partially_captured` is not `capture.completed`. |

### Closed — other P1 / P2 pack (present in source; not residual)

| ID | In-tree close |
| --- | --- |
| **NEW-STORE-3** | Testkit webhook `complete` / `renew` token-fence first. Expired complete fails closed without wipe-then-lose. |
| **NEW-STORE-5** | Recon-package and testkit recon `complete` / `renew` / `markManualReview` / `fail` are token-first. |
| **NEW-STRIPE-0** | `fromStripeAmount(undefined\|null)` returns `undefined` (does not invent major `0`). |
| **NEW-PERF-9** | SQL / DO / Redis idempotency `deleteExpired` omitted `limit` binds `DEFAULT_DELETE_EXPIRED_LIMIT` (1000), not unbounded DELETE. |
| **NEW-PERF-1** | PayPal and Moyasar webhook `payloadHash` use compact identity (Stripe PERF-6 shape). |
| **NEW-OBS-3** | Logger + observability redact `seti_*_secret_*` and PayPal `A21AA…` / long `A21…` on allow-listed leaves and span / log messages. |
| **NEW-ROUTE-2** | Complementary **tenant** partitions honesty-block unconstrained fallback after the matching tenant bucket is excluded. |
| **NEW-TESTKIT-FP-1** | Mock create fingerprint includes `stripeSetupFutureUsage` / `paymobIframeId`. |

### Remaining — non-blocking residual (documented, not NEW-\*)

Follow-up (this pass) closed the cheap, fencing-safe leftovers. What remains is structural, not a silent money lie:

| ID | Residual after follow-up |
| --- | --- |
| **PERF-4** | **Closed for poll RTT.** `listDue` / `listRetryable` is ZRANGE + **one** list-GET EVAL (soft-release + ghost ZREM). SCAN stays off the poll path. Redis still reads N hashes inside that script (unavoidable). Cluster still requires `clusterKeys` (same CROSSSLOT constraint as mutators). |
| **PERF-5** | Hash discovery still peeks every enumerable isolate when `partitions > 1` (no shared occupancy index — a used-set can miss work). **Single-partition** layouts skip peek and list directly. Full-list earliest-N cutoff unchanged. |
| **PERF-7** | **`claimDue` claims listed rows concurrently** (leases start together). `processDue` still claims immediately before each handler (NEW-RECON-2). Oversample cap 200 unchanged. |

---

## P1 blocking — re-read in source

### NEW-PAYPAL-7 — CLOSED (order capture omitted `final_capture` is not `paid`)

**Audit hole:** leftover-r4 closed GET / webhook / order **map**. Sale/order `capturePayment` still treated omitted `final_capture` as `paid` via request-intent fallback (`requestFinalCapture` default `true`). The leftover-r4 result honesty note recorded this leftover. Test `'should capture order and return capture ID'` locked `paid` without `final_capture`.

**Current code** (`packages/core/src/gateways/paypal/paypal.gateway.ts`):

- Sale/order capture body does **not** send `final_capture` (~627–636). Only authorization captures set the request field.
- After HTTP 200, status is remapped: if mapped status is `paid` and response `final_capture !== true`, status becomes `partially_captured` (~678–690). Response boolean only — no request-intent fallback. `requestFinalCapture` does not exist in this file (repo-wide grep: no matches under `paypal/**`).
- `mapPayPalOutcome` maps `partially_captured` → `requires_action` (~1653–1663). `isPaidOutcome` is false.
- GET / webhook / `mapPaymentResultStatus` still require `final_capture === true` (leftover-r4 NEW-PAYPAL-3).

**Tests** (`paypal.gateway.test.ts`):

- `'should capture order and return capture ID'` — `status === 'partially_captured'`, `outcome === 'requires_action'`, `isPaidOutcome` false.
- `'order capture HTTP 200 COMPLETED without final_capture is not paid (NEW-PAYPAL-7)'`
- `'order capture HTTP 200 COMPLETED with final_capture true is paid'`

**Honesty note (not the original lie):** authorization **request** still defaults `final_capture` to `true` on a full auth capture (`p.paypalFinalCapture ?? true`). Paid mapping still requires the **response** boolean. Fail-closed if PayPal omits the echo.

### NEW-STRIPE-REFUND-0 — CLOSED (empty / pending-only list is not `totalRefunded: 0`)

**Audit hole:** `getTotalRefundedForPaymentIntent` accumulated from `0` and returned major `0` when the list was empty or pending-only. `charge.amount_refunded` recovery ran only in `catch`. A succeeded refund POST could ledger `totalRefunded: 0`.

**Current code** (`packages/core/src/gateways/stripe/stripe.gateway.ts`):

- `getTotalRefundedForPaymentIntent` (~2903–2948) sums only `status === "succeeded"` minors. If `totalMinorAmount <= 0`, returns `undefined` (not major `0`).
- `refundPayment` (~1884–1902): list throw → `undefined`; then `provenTotalRefundedFromCharge` only when finite `amount_refunded > 0`.
- `applyOutcomeToGatewayRefundResult` (`operation-result.ts` ~963–965) copies `totalRefunded` only when `!== undefined`.

**Tests** (`stripe.gateway.test.ts`):

- `NEW-STRIPE-REFUND-0: succeeded refund + empty list does not publish totalRefunded 0`
- `NEW-STRIPE-REFUND-0: pending-only refund list does not publish totalRefunded 0`
- `NEW-STRIPE-REFUND-0: empty list falls back to charge.amount_refunded when proven > 0`
- `NEW-STRIPE-REFUND-0: list error + charge.amount_refunded 0 omits totalRefunded`

### NEW-MOYASAR-JSON-1 — CLOSED (mutating 200 invalid JSON is indeterminate)

**Audit hole:** `parseJsonResponse` threw `GatewayApiError` with HTTP 200. Fence stayed `unknown` (good) but the caller saw a thrown API error. `executeWithHooks` only maps `NetworkError.afterProviderSubmit` → indeterminate. A new key could POST again.

**Current code:**

- `parseJsonResponse` (`moyasar.gateway.ts` ~1802–1825): mutating + `response.ok` + unreadable JSON → `NetworkError(..., { afterProviderSubmit: true })`. GET / non-mutating stay `GatewayApiError`.
- `requestJson` passes `mutating: abortOptions.afterProviderSubmit === true` (~1780–1782).
- `runIdempotentMutation` catch: `NetworkError` is not `isMoyasarDefiniteMutationFailure` → fence `unknown`.
- `BaseGateway.tryIndeterminateFromNetworkError` maps tagged `NetworkError` on `capturePayment` / `refundPayment` / `voidPayment` to `outcome: indeterminate`. `mapError` passes `NetworkError` through (`PaymentError`).

**Tests** (`moyasar.gateway.test.ts`):

- `treats refund HTTP 200 invalid JSON as indeterminate and keeps fence unknown (NEW-MOYASAR-JSON-1)` — `outcome === 'indeterminate'`, fence `unknown`, second call `InvalidRequestError`, one fetch.
- `treats capture HTTP 200 invalid JSON as indeterminate and keeps fence unknown (NEW-MOYASAR-JSON-1)`
- `treats GET HTTP 200 invalid JSON as GatewayApiError, not afterProviderSubmit (NEW-MOYASAR-JSON-1)`

### NEW-WH-KEY-1 — CLOSED (PaymentEvent `payment.status` qualifies Paymob keys)

**Audit hole:** `extractInboxDomainStatus` read only top-level `status`. Documented inbox path is `event: webhookEvent.event` (`PaymentEvent` has `payment.status` / `refund.status`, no top-level `status`). Processed keys stayed `paymob:TRANSACTION:{id}`; later same-id void was `already_completed`. NEW-WEBHOOKS-2 tests used a legacy `{status}` bag.

**Current code:**

- `readInboxDomainStatusRecord` / `extractInboxDomainStatus` (`packages/webhooks/src/engine.ts` ~722–752) read `status`, `payment.status`, `refund.status`, then the same paths on nested `event`.
- `processVerified` (~1154–1168) passes class + domain status into `deriveWebhookEventKey`.
- `qualifyPaymobProviderEventId` appends sanitized status on processed `TRANSACTION` only. Redirect `TRANSACTION_RESPONSE` ignores status.
- README (~59–61): `event: webhookEvent.event ?? webhookEvent` so `payment.status` / `refund.status` qualify.

**Tests** (`engine.test.ts`):

- `NEW-WH-KEY-1: PaymentEvent payment.status paid then cancelled are not already_completed`
- `NEW-WH-KEY-1: PersistedPaymentEventEnvelope nested payment.status qualifies TRANSACTION`
- `NEW-WH-KEY-1: TRANSACTION_RESPONSE PaymentEvent ignores payment.status`
- `NEW-WH-KEY-1: PaymentEvent refund.status qualifies TRANSACTION`

### NEW-ROUTE-CCY-1 — CLOSED (currency mismatch does not route)

**Audit hole:** Rule currency matched `input.currency` only. Money `amount.currency` was ignored unless the rule had min/max. `{ currency: "USD", amount: { amount: "10.00", currency: "EUR" } }` matched a USD rule and could use unconstrained fallback.

**Current code:**

- `inputCurrenciesConflict` (`amount-range.ts` ~253–260): both `input.currency` and declared amount currency present and differ (case-insensitive). Incomplete money (only one side) is not a conflict. String `amount` without `amountCurrency` inherits `input.currency` and is not a conflict.
- `selectImpl` (`router.ts` ~109–117) throws `NoRouteMatchError` (`currency_mismatch_honesty`) **before** any rule or fallback match.
- `ruleMatchesIgnoringAmountAndCapabilities` also refuses a USD rule when Money / `amountCurrency` is EUR (~76–88).
- `trySelectFallbackGateway` preserves `currency_mismatch_honesty` (does not rewrite to `no_alternate_gateway`).

**Tests:**

- `router.test.ts` `NEW-ROUTE-CCY-1: USD input.currency + EUR Money amount does not route`
- `match.test.ts` `NEW-ROUTE-CCY-1: USD rule does not match EUR Money amount`
- `fallback.test.ts` `NEW-ROUTE-CCY-1: currency mismatch honesty is not rewritten to no_alternate_gateway`

---

## Money-lie extras — re-read

### NEW-STORE-4 — CLOSED (expire-then-lose reserved fence is gone)

**Audit hole:** Testkit `expireIfNeeded` mutated expired `reserved` → `expired` and cleared the token in `get` / `markIndeterminate`. A4 hang `markIndeterminate` became `lease_lost`; next reserve was a free key.

**Current code** (`packages/testkit/src/memory/memory-stores.ts`):

- `get` (~396–399) is read-only — returns the reserved row + token after expiry.
- `markIndeterminate` (~373–394) is token-first; does **not** call `expireIfNeeded`. Matching token parks `indeterminate` after expiry.
- `complete` (~351–371) token-first then `isLeaseActive`; expired complete throws `StoreLeaseLostError` without clearing the token.
- `reserve` still calls `expireIfNeeded` before reclaim (intended lease timeout reclaim, not the hang-park hole).
- Postgres / sqlite / d1 / turso / DO `get` is a read-only select (no expire-on-read).

**Tests** (`memory-stores.test.ts`):

- `NEW-STORE-4: get after expiry is read-only; markIndeterminate still parks (A4)` — subsequent reserve is `indeterminate`, not a free key.
- `NEW-STORE-4: complete after expiry fails closed without clearing the token`

### NEW-CORE-11 — CLOSED (mapper does not type-only complete open money)

**Audit hole:** Public `coerceStableSucceededToDomainStatus` rematched `capture.completed` / `refund.completed` only for `partially_captured` / `processing`. Catalog Stripe / PayPal hits skipped cancelled / failed / refunded rematch. `handleWebhook` rematch (leftover-r4 NEW-CORE-8) was thicker.

**Current code** (`packages/core/src/types/webhook-event-map.ts`):

- `rematchSucceededStableFromDomainStatus` (~599–619) matches `client.ts` `rematchSucceededTypeFromDomainStatus`: open money / approved / refunded → `payment.processing`; `authorized` → `payment.authorized`; `failed` → `payment.failed`; `cancelled` / `reversed` → `payment.cancelled`.
- `rematchRefundCompletedStableFromDomainStatus` (~626–648) matches `rematchRefundCompletedTypeFromDomainStatus`.
- `coerceStableSucceededToDomainStatus` applies those tables to `payment.succeeded` / `capture.completed` / `refund.completed`.
- Catalog paths call coerce: Stripe `payment_intent.succeeded` / `checkout.session.completed` (paid) / `async_payment_succeeded`; PayPal `PAYMENT.CAPTURE.COMPLETED`; Moyasar `payment_paid` / `payment_captured` / `payment_refunded`.

**Tests** (`payment-event.test.ts`):

- `NEW-CORE-11: payment_intent.succeeded rematches refunded/failed/cancelled/authorized`
- `NEW-CORE-11: PAYMENT.CAPTURE.COMPLETED rematches open/failed/cancelled money`
- `NEW-CORE-11: moyasar catalog rematches cancelled/failed/refunded/authorized`
- `NEW-CORE-11: already-stable settlement rematches cancelled/reversed/failed/refunded/authorized`

**Honesty note (not the original lie):** Stripe **gateway** parse still rematches proven `refunded` / `partially_refunded` on paid-like types to dual-write `refund.completed` (`rematchSucceededIntentRefundWebhookDualWrite`). The **public mapper** rematch stays `payment.processing` (no refund entity invented). That is thicker Stripe-parse settlement, not type-only complete of open money.

---

## Other P1 / P2 — re-grep (closed, not residual)

### NEW-STORE-3

Testkit webhook `renew` / `complete` (`memory-stores.ts` ~573–606) check token / claimed status **before** any `releaseExpiredLease`. Expired complete throws `StoreLeaseLostError` without wipe. In-package webhooks memory was already token-first (leftover-r4). Tests: `NEW-STORE-3: complete after expiry does not wipe then lease_lost`, `NEW-STORE-3: renew after expiry does not wipe then lease_lost`.

### NEW-STORE-5

Recon-package `memory-store.ts` and testkit recon `complete` / `renew` / `markManualReview` / `fail` are token-first (`NEW-STORE-5` comments ~879–961). `fail` still records with matching token after expiry (RECON-LEASE-1). Tests: `NEW-STORE-5: fail after expiry records with matching token (no wipe-first)`, `complete after expiry fails closed; fail still records`, `markManualReview after expiry fails closed without wipe`.

### NEW-STRIPE-0

`fromStripeAmount(undefined|null)` returns `undefined` (`stripe.gateway.ts` ~429–431). Does not invent major `0`.

### NEW-PERF-9

SQL / DO / Redis idempotency `deleteExpired` binds `input.limit ?? DEFAULT_DELETE_EXPIRED_LIMIT` (`1000`). Unit tests assert the omitted-limit bind is 1000 (postgres / sqlite / d1 / turso / DO).

### NEW-PERF-1

PayPal `parseWebhookEvent` hashes `{ id, type, create_time, resource }` (`paypal.gateway.ts` ~1346–1351). Moyasar hashes `{ id, type, created_at, object: data.id }` (`moyasar.gateway.ts` ~1677–1691). Full-tree hash is gone on those parse paths.

### NEW-OBS-3

Logger (`packages/core/src/utils/logger.ts`) and observability (`packages/observability/src/redaction.ts`) redact `seti_*_secret_*` and PayPal `A21AA…` / long `A21…` as substrings on allow-listed leaves and span / log messages. Public `seti_…` / short `A21AA` stay visible. Tests in `redaction.test.ts`.

### NEW-ROUTE-2

Complementary tenant partitions honesty-block unconstrained fallback (`router.ts` `complementary_tenant_honesty`). Tests: `NEW-ROUTE-2: complementary tenant partitions honesty-block fallback after exclude`, unhealthy matching bucket, single-tenant exclude may still use fallback.

### NEW-TESTKIT-FP-1

Mock create fingerprint includes `stripeSetupFutureUsage` / `paymobIframeId` (`mock-gateway.ts` ~157–182). Test: `same idempotencyKey with different setup_future_usage/iframe is fingerprint_conflict (NEW-TESTKIT-FP-1)`.

---

## Residual PERF — re-read (documented only; fencing unchanged)

### PERF-4 (follow-up closed poll RTT)

`listDue` / `listRetryable` is `ZRANGEBYSCORE` + one `LIST_GET` EVAL (`RECON_LIST_GET_LUA` / `WEBHOOK_LIST_GET_LUA`). Ghost ZREM and expired-claimed soft-release stay inside that script (NEW-STORE-1 / REDIS-1). SCAN stays off the poll path. N hashes are still read inside Redis; that is the remaining cost, not N RTTs.

### PERF-5 (single-partition peek skip)

Hash `partitions > 1` still peeks every enumerable isolate (no shared occupancy index). `partitions === 1` lists that isolate without peek. Earliest-N full-list cutoff unchanged. Missing / non-boolean peek still fail-closed to must-list.

### PERF-7 (claimDue concurrent; processDue still serial)

`claimListedDue` uses `Promise.all` so listed claims start together. `processDue` still claims immediately before each handler (NEW-RECON-2). `LIST_DUE_OVERSAMPLE_CAP` remains 200.

---

## P0

- Typecheck: green (all workspace packages).
- Tests: **2853 pass / 35 skip / 0 fail**. Known sql-foundation WAL flake did not fire.

---

## Verdict

**PASS.** leftover-audit-r5 ship-gate IDs (NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1) and the listed money-lie extras (NEW-STORE-4, NEW-CORE-11) are closed in source. Typecheck green; 2853 pass / 35 skip / 0 fail. Residual PERF-4 / PERF-5 / PERF-7 stay documented leftovers and are non-blocking.
