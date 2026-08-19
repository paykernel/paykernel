# PayKernel session-audit fix pass (2026-08-19, r7)

**Source of truth:** [`session-audit-2026-08-19.md`](./session-audit-2026-08-19.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r7-fix-gate.rhai`  
**This document:** Stream J ownership map + **integrate** landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` bookkeeping. Does **not** claim a post-fix gate result (that is `session-audit-r7-fix-result-2026-08-19.md` after a formal gate).  
**Working tree:** uncommitted session-audit (r7) diffs. Do **not** commit. Do **not** push. Do **not** re-open 2026-08-18 C1 / I1–I4 / I7–I9 (or should-fix I5 / I6 / I10–I16) unless current code still has the **original** lie.

**Audit verdict at pass start:** **SHIP_BLOCKED**. Integrate flipped residual boxes against current source. This file is **not** a gate pass.

**Blocking (must close — this pass’s ship gate):**

1. **S19-CKO-TIMEOUT**
2. **S19-PAYMOB-JSON**
3. **S19-PAYMOB-REDIR-STATUS**
4. **S19-PAYMOB-REFUND-UNPAID**
5. **S19-MAP-REFUND-PENDING**
6. **S19-WH-HASH-TOCTOU**
7. **S19-STRIPE-LATE-REFUND**

Critic / implement streams skip any ID they prove already fixed against current code. This bookkeeping list is the audit start set, not a landing score. Integrate (workflow phase after A–H + J) updates landed-vs-remaining. Formal gate writes `session-audit-r7-fix-result-2026-08-19.md`.

Do **not** undo 2026-08-18 **C1**: unexpanded PI + `amount_received > 0` stays `paid` when there is no refund evidence.

---

## Residual inventory (from session-audit 2026-08-19)

Do not ship until **blocking** IDs are fixed and covered by tests that would have failed this audit. Gate may also treat still-present money / fulfillment / fence lies from the should-fix set as blocking.

**Counts:** 7 blocking + 14 should-fix + 4 nits = **25 residual IDs**.

No Stream **I** this pass.

### Blocking (must close)

Checkout create timeout after Stripe accepted the session is still a thrown `NetworkError`; Paymob GET inquiry empty/HTML 200 maps `failed`/`declined`; Paymob redirect envelope `status` stays `paid` while dual-write is `payment.processing`; Paymob refund/capture POSTs on failed/pending sales; flags-only mapper ranks refund arms before `pending`; webhook retry claim can supersede a newer idle hash; Stripe `payment_intent.succeeded` last-writes `paid` over an observable refunded charge.

| ID | Sev | One-line | Stream |
| --- | --- | --- | --- |
| **S19-CKO-TIMEOUT** | blocking | `createCheckoutSession` POSTs through `executeWithHooks`. `stripeRequest` tags mutating POSTs `afterProviderSubmit: true`. `isPostSubmitMoneyMutation` omits `createCheckoutSession`, so timeout after Stripe accepted the session is a thrown `NetworkError`. Empty/non-JSON 200 already throws (`NEW-STRIPE-CKO-200`) and is also not converted to indeterminate. Missing caller `idempotencyKey` mints a new UUID per call. Required: treat `createCheckoutSession` as post-submit uncertain; return a **checkout-shaped** result with `reconciliationRequired: true` (do **not** reuse `applyIndeterminatePaymentOutcome`). Keep `getCheckoutSession` throwing. Test: POST timeout is not a retryable failed-create. | A |
| **S19-PAYMOB-JSON** | blocking | `parseJson` catch returns `{}`. On GET inquiry HTTP 200, `normalizeApiTransactionResponse` accepts `{}`, `mapTransactionStatus` falls through to `failed`, missing `success` → `declined`. Stripe/Moyasar/PayPal throw on invalid JSON. Recon `update_local_to_failed` will mark a captured payment failed. Required: invalid/empty JSON on GET → throw (`GatewayApiError` / unavailable). Mutations keep `requireMutation*` indeterminate. Do not map missing `success` to `failed` when `id` and money fields are also missing. Test: empty/HTML 200 inquiry is not `declined`. | B |
| **S19-PAYMOB-REDIR-STATUS** | blocking | Redirect parse forces `type: TRANSACTION_RESPONSE` so dual-write is `payment.processing`, but envelope `status` stays `mapTransactionStatus(success=true)` → `paid`. Tests lock `status === "paid"`. Handlers that fulfill on `event.status === "paid"` settle a browser-replayable GET. Required: demote redirect envelope `status` to `processing` (same as `stableType`). Flip tests. | B |
| **S19-PAYMOB-REFUND-UNPAID** | blocking | `resolveRemainingActionAmountCents` only blocks uncaptured **auth** refunds. A failed/pending sale (`success: false` / `pending: true`, `captured_amount` omitted) uses full `amount_cents` as remaining and POSTs refund/capture. Required: refuse refund/capture unless inquiry shows captured/paid or a positive `captured_amount`. Pending/failed sales throw `InvalidRequestError` before POST (`fetchCalls.length === 0`). | B |
| **S19-MAP-REFUND-PENDING** | blocking | I3 only moved bare `success` below `pending`. `hasAmountRefund` / `isRefunded` / `isRefund+success` still rank first. Built-in `mapTransactionStatus` ranks `pending` first. Flags-only `mapProviderEventTypeToStable` can emit `refund.completed` while `pending` is set. `refund_pending` is unmapped in `mapPaymobStatusOnly`. Required: rank `flags.pending` / status `pending` / `processing` / `refund_pending` above refund arms. Map `refund_pending` → `refund.pending` (and `refund_failed` → `refund.failed`). Flags-only test: `pending+success+isRefund` (no status) is not `refund.completed`. | C |
| **S19-WH-HASH-TOCTOU** | blocking | I14 compares list snapshot to a later `get`. Between `get` and `claim`, an idle row may have a newer hash. Worker claims with the stale `get` hash; idle mismatch **supersedes** (WEBHOOKS-3) and rolls the body back. Required: do not supersede backwards. If store hash ≠ listed hash at claim time, skip. Prefer compare-inside-claim or re-read immediately before claim and skip on mismatch. Test: listed `hash-a` + idle `hash-b` at claim time does not rewrite to `hash-a`. | D |
| **S19-STRIPE-LATE-REFUND** | blocking | `succeededPaymentIntentWebhookStatus` ignores string `latest_charge` for refunds (C1: use `amount_received`). Stripe does not decrement `amount_received` on refund. Delayed first delivery of `payment_intent.succeeded` after `charge.refunded` last-writes `paid`. `getPayment` re-fetches the charge and reports `refunded`. Classic Checkout `payment_status: paid` + string PI is the same class. Required: when a charge snapshot is observable, keep refund rematch. When `charges.data` has refunds, honor them. `getCheckoutSession` must rematch expanded PI refunds (see **S19-CKO-GET**). Do **not** undo C1 (unexpanded + `amount_received` > 0 stays `paid` when no refund evidence). Document that apps must not last-write `PI.succeeded` over `charge.refunded`. Test: expanded/list charge with `amount_refunded` is not `paid`. | A |

### Should-fix (same pass if ownership allows)

Honesty / money-publish / lease / fingerprint / example-bind holes. None of these are the ship-gate list. Gate may promote a leftover that creates a money or fulfillment lie.

| ID | One-line | Stream |
| --- | --- | --- |
| **S19-PAYMOB-LEGACY-ID** | Legacy create sets `gatewayId` to the numeric **order** id. `assertPaymobTransactionId` accepts `/^\d+$/` and sends it as `transaction_id`. Intention `pi_…` is already rejected. Required: do not put order id on `gatewayId` (distinct `orderId` only). Mutations still require webhook/dashboard `obj.id`. Docs: never pass create `gatewayId` from iframe checkout into refund/inquiry. | B |
| **S19-CKO-AMOUNT** | Checkout webhook amount always uses `amount_total`. Status can be `partially_captured` from PI `amount_received`. Required: when PI is expanded, publish settled `amount_received`. Always publish currency with major-unit amount fields. | A |
| **S19-CKO-GET** | `getCheckoutSession` expands `payment_intent` then ignores it and returns native `payment_status` + `amount_total`. Required: rematch refunds like `getPayment` when the PI is expanded. | A |
| **S19-STRIPE-CHARGE-SWALLOW** | `getPayment` catch on `GET /charges/{id}` sets `chargeRefundStateUnknown` → succeeded PI maps `processing`. 401/429/5xx look like “still settling.” Required: propagate auth/5xx as `NetworkError` / `AuthenticationError`. Keep fail-closed `processing` only when the charge is unobservable (string id, no fetch attempted or 404). | A |
| **S19-STRIPE-DISPUTE** | `charge.dispute.*` falls through to `pending`. Last-write persist can move `paid` → `pending` without a dispute arm. Required: map dispute events to domain dispute statuses **or** leave unmapped / `provider.unmapped` dual-write — never overwrite a paid envelope as generic `pending`. Capabilities may stay `disputes: false` if dual-write is `provider.unmapped`. | A |
| **S19-EPHEMERAL-KEY** | Stripe/PayPal mint a UUID `Idempotency-Key` / `PayPal-Request-Id` when the caller omits `idempotencyKey`. Crash retry mints a new key → duplicate capture/refund/void. Required (this pass, **Stripe only**): capture/refund/void (and Checkout create) require a caller `idempotencyKey` or keep the ephemeral key **only** for in-process `withRetry` and warn loudly. Prefer fail-closed on capture/refund/void without caller key (Paymob/Moyasar parity) if tests allow; otherwise warn + document. Do not silently mint on `createCheckoutSession` if **S19-CKO-TIMEOUT** now returns indeterminate. `createPayment` may keep ephemeral + warn. PayPal mint is **unowned** this pass. | A (Stripe) |
| **S19-CLOCK-LEASE** | Adapters never use SQL `NOW()` / Redis `TIME`. Soft-release on `get()` **clears `lease_token`** when *this* process clock thinks the lease is due. A fast host steals a 30s lease; original `complete` is `lease_lost` after the handler already ran. Required: do not wipe tokens on `get()` using a caller/injected now that can diverge. Soft-release only from the store’s own clock on list/claim paths, or remove mutative soft-release from `get()`. DO recon `listDue` must not wipe with Worker `now` against isolate-issued leases. Keep FakeClock testability — do **not** switch all SQL to `NOW()` if that breaks injected clocks. Test: `get()` does not clear an unexpired-to-issuer lease. | F |
| **S19-CLAIM-DUE** | `processDue` claims immediately before each handler. `claimDue` still `Promise.all`s every listed claim. README shows the bulk loop. Default 30s lease + serial work → peer steal. Required: `claimDue` claims one-at-a-time **or** README / types tell hosts to use `processDue` only. Prefer one-at-a-time. | E |
| **S19-RECON-HB** | Webhook handlers renew on `leaseMs/3`. Recon `processDue` never renews. Hang counter parks to `manual_review` at `maxAttempts` even when last disposition was `retry_later`. Required: auto-renew on `leaseMs/3` while the handler runs. Do not count same-worker lease-lost hangs against the `retry_later` budget. | E |
| **S19-FINGERPRINT** | `fingerprintParams` is `stableStringify`, documented as a hash, persisted by stores (PII / billing). Required: store `sha256Hex(stableStringify(redact(stripAbortSignal(value))))` (or equivalent). Keep stringify for canonicalization tests. Update tests that compare raw stringify equality of stored fingerprints. Economically identical params must still collide. | G |
| **S19-EXAMPLE-BIND** | `findOrderForEvent` binds metadata `orderId` before `gatewayPaymentId`. Create charges `mock`; a Stripe webhook with matching metadata fulfills. `fulfill()` never writes the webhook PI. Required: fulfill only when `gatewayPaymentId` matches (or bind PI first). `fulfill()` should record `gatewayPaymentId` from the webhook when missing. | H |
| **S19-EXAMPLE-RECON** | `POST /internal/reconcile` is unauthenticated and unlabeled. Required: auth or omit `/internal/reconcile` like provider-paid — labeled test-only and/or rejected without a test hook flag. | H |
| **S19-EXAMPLE-AMOUNT** | `snapshotForOrder` copies **order.amount** onto the provider snapshot. Client-posted `trustedAmount` is charged. Required: build provider snapshots from `getPayment` money. Rename/stop charging untrusted client amounts in the example (server-side amount). | H |
| **S19-DOCS-SUCCESS** | `successFromOutcome` includes `requires_action` (keep). Core README / `index.ts` JSDoc still say fulfill from `event.status` / `updatePaymentStatus(event.paymentId, event.status)`. Required: samples use `isPaidOutcome` / `status === "paid"` + inbox. Never `if (result.success) fulfill()`. | G |

### Nits (same pass if cheap)

| ID | One-line | Stream |
| --- | --- | --- |
| **S19-SHA256-LEN** | Public `sha256` only writes low 32 bits of bit-length (`crypto-portable.ts`). Set high word. Webhook HMAC unchanged for small bodies. | G (optional) |
| **S19-RECON-PAN** | Recon sanitize still omits 13–19 digit PAN runs (webhook sanitize has them). Honesty only — recon sanitize, not webhooks. | G (optional) |
| **S19-SQLITE-ENGINES** | `store-sqlite` engines say `node: >=18` while `/node` needs 22.5+. Docs/`package.json` only if F already touches that package README. | F (optional) |
| **S19-CKO-UNEXPANDED** | Classic Checkout string PI stays `paid` without refund rematch (related to **S19-STRIPE-LATE-REFUND** / **S19-CKO-GET**). | A (related) |

### Out of scope for this pass

Do not spend this pass on: Stripe secret rotation (`webhookSecrets: string[]`), Moyasar token-in-body protocol, 0.x major-unit `number` results, `test:coverage` core-only, labeled `/internal/provider-paid` (already closed as **I16**), PayPal ephemeral `PayPal-Request-Id` mint (Stripe half of **S19-EPHEMERAL-KEY** only).

---

## Stream ownership

Non-overlapping file ownership from `paykernel-session-audit-r7-fix-gate.rhai`. Streams must not edit another stream's files. Shared IDs are split by path, not by “whoever gets there first.”

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE + BASE HOOKS | `packages/core/src/gateways/base.gateway.ts`, `packages/core/src/gateways/base.gateway.test.ts`, `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | **S19-CKO-TIMEOUT**, **S19-STRIPE-LATE-REFUND**; should-fix **S19-CKO-AMOUNT**, **S19-CKO-GET**, **S19-STRIPE-CHARGE-SWALLOW**, **S19-STRIPE-DISPUTE**, **S19-EPHEMERAL-KEY** (Stripe only); nit **S19-CKO-UNEXPANDED** |
| **B** | PAYMOB GATEWAY | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | **S19-PAYMOB-JSON**, **S19-PAYMOB-REDIR-STATUS**, **S19-PAYMOB-REFUND-UNPAID**; should-fix **S19-PAYMOB-LEGACY-ID** |
| **C** | CORE MAPPER | `packages/core/src/types/webhook-event-map.ts`, `packages/core/src/types/payment-event.test.ts` if mapper tests live there | **S19-MAP-REFUND-PENDING** |
| **D** | WEBHOOKS ENGINE | `packages/webhooks/src/**`, `packages/webhooks/docs/**` if needed | **S19-WH-HASH-TOCTOU** |
| **E** | RECONCILIATION SCHEDULER | `packages/reconciliation/src/scheduler.ts`, `packages/reconciliation/src/scheduler.test.ts`, `packages/reconciliation/README.md` | **S19-CLAIM-DUE**, **S19-RECON-HB** |
| **F** | STORE LEASE CLOCK | `packages/store-postgres/src/stores/**`, `packages/store-sqlite/src/stores/**`, `packages/store-turso/src/stores/**`, `packages/store-d1/src/stores/**`, `packages/store-redis/src/scripts/**` GET/list soft-release only, `packages/store-durable-objects/src/stores/**` `listDue` now-wipe, matching unit tests | **S19-CLOCK-LEASE**; optional nit **S19-SQLITE-ENGINES** |
| **G** | FINGERPRINT + CORE SAMPLES | `packages/core/src/utils/idempotency.ts`, `packages/core/src/utils/utils.test.ts` and money/idempotency tests that assert fingerprint strings, `packages/core/src/index.ts` (JSDoc sample only), `packages/core/README.md` webhook sample; optional `packages/core/src/runtime/crypto-portable.ts` (**S19-SHA256-LEN**), `packages/reconciliation/src/sanitize.ts` (**S19-RECON-PAN** only) | **S19-FINGERPRINT**, **S19-DOCS-SUCCESS**; optional **S19-SHA256-LEN**, **S19-RECON-PAN** |
| **H** | EXAMPLES | `examples/**` | **S19-EXAMPLE-BIND**, **S19-EXAMPLE-RECON**, **S19-EXAMPLE-AMOUNT** |
| **J** | AUDIT BOOKKEEPING | `docs/audits/**` | this file (bookkeeping only) |

No Stream **I**. No stream owns `packages/core/src/client.ts`, PayPal / Moyasar gateways, `packages/routing/**`, `packages/observability/**`, or `packages/testkit/**` this pass. Stream **A** owns `base.gateway.ts` hooks this pass (needed for **S19-CKO-TIMEOUT**); that is not a license to edit other providers.

### Ownership fences (do not cross)

- **A** must not edit Paymob, PayPal, Moyasar, `webhook-event-map.ts`, `client.ts`, the webhooks package, or stores. **S19-EPHEMERAL-KEY** is Stripe capture/refund/void (+ Checkout create) only. Do **not** undo C1.
- **B** must not edit `webhook-event-map.ts` (**C** owns **S19-MAP-REFUND-PENDING**). **B** must not edit the webhooks package (**D**). Mutations keep `requireMutation*` indeterminate on HTTP 200 missing `success`/`id`.
- **C** must not edit gateways or `client.ts`. **S19-MAP-REFUND-PENDING** is `mapPaymobFromFlags` / `mapPaymobStatusOnly` only.
- **D** must not edit `examples/**` (**H**). **D** must not edit store adapters (**F**) or gateways.
- **E** must not edit store adapters (**F**) or webhooks. **S19-CLAIM-DUE** / **S19-RECON-HB** are scheduler + README only.
- **F** must not edit `sql-foundation` claim UPSERT templates unless required to stop `get()` wipe. **F** must not edit the reconciliation scheduler (**E**). Do **not** switch all SQL comparisons to `NOW()` if that breaks FakeClock.
- **G** must not edit gateways, stores, examples, or the webhooks engine. **S19-RECON-PAN** is recon `sanitize.ts` only — do not touch webhook sanitize (**D**).
- **H** must not edit `packages/*`.
- **J** must not edit production `src` / `packages/**`.
- Prefer existing `PaymentStatus` values. Fail-closed on incomplete money. Never convert an uncertain mutation outcome into a retryable failure that **clears** a fence. Always publish currency together with major-unit amount fields.

### Split / adjacent IDs

**S19-STRIPE-LATE-REFUND + S19-CKO-GET + S19-CKO-UNEXPANDED (A only)**

1. **S19-STRIPE-LATE-REFUND:** honor observable `charges.data` / expanded charge refunds on `PI.succeeded`. String `latest_charge` + `amount_received > 0` + no refund snapshot stays **C1 `paid`**.
2. **S19-CKO-GET:** `getCheckoutSession` must use the expanded PI (settled money + refund rematch).
3. **S19-CKO-UNEXPANDED (nit):** classic Checkout string PI without an expanded charge still cannot rematch refunds — document / fail-closed; do not invent a refund.

**S19-EPHEMERAL-KEY (A Stripe only)**

PayPal `PayPal-Request-Id` mint is the same class and is **out of scope** (no PayPal owner this pass).

**S19-WH-HASH-TOCTOU vs r6 I14**

r6 **I14** skipped when listed hash ≠ current idle hash at the post-list `get`. Residual is the **get → claim** window: claim with a stale hash can still supersede (WEBHOOKS-3). **D** must close that race; do not re-open I14’s original list-vs-get lie if it is gone.

---

## Recommended close (audit §)

1. S19-CKO-TIMEOUT  
2. S19-PAYMOB-JSON  
3. S19-PAYMOB-REDIR-STATUS  
4. S19-PAYMOB-REFUND-UNPAID  
5. S19-MAP-REFUND-PENDING  
6. S19-WH-HASH-TOCTOU  
7. S19-STRIPE-LATE-REFUND  
8. Should-fix pack (S19-PAYMOB-LEGACY-ID, S19-CKO-AMOUNT, S19-CKO-GET, S19-STRIPE-CHARGE-SWALLOW, S19-STRIPE-DISPUTE, S19-EPHEMERAL-KEY, S19-CLOCK-LEASE, S19-CLAIM-DUE, S19-RECON-HB, S19-FINGERPRINT, S19-EXAMPLE-BIND, S19-EXAMPLE-RECON, S19-EXAMPLE-AMOUNT, S19-DOCS-SUCCESS)  
9. Cheap nits (S19-SHA256-LEN, S19-RECON-PAN, S19-SQLITE-ENGINES, S19-CKO-UNEXPANDED)  

Items **1–7** are this pass’s ship gate (blocking). Item **8** is same-pass should-fix — gate may promote a leftover money / fulfillment / fence lie. Item **9** is optional if cheap.

---

## Already closed (do not re-open)

From session-audit r6 (2026-08-18) ship-gate and earlier leftover / ship-gates. Do **not** re-open unless current code still has the **original** lie.

**r6 blocking (closed):**

```
C1-STRIPE-PI-UNEXPANDED,
I1-PAYMOB-UNSIGNED-ACTION,
I2-PAYMOB-MUTATION-FENCE,
I3-PAYMOB-FLAGS-PENDING,
I4-REDIS-RESERVED-KEYS,
I7-EXAMPLE-RECON-BIND,
I8-HEX-TO-BYTES,
I9-BEHAVIORAL-CONTRACTS
```

**r6 should-fix (closed in original shape):**

```
I5-LEASE-HEARTBEAT, I6-DURABLE-ACK, I10-MISSING-SECRET-CLASS,
I11-WH-SANITIZE, I12-RECON-SANITIZE, I13-WH-PAYMOB-STATUS,
I14-STALE-HASH-SUPERSEDE, I15-DO-ENSURE-SCHEMA, I16-EXAMPLE-PROVIDER-PAID
```

**Earlier leftovers / ship-gates (still closed):**

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
| Session-audit **C1** / leftover **NEW-STRIPE-REFUND-0** (unexpanded PI + `amount_received` → `paid` unless *expanded* charge proves refund) | **S19-STRIPE-LATE-REFUND**: when a charge **is** observable (`charges.data` / expanded), refund rematch must still run; delayed `PI.succeeded` must not last-write `paid` over `charge.refunded`. Do **not** undo C1. |
| r6 **I3** `pending` before bare `success` | **S19-MAP-REFUND-PENDING**: refund arms (`hasAmountRefund` / `isRefunded` / `isRefund+success`) still rank above `pending`; `refund_pending` unmapped |
| r6 **I14** list hash vs later `get` (skip on mismatch) | **S19-WH-HASH-TOCTOU**: get → claim window can still supersede backwards with the stale `get` hash |
| r6 **I12** recon key-redact before stringify | **S19-RECON-PAN** (nit): recon still omits I11-class 13–19 digit PAN value leaves |
| r6 **I7** never bind `getLastProviderSideSuccess` | **S19-EXAMPLE-BIND**: metadata `orderId` still binds before `gatewayPaymentId`; Stripe fixture can fulfill a mock-charged order |
| r6 **I16** `/internal/provider-paid` labeled test hook | **S19-EXAMPLE-RECON**: `/internal/reconcile` still unauthenticated and unlabeled |
| r6 **I5** webhook lease heartbeat | **S19-RECON-HB**: recon `processDue` still never renews; **S19-CLOCK-LEASE**: `get()` still mutatively soft-releases on a caller clock |
| Code: `executeWithHooks` maps `afterProviderSubmit` → `indeterminate` for money mutations | **S19-CKO-TIMEOUT**: `createCheckoutSession` is still omitted from `isPostSubmitMoneyMutation` |

---

## Stream J / integrate status

Stream J wrote the ownership + residual checklist (no `packages/**` edits).

**Integrate (this update):** re-read current source, fixed parallel-stream TS, flipped tests that still locked S19-EPHEMERAL-KEY / WEBHOOKS-1 `get()` wipe, typecheck + required test set green. This file is **not** a formal gate pass (`session-audit-r7-fix-result-2026-08-19.md` is still unwritten).

**Verify (2026-08-19):**

| Check | Result |
| --- | --- |
| `bun run typecheck` | exit 0 (core through examples) |
| `bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples` | **2319 pass / 31 skip / 0 fail** |
| C1 | holds — unexpanded PI + `amount_received > 0` stays `paid` without a refund snapshot |

31 skips are live Postgres / Redis / better-sqlite3 (no server / optional engine). Do **not** commit. Do **not** push.

---

## What landed vs remaining (integrate, against current source)

### Blocking (ship gate) — original lies gone

| ID | Landed? | Current source |
| --- | --- | --- |
| **S19-CKO-TIMEOUT** | yes | `isPostSubmitMoneyMutation` includes `createCheckoutSession`. Post-submit `NetworkError` → checkout-shaped `{ success: false, outcome: "indeterminate", reconciliationRequired: true }` via `applyIndeterminateCheckoutSessionOutcome` (not payment `applyIndeterminatePaymentOutcome`). Empty/non-JSON mutating 200 is tagged `afterProviderSubmit` and takes the same path. `getCheckoutSession` still throws. Tests: POST timeout / empty 200 is not a retryable failed-create. |
| **S19-PAYMOB-JSON** | yes | `parseJson` never returns `{}`. Empty / invalid JSON → `GatewayApiError` (GET) or mutation indeterminate. `normalizeApiTransactionResponse` rejects bodies with no transaction signal. Tests: empty / HTML / `{}` HTTP 200 inquiry is not `declined`. |
| **S19-PAYMOB-REDIR-STATUS** | yes | `redirectEnvelopeStatus` demotes paid / authorized / partial / refunded → `processing` (matches `TRANSACTION_RESPONSE` dual-write). Redirect tests expect `status === "processing"`, not `"paid"`. |
| **S19-PAYMOB-REFUND-UNPAID** | yes | `assertInquiryAllowsMoneyAction` refuses pending / failed sales (`success: false` without captured money) before POST. Tests: refund/capture pending or failed sale → `InvalidRequestError`, no refund/capture URL. |
| **S19-MAP-REFUND-PENDING** | yes | `mapPaymobFromFlags` ranks `refund_pending` / `flags.pending` / status `pending`/`processing` **before** `hasAmountRefund` / `isRefunded` / `isRefund+success`. `mapPaymobStatusOnly` maps `refund_pending` → `refund.pending`, `refund_failed` → `refund.failed`. Flags-only test: `pending+success+isRefund` is `payment.processing`. |
| **S19-WH-HASH-TOCTOU** | yes (engine + memory) | `processRetryable` re-reads before claim (I14) and claims with `ifMatchPayloadHash` = listed hash. Memory store returns `payload_hash_conflict` (no rewrite) on miss. Test: listed `hash-a` + idle `hash-b` at claim time stays `hash-b`. **Residual:** durable adapters (`store-contracts` `ClaimWebhookInput`, SQL/Lua/DO) ignore `ifMatchPayloadHash` — a get→claim idle supersede can still roll backwards on those stores. |
| **S19-STRIPE-LATE-REFUND** | yes | Observable `charges.data` / expanded charge rematch via `stripeChargeSnapshotForRefundStatus`. `payment_intent.succeeded` + `amount_refunded` is not `paid`. **C1 unchanged:** string / id-only `latest_charge` + `amount_received > 0` + no snapshot stays `paid`. |

### Should-fix — original lies gone

| ID | Landed? | Current source |
| --- | --- | --- |
| **S19-PAYMOB-LEGACY-ID** | yes | Legacy create `gatewayId` is `legacy:{orderId}`, not the numeric order id. Mutations still require webhook/dashboard `obj.id`. |
| **S19-CKO-AMOUNT** | yes | Hydrated Checkout publishes settled PI `amount_received` (not always `amount_total`). |
| **S19-CKO-GET** | yes | `getCheckoutSession` rematches expanded PI refunds / settled money. |
| **S19-STRIPE-CHARGE-SWALLOW** | yes | GET `/charges` 401/429/5xx propagate; unobservable / 404 stay fail-closed `processing`. |
| **S19-STRIPE-DISPUTE** | yes | `charge.dispute.*` uses `stripeDisputeEnvelopeStatus` (native dispute status or `processing`) — not generic payment `pending`. Dual-write stays `dispute.*`. |
| **S19-EPHEMERAL-KEY** | yes (Stripe) | capture / refund / void / `createCheckoutSession` require caller `idempotencyKey`. Client tests no longer mint-by-omission. PayPal mint still out of scope. |
| **S19-CLOCK-LEASE** | yes | Durable `get()` is read-only (does not clear `lease_token`). Soft-release stays on list/claim. Tests: get does not wipe an unexpired-to-issuer lease. WEBHOOKS-1 conformance accepts read-only get; `listRetryable` still restores attempts. |
| **S19-CLAIM-DUE** | yes | `claimDue` / `processDue` claim one-at-a-time. README tells hosts to prefer `processDue`. |
| **S19-RECON-HB** | yes | `processDue` auto-renews on `leaseMs/3`. Same-worker hang after expiry does not park `retry_later` against the budget. |
| **S19-FINGERPRINT** | yes | `fingerprintParams` persists `sha256Hex(stableStringify(redact(stripAbortSignal)))`. Stringify kept for canonicalization tests. |
| **S19-EXAMPLE-BIND** | yes | `findOrderForEvent` requires webhook PI; metadata `orderId` cannot fulfill a mock-charged order with a different stored PI. `fulfill()` records missing `gatewayPaymentId`. |
| **S19-EXAMPLE-RECON** | yes | `/internal/reconcile` is a labeled test hook; 404 without `enableTestHooks`. |
| **S19-EXAMPLE-AMOUNT** | yes | Catalog / `getPayment` money only. No `trustedAmount`; `snapshotForOrder` does not copy `order.amount`. |
| **S19-DOCS-SUCCESS** | yes | Core README / `index.ts` samples use `isPaidOutcome` / `event.status === "paid"` + inbox. Never `if (result.success) fulfill()`. |

### Nits

| ID | Landed? | Notes |
| --- | --- | --- |
| **S19-SHA256-LEN** | yes | Public `sha256` writes high 32 bits of bit-length. |
| **S19-RECON-PAN** | yes | Recon sanitize redacts 13–19 digit PAN runs. |
| **S19-SQLITE-ENGINES** | **no** | `store-sqlite` `package.json` `engines.node` is still `>=18`. README already says `/node` needs 22.5+. |
| **S19-CKO-UNEXPANDED** | remaining by design | Classic Checkout string PI + `payment_status: paid` stays `paid` without refund rematch (no invented refund). Related to C1. |

### Integrate-only fixes (not residual IDs)

- Paymob `parseJson`: `return failClosed(...)` so TS sees a definite `never` (TS2366).
- Example handlers: `reconcile()` is `async`; kernel scripts accept `readonly` arrays; custom mock `getPayment` results include `rawResponse`.
- Client / createPaymentClient Stripe capture/refund/void tests pass `idempotencyKey` (S19-EPHEMERAL-KEY).
- Testkit WEBHOOKS-1 conformance: `get()` may be read-only; `listRetryable` remains the store-clock restore path.

### Remaining for gate / later

- **Durable `ifMatchPayloadHash`:** webhooks memory honors compare-and-claim; postgres / sqlite / redis / DO / `store-contracts` do not. Engine skip-on-get-mismatch is I14; the get→claim window on durable stores is the leftover S19 class.
- **S19-SQLITE-ENGINES** package.json engines line.
- **S19-CKO-UNEXPANDED** (nit / honesty: no charge snapshot ⇒ no rematch).
- Formal gate artifact `session-audit-r7-fix-result-2026-08-19.md` is **not** this file.
- Out of scope unchanged: Stripe `webhookSecrets[]`, Moyasar token-in-body, PayPal ephemeral `PayPal-Request-Id`, 0.x major-unit `number` results, `test:coverage` core-only.

**Working tree:** uncommitted. Do **not** commit. Do **not** push.

---

## Residual ID checklist (copy for critic / gate)

Integrate flipped these against current source. Do **not** treat checked boxes here as a formal gate pass.

### Blocking (ship gate)

- [x] S19-CKO-TIMEOUT
- [x] S19-PAYMOB-JSON
- [x] S19-PAYMOB-REDIR-STATUS
- [x] S19-PAYMOB-REFUND-UNPAID
- [x] S19-MAP-REFUND-PENDING
- [x] S19-WH-HASH-TOCTOU (engine + memory; durable ifMatch residual)
- [x] S19-STRIPE-LATE-REFUND

### Should-fix

- [x] S19-PAYMOB-LEGACY-ID
- [x] S19-CKO-AMOUNT
- [x] S19-CKO-GET
- [x] S19-STRIPE-CHARGE-SWALLOW
- [x] S19-STRIPE-DISPUTE
- [x] S19-EPHEMERAL-KEY (Stripe only)
- [x] S19-CLOCK-LEASE
- [x] S19-CLAIM-DUE
- [x] S19-RECON-HB
- [x] S19-FINGERPRINT
- [x] S19-EXAMPLE-BIND
- [x] S19-EXAMPLE-RECON
- [x] S19-EXAMPLE-AMOUNT
- [x] S19-DOCS-SUCCESS

### Nits

- [x] S19-SHA256-LEN
- [x] S19-RECON-PAN
- [ ] S19-SQLITE-ENGINES
- [ ] S19-CKO-UNEXPANDED

**Working tree:** uncommitted. Do **not** commit. Do **not** push.
