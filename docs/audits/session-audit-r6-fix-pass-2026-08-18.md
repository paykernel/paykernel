# PayKernel session-audit fix pass (2026-08-18, r6)

**Source of truth:** [`session-audit-2026-08-18.md`](./session-audit-2026-08-18.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r6-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map and residual-ID checklist.  
**Scope of this file:** `docs/audits/**` only. Does **not** claim a post-fix gate result (that is `session-audit-r6-fix-result-2026-08-18.md` after a formal gate).  
**Working tree:** uncommitted session-audit (r6) diffs. Do **not** commit. Do **not** push. Do **not** re-open leftover-r5 / prior ship-gate IDs unless current code still has the original lie.

**Audit verdict at pass start:** **SHIP_BLOCKED**. This file is **not** a gate pass.

**Blocking (must close — this pass’s ship gate):**

1. **C1** (`C1-STRIPE-PI-UNEXPANDED`)
2. **I1** (`I1-PAYMOB-UNSIGNED-ACTION`)
3. **I2** (`I2-PAYMOB-MUTATION-FENCE`)
4. **I3** (`I3-PAYMOB-FLAGS-PENDING`)
5. **I4** (`I4-REDIS-RESERVED-KEYS`)
6. **I7** (`I7-EXAMPLE-RECON-BIND`)
7. **I8** (`I8-HEX-TO-BYTES`)
8. **I9** (`I9-BEHAVIORAL-CONTRACTS`)

Critic / implement streams skip any ID they prove already fixed against current code. This bookkeeping list is the audit start set, not a landing score. Integrate (workflow phase after A–J) updates landed-vs-remaining. Formal gate writes `session-audit-r6-fix-result-2026-08-18.md`.

---

## Residual inventory (from session-audit 2026-08-18)

Do not ship until **blocking** IDs are fixed and covered by tests that would have failed this audit. Gate may also treat still-present money / fulfillment / fence lies from the should-fix set as blocking.

**Counts:** 8 blocking + 9 should-fix = **17 residual IDs**.

No Stream **I** this pass.

### Blocking (must close)

Unexpanded Stripe PI settled money mapped `processing`; unsigned Paymob action aliases rewrite signed current-state; Paymob mutations POST without a fence; flags-only Paymob mapper ranks bare `success` before `pending`; Redis logical keys collide with indexes; checkout example binds a global last-success and deletes the order on create `NetworkError`; public `hexToBytes` accepts odd/non-hex; contracts still describe thrown `NetworkError` / unguarded Moyasar mutations.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **C1-STRIPE-PI-UNEXPANDED** | blocking | Default `payment_intent.succeeded` sends `latest_charge` as a string id plus `amount_received`. `succeededPaymentIntentWebhookStatus` returns `processing` before reading settled money. Happy-path test omits `latest_charge`. `STRIPE-2` locks the lie. Required: finite `amount_received > 0` → `paid` unless an *expanded* charge proves a refund; keep `processing` only when settled money is missing. | A |
| **I1-PAYMOB-UNSIGNED-ACTION** | blocking | HMAC uses `is_refunded ?? is_refund`. Sanitize drops `is_refund` only when `is_refunded === true`. Forged `is_refund: true` next to signed `is_refunded: false` still verifies and maps `refund_completed`. Same for `is_void` / `is_voided`. Required: if the signed current-state flag is present (true or false), ignore the unsigned action alias on the webhook path. | B |
| **I2-PAYMOB-MUTATION-FENCE** | blocking | `executeIdempotent` runs the POST when `idempotencyKey` is omitted. Moyasar throws. Paymob has no native mutation idempotency. Required: fail closed for capture/refund/void without store + atomic `reserve()` + key. | B |
| **I3-PAYMOB-FLAGS-PENDING** | blocking | `mapPaymobFromFlags` ranks bare `success` before `pending`. Built-in parse sets status first (safe). Public flags-only mapper can emit `payment.succeeded` for 3DS `success+pending`. Required: `pending === true` → `payment.processing` before the bare success arm. | G |
| **I4-REDIS-RESERVED-KEYS** | blocking | `recordKey(..., "recon", "due")` equals `reconciliationDueIndexKey`. Same for webhook `"retry"` and `"retain"`. Required: reject reserved logical keys at write (`due`, `retry`, `retain`) or put indexes on a different segment. | E |
| **I7-EXAMPLE-RECON-BIND** | blocking | Checkout kernel binds `mock.getLastProviderSideSuccess()` onto an order with no `gatewayPaymentId`. Deletes the order on untagged `NetworkError`. Required: never attach a global last-success; keep the order and schedule recon on create `NetworkError`. | F |
| **I8-HEX-TO-BYTES** | blocking | Public `hexToBytes` pads odd length and `parseInt(..., 16)` accepts `"0g"` / `"ag"`. Not on the live webhook compare path (`timingSafeEqualHex`). Required: reject odd length and non-hex. | C |
| **I9-BEHAVIORAL-CONTRACTS** | blocking | `behavioral-contracts.md` still says post-submit timeouts throw `NetworkError` and Moyasar mutations run unguarded. Code maps `afterProviderSubmit` to `indeterminate` and Moyasar throws without store+reserve+key. Required: rewrite to match `executeWithHooks` + Moyasar fail-closed. | C |

### Should-fix (same pass if ownership allows)

Honesty / lease / ACK / sanitize / inbox-key / example-auth holes. None of these are the ship-gate list. Gate may promote a leftover that creates a money or fulfillment lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **I5-LEASE-HEARTBEAT** | ~30s lease, no auto-renew while `runHandlerUnderLease` awaits the handler. | D |
| **I6-DURABLE-ACK** | `scheduled_for_retry` parked can ACK 200 without a worker. Engine must require explicit `workerGuaranteed` (or equivalent); example must not map parked / `handler_retry` to 200. | D (engine) + F (example HTTP) |
| **I10-MISSING-SECRET-CLASS** | Missing webhook secret → verify `false` → 400 ACK / forgery class. Engine must classify missing-secret `InvalidRequestError` as config (prefer retryable), not forgery. Stripe may throw `InvalidRequestError` instead of `false`. | D (classify) + A (optional Stripe throw) |
| **I11-WH-SANITIZE** | Webhook sanitize misses `cs_live_` / `cs_test_`, `csk_`, `pi_`/`seti_…_secret_…`, PayPal `A21AA…`, and PAN digit runs. | D |
| **I12-RECON-SANITIZE** | Recon persists `JSON.stringify(error)` with no object-key redaction. | H |
| **I13-WH-PAYMOB-STATUS** | Top-level `WebhookEvent.status: paid` qualifies processed keys and can suppress a nested refund key. Prefer `refund.status` / `payment.status` from `PaymentEvent`. | D |
| **I14-STALE-HASH-SUPERSEDE** | `processRetryable` listed hash can overwrite a newer idle `payloadHash`. If row hash ≠ listed hash, skip or re-read; do not supersede backwards. | D |
| **I15-DO-ENSURE-SCHEMA** | `readyStores` skips `ensureCachedSchema` unless `tableNamespace` is set. Fail closed on migrate errors. | E |
| **I16-EXAMPLE-PROVIDER-PAID** | Unauthenticated `/internal/provider-paid` on example hosts. README + route comments: test hook, not production. | F |

### Out of scope for this pass

Do not spend this pass on: client/injected lease clock vs DB `NOW()`, Stripe secret rotation, Moyasar provider token-in-body design, 0.x major-unit `number` results, `test:coverage` core-only.

---

## Stream ownership

Non-overlapping file ownership from `paykernel-session-audit-r6-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | **C1-STRIPE-PI-UNEXPANDED**; optional **I10** Stripe `webhookSecret` throw only |
| **B** | PAYMOB GATEWAY | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | **I1-PAYMOB-UNSIGNED-ACTION**, **I2-PAYMOB-MUTATION-FENCE** |
| **C** | CRYPTO + CONTRACT DOCS | `packages/core/src/runtime/crypto-portable.ts`, `packages/core/src/runtime/crypto-portable.test.ts`, `packages/core/docs/behavioral-contracts.md` | **I8-HEX-TO-BYTES**, **I9-BEHAVIORAL-CONTRACTS** |
| **D** | WEBHOOKS ENGINE | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md` | **I5-LEASE-HEARTBEAT**, **I6-DURABLE-ACK** (engine), **I10-MISSING-SECRET-CLASS** (classify), **I11-WH-SANITIZE**, **I13-WH-PAYMOB-STATUS**, **I14-STALE-HASH-SUPERSEDE** |
| **E** | REDIS + DO | `packages/store-redis/src/**`, `packages/store-durable-objects/src/object/payments-store-object.ts`, DO `object/**` tests that cover `readyStores` | **I4-REDIS-RESERVED-KEYS**, **I15-DO-ENSURE-SCHEMA** |
| **F** | EXAMPLES | `examples/**` | **I7-EXAMPLE-RECON-BIND**, **I6** example HTTP mapping, **I16-EXAMPLE-PROVIDER-PAID** |
| **G** | CORE MAPPER | `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.test.ts` if mapper tests live there, mapper tests next to `webhook-event-map` | **I3-PAYMOB-FLAGS-PENDING** |
| **H** | RECONCILIATION SANITIZE | `packages/reconciliation/src/sanitize.ts`, `packages/reconciliation/src/sanitize.test.ts` if present (else add nearby) | **I12-RECON-SANITIZE** |
| **J** | AUDIT BOOKKEEPING | `docs/audits/**` | this file (bookkeeping only) |

No Stream **I**. No stream owns `packages/core/src/client.ts`, PayPal / Moyasar gateways, `packages/routing/**`, `packages/observability/**`, or `packages/testkit/**` this pass.

### Ownership fences (do not cross)

- **A** must not edit `client.ts`, `webhook-event-map.ts`, `crypto-portable.ts`, Paymob, PayPal, or Moyasar. Optional I10 is Stripe verify throw only — do not change engine classification (**D**).
- **B** must not edit `webhook-event-map.ts` (**G** owns I3). **B** must not edit the webhooks package (**D**). Create/get/webhook stay unfenced; only capture/refund/void fail closed.
- **C** must not edit gateways or webhooks. I8 is the public helper only (`timingSafeEqualHex` is already the live compare path).
- **D** must not edit `examples/**` (**F**). **D** must not edit gateways. I6 engine half is `workerGuaranteed` / refuse parked ACK; I6 HTTP mapping is **F**.
- **E** must not edit webhooks or `sql-foundation`. I4 is Redis keys / write entrypoints; I15 is DO `readyStores` schema ensure.
- **F** must not edit `packages/*`. I7 must not bind `getLastProviderSideSuccess`. I6 example half: parked / `handler_retry` is 503 (kernel is inline — still do not 200 parked).
- **G** must not edit gateways or `client.ts`. I3 is `mapPaymobFromFlags` only (`pending` before bare `success`).
- **H** must not edit webhooks sanitize (**D**).
- **J** must not edit production `src` / `packages/**`.
- Prefer existing `PaymentStatus` values. Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split IDs

**I6-DURABLE-ACK (D + F)**

1. **D (engine):** `ackAfterClaim` / parked ACK must require explicit `workerGuaranteed: true` (or equivalent) on engine options. Without it, do not return `scheduled_for_retry` parked that hosts map to 200. Refuse or return retryable `handler_failed`. Document in `webhook-inbox.md`.
2. **F (example):** `mapInboxOutcome` for `scheduled_for_retry` parked / `handler_retry` must be 503. Do not 200 parked even if the kernel is inline-only.

**I10-MISSING-SECRET-CLASS (D + optional A)**

1. **D (classify):** `InvalidRequestError` about missing `webhookSecret` / `hmacSecret` / `webhookId` is permanent or retryable **config** — never forgery `invalid_webhook`. Prefer retryable 5xx-class `handler_failed` so the provider redelivers after the merchant adds the secret. Verify-false MAC mismatch stays forgery.
2. **A (optional):** Stripe missing `webhookSecret` may throw `InvalidRequestError` (config) instead of returning `false` (forgery). Update Stripe verify tests only. Do not change engine classification here.

---

## Recommended close (audit §)

1. C1-STRIPE-PI-UNEXPANDED  
2. I1-PAYMOB-UNSIGNED-ACTION  
3. I2-PAYMOB-MUTATION-FENCE  
4. I3-PAYMOB-FLAGS-PENDING  
5. I4-REDIS-RESERVED-KEYS  
6. I7-EXAMPLE-RECON-BIND  
7. I8-HEX-TO-BYTES  
8. I9-BEHAVIORAL-CONTRACTS  
9. Should-fix pack (I5, I6, I10–I16)  

Items **1–8** are this pass’s ship gate (blocking). Item **9** is same-pass should-fix — gate may promote a leftover money / fulfillment / fence lie.

---

## Already closed (do not re-open)

From leftover-audit-r5, leftover-r4 / leftover-r3, the 2026-08-16 session-audit fix-gate, and earlier ship-gates. Do **not** re-open unless current code still has the **original** lie.

```
NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1,
NEW-STORE-3/4/5, NEW-CORE-11, NEW-STRIPE-0, NEW-PERF-9, NEW-PERF-1,
NEW-OBS-3, NEW-ROUTE-2, NEW-TESTKIT-FP-1,
NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3, NEW-CORE-8, NEW-STRIPE-VOID-1,
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
| Session-audit **STRIPE-2** / leftover-r5 **NEW-STRIPE-REFUND-0** (expanded-charge refunds / unproven refund totals) | **C1** default PI webhook is unexpanded `latest_charge` string + `amount_received`; mapper still returns `processing` before settled money; `STRIPE-2` test now locks that lie |
| Moyasar fail-closed without store+reserve+key; leftover **PAYMOB-TOCTOU** | **I2** Paymob `executeIdempotent` still POSTs capture/refund/void when the key is omitted |
| leftover-r5 **NEW-WH-KEY-1** PaymentEvent `payment.status` / `refund.status` inbox keys | **I13** top-level `WebhookEvent.status: paid` can still qualify processed keys and suppress a nested refund |
| leftover-r5 **NEW-OBS-3** / webhook compact hash honesty | **I11** webhooks sanitize still misses `cs_live_` / `pi_…_secret_` / PAN; **I12** recon still `JSON.stringify(error)` |
| Code: `executeWithHooks` maps `afterProviderSubmit` → `indeterminate`; Moyasar mutations require fence | **I9** `behavioral-contracts.md` still says thrown `NetworkError` and unguarded Moyasar mutations |
| leftover-r4 / r5 webhook processed-key work | **I14** `processRetryable` listed hash can still overwrite a newer idle body |

---

## Stream J status

Wrote this ownership + residual checklist. Stream J did **not** edit `packages/**` or any production `src`.

**fixed_ids (this stream):** none — J is bookkeeping only.

**This file does not claim a gate pass.** Formal gate artifact is `session-audit-r6-fix-result-2026-08-18.md` (not this file). Integrate must later record landed-vs-remaining against current source.

---

## Integrate landed vs remaining (2026-08-18)

Integrate re-read current source (not stream claims). `bun run typecheck` green after one merge-TS fix. Targeted tests green: `bun test packages/core packages/webhooks packages/reconciliation packages/store-redis packages/store-durable-objects examples` → **2111 pass, 16 skip (live Redis), 0 fail**.

**This section is bookkeeping, not a formal gate pass.** Formal gate still writes `session-audit-r6-fix-result-2026-08-18.md`.

### Integrate-only edits (on top of A–H)

- `examples/checkout-kernel/src/types.ts`: `CheckoutOrderRecord.gateway` is `"mock" | "stripe"` so `getPayment(..., order.gateway)` typechecks after the I7 snapshot rewrite.
- `packages/core/docs/behavioral-contracts.md`: Paymob capture/refund/void matrix + notes match I2 fail-closed (store + `reserve()` + key, no POST). I9 NetworkError / Moyasar fence already matched `executeWithHooks`.

### Blocking — landed (verified)

| ID | Current code | Test that would have failed the audit |
| --- | --- | --- |
| **C1-STRIPE-PI-UNEXPANDED** | `succeededPaymentIntentWebhookStatus` no longer returns `processing` on unexpanded `latest_charge` string/id-only. Finite `amount_received` (>0 via settled-minor helper) → `paid` unless *expanded* charge proves refund; missing settled → `processing`. Happy-path fixture includes `latest_charge: "ch_123"`. | `stripe.gateway.test.ts` STRIPE-2 unexpanded + `amount_received` expects `paid`; missing received stays `processing`. |
| **I1-PAYMOB-UNSIGNED-ACTION** | `sanitizeWebhookTransactionForStatus` drops `is_refund` / `is_void` when signed `is_refunded` / `is_voided` is present (true **or** false). | Paymob tests: forged `is_refund: true` + signed `is_refunded: false` → `paid`, not `refund_completed`. |
| **I2-PAYMOB-MUTATION-FENCE** | `runIdempotentMutation` throws `InvalidRequestError` without store / `reserve()` / key **before** `executeIdempotent`. | I2 tests: omit key or omit store → throw, `fetchCalls.length === 0`. |
| **I3-PAYMOB-FLAGS-PENDING** | `mapPaymobFromFlags`: `pending === true` before bare `success`. | `payment-event.test.ts` I3: flags `success+pending` → `payment.processing`. |
| **I4-REDIS-RESERVED-KEYS** | `recordKey` / `assertLogicalKey` reject exact `due` / `retry` / `retain`. Idempotency / inbox / recon writes go through `recordKey`. `RedisKeyDesignError` maps to `StoreInvalidSchemaError`. | `keys.test.ts` + store entrypoint mock tests. |
| **I7-EXAMPLE-RECON-BIND** | Kernel never calls `getLastProviderSideSuccess()`. Missing `gatewayPaymentId` → lookup `unavailable`. Any `NetworkError` keeps the order and schedules recon. | `kernel.test.ts` + scenarios: no cross-order bind; untagged NetworkError keeps order, no leaked `err.message`. |
| **I8-HEX-TO-BYTES** | `hexToBytes` rejects odd length and non-hex nibbles (no pad, no `parseInt`). | `crypto-portable.test.ts`: `"abc"` length; `"0g"` / `"ag"` character. |
| **I9-BEHAVIORAL-CONTRACTS** | Post-submit timeout is `executeWithHooks` → `indeterminate` (not thrown `NetworkError`). Moyasar mutations require store + `reserve()` + key. Paymob mutation row aligned with I2. | Doc-only; text matches code cited above. |

### Should-fix — landed (same pass)

| ID | Current code |
| --- | --- |
| **I5-LEASE-HEARTBEAT** | `runHandlerUnderLease` auto-renews on `leaseMs/3` interval; heartbeat `lease_lost` does not complete as owner. |
| **I6-DURABLE-ACK** | Engine: `ackAfterClaim` requires `workerGuaranteed: true` (constructor throw or retryable `handler_failed`, never parked). Example: `mapInboxOutcome` maps all `scheduled_for_retry` (parked / handler_retry / not_available) to **503**. |
| **I10-MISSING-SECRET-CLASS** | Engine classifies missing `webhookSecret` / `hmacSecret` / `webhookId` as retryable config, not forgery. Stripe verify throws `InvalidRequestError` when secret is missing. |
| **I11-WH-SANITIZE** | Webhook sanitize: `cs_live_` / `cs_test_`, `csk_`, `pi_`/`seti_…_secret_…`, PayPal `A21AA…`, PAN digit runs, object-key redaction. |
| **I12-RECON-SANITIZE** | Recon redacts known secret keys on plain objects before `JSON.stringify`. |
| **I13-WH-PAYMOB-STATUS** | Inbox domain status prefers nested `refund.status` / `payment.status`; top-level WebhookEvent `status: paid` does not suppress a nested refund key. |
| **I14-STALE-HASH-SUPERSEDE** | `processRetryable` re-reads; listed hash ≠ current idle hash → skip (no backwards supersede). |
| **I15-DO-ENSURE-SCHEMA** | `readyStores` always `ensureCachedSchema` (even when Worker omits `tableNamespace`). Migrate errors fail closed. |
| **I16-EXAMPLE-PROVIDER-PAID** | `/internal/provider-paid` labeled test hook / unauthenticated / do not deploy (kernel JSDoc, handlers, host apps, READMEs). |

### Remaining (not residual IDs)

- Formal gate artifact `session-audit-r6-fix-result-2026-08-18.md` is **not** written here.
- `succeededPaymentIntentWebhookStatus` still accepts unused `{ unexpandedCharge }` (callers pass `"ignore"`; behavior is now settled-money only). Not a C1 lie.
- Checkout Session hydration still maps **id-only / unexpanded** `latest_charge` to `processing` (`stripeCheckoutPaidSessionStatus` / STRIPE-CKO-1). That is **not** C1 (C1 is default PI webhook `latest_charge` string + `amount_received`).
- Live Redis integration tests remain skipped without a Redis server (16 skips).
- Out of scope unchanged: client/injected lease clock vs DB `NOW()`, Stripe secret rotation, Moyasar token-in-body, 0.x major-unit `number` results, `test:coverage` core-only.

**Working tree:** uncommitted. Do **not** commit. Do **not** push.

---

## Residual ID checklist (copy for critic / gate)

Integrate flipped these against current source. Do **not** treat checked boxes here as a formal gate pass.

### Blocking (ship gate)

- [x] C1-STRIPE-PI-UNEXPANDED
- [x] I1-PAYMOB-UNSIGNED-ACTION
- [x] I2-PAYMOB-MUTATION-FENCE
- [x] I3-PAYMOB-FLAGS-PENDING
- [x] I4-REDIS-RESERVED-KEYS
- [x] I7-EXAMPLE-RECON-BIND
- [x] I8-HEX-TO-BYTES
- [x] I9-BEHAVIORAL-CONTRACTS

### Should-fix

- [x] I5-LEASE-HEARTBEAT
- [x] I6-DURABLE-ACK (D engine + F example)
- [x] I10-MISSING-SECRET-CLASS (D classify + optional A Stripe throw)
- [x] I11-WH-SANITIZE
- [x] I12-RECON-SANITIZE
- [x] I13-WH-PAYMOB-STATUS
- [x] I14-STALE-HASH-SUPERSEDE
- [x] I15-DO-ENSURE-SCHEMA
- [x] I16-EXAMPLE-PROVIDER-PAID
