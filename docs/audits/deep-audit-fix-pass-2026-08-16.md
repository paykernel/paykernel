# PayKernel deep-audit fix pass (2026-08-16)

**Source of truth:** [`deep-audit-2026-08-16.md`](./deep-audit-2026-08-16.md)  
**Workflow:** `.grok/workflows/paykernel-audit-fix-gate.rhai`  
**This document:** Stream J bookkeeping — ownership map, residual-ID checklist, and integrate landed-vs-remaining.  
**Scope of this file:** `docs/audits/**` only. Does **not** claim a post-fix gate result (that is `deep-audit-fix-result-2026-08-16.md` after a formal gate).  
**Working tree:** uncommitted fix-stream diffs. Ship-gate items 1–7 are verified in-tree (see Integrate / verify).

**Audit verdict at pass start:** **SHIP_BLOCKED** (WEBHOOKS-1 P0 + six production money / status P1s).

Historical PP0–ST1 (31 IDs) stay **already fixed** and are **not residual**. Disputed list is empty.

---

## Residual inventory (from audit GATE)

Do not ship until **P0 + P1 blocking** are fixed and covered by tests that would have failed the audit.

### P0

| ID | One-line |
| --- | --- |
| **WEBHOOKS-1** | Inbox / dedupe key is `WebhookEvent.id`; Paymob redirect `TRANSACTION_RESPONSE` and processed `TRANSACTION` share the txn id, so a documented `payment.processing` ACK swallows later paid |

### P1 blocking

Production money / status lies on built-in default paths.

| ID | One-line |
| --- | --- |
| **CORE-1** | `inferRefundOperationOutcome` forges `failed` on uncertain `success:false` + `pending` → retry can double-refund |
| **STRIPE-1** | `refund.failed` / `pending` / `canceled` overwrite **payment** status instead of `refund_failed` / `refund_pending` |
| **STRIPE-2** | `payment_intent.succeeded` ignores charge refunds and dual-writes `paid` after money was returned |
| **PAYPAL-1** | `PAYMENT.CAPTURE.REFUNDED` fail-opens full `refunded` on refund-shaped resources |
| **PAYPAL-3** | `ORDER.COMPLETED` invents `paid` from `related_ids.capture_id` without nested captures |
| **PAYMOB-2** | Intention HTTP 200 missing id / checkout URL throws `GatewayApiError` and releases the create fence |

### P1 other

Confirmed residual / custom / recovery / perf holes. Not ship-blocking money lies on the built-in happy path; still in this pass.

| ID | One-line |
| --- | --- |
| **CORE-2** | After-hook composition forwards unfrozen money / identity to later handlers |
| **CORE-3** | `handleWebhook` treats a Promise from sync `verifyWebhook` as verified (fail-open) |
| **CORE-4** | `handleWebhook` safety-net accepts a 3-field `PaymentEvent` and skips incomplete-money demotes |
| **MONEY-1** | ISO 4217 table omits active JMD / XCG / XAD |
| **PAYMOB-1** | `is_refund` / `is_void` dropped when `is_refunded` / `is_voided` are present-and-false (residual; not confirmed live default) |
| **WEBHOOKS-2** | Missing durable payload / unrefusable snapshot classified `invalid_webhook` (forgery / 400) |
| **WEBHOOKS-3** | `processWithVerifier` treats gateway parse `InvalidWebhookError` as forgery unless message contains `parse failed` |
| **WEBHOOKS-4** | Inline claims store no `payloadRef`; durable `processRetryable` then dead-letters the paid row |
| **REDIS-1** | Webhook / recon renew leaves due / retry ZSET scored at the original lease expiry |
| **RECON-1** | `compareSnapshots` treats auth-hold `capturedAmount=0` vs `local.amount` as money drift |
| **RECON-2** | `mark_consistent` ignores capture / refund totals on determinate auth / partial statuses |
| **RECON-3** | `processDue` `maxAttempts` dead-letters in-flight `retry_later` settlement |
| **PERF-1** | Redis `listDue` / `listRetryable` SCAN + EVAL every record on every poll |
| **PERF-2** | SQL `listDue` / `listRetryable` unbounded UPDATE of all expired claimed rows |

### P2 pack

Honesty, docs, testkit, observability, secondary perf. None confirmed false-paid / double-refund on built-in default paths.

| ID | One-line |
| --- | --- |
| **CORE-5** | `applyOutcomeToGatewayResult` can persist `success:true` + `outcome:succeeded` with `failed` / `pending` status |
| **CORE-6** | Stable-name short-circuit ignores domain status when attaching `PaymentEvent` |
| **CORE-7** | Post-submit create / OTP abort / timeout indeterminate results use `gatewayId` `"unknown"` |
| **CORE-8** | Docs tell integrators to call `isPaidOutcome` on `WebhookEvent` (always false) |
| **MONEY-2** | `fingerprintParams` encodes `Date` as JSON ISO-8601 and collides with the same string |
| **MONEY-3** | `redact()` only matches whole-string PAN / secret leaves |
| **PAYPAL-2** | Docs say `PAYMENT.REFUND.COMPLETED` dual-writes `refund.completed`; code emits `refund.pending` |
| **PAYMOB-3** | HMAC-covered `error_occured` is never used in status mapping |
| **PAYMOB-4** | `webhook-events.md` says `is_capture` + success → `capture.completed`; gateway emits `processing` |
| **MOYASAR-1** | `payment_voided` webhooks are not fail-closed on residual paid / authorized snapshots |
| **MOYASAR-2** | `idempotencyStore` typed / documented optional but mutations throw without it |
| **MOYASAR-3** | Generic create types / JSDoc still advertise raw `creditcard` sources the adapter rejects |
| **WEBHOOKS-5** | Docs still lie about park `lease_lost`, inline `not_available`, and hash-source fallback |
| **SQLFOUND-1** | `atomic-claims.md` says webhook `payload_hash` mismatch is never an overwrite; adapters supersede idle hashes |
| **RECON-4** | `processDue` docs complete paid / failed without applying the local update |
| **ROUTE-1** | Complementary amount-split rules make select-time fallback always honesty-blocked |
| **TESTKIT-1** | Mock `capturePayment` settles money after void / failed / pending |
| **TESTKIT-2** | Mock capture / refund convert majors with caller currency, not payment currency |
| **TESTKIT-3** | `parseWebhookEvent` defaults missing type to `payment_paid` → `payment.succeeded` |
| **TESTKIT-4** | `paymentStatusToOperationOutcome` maps `refund_failed` (and unknown) to `succeeded` |
| **OBS-1** | OTEL bridge forwards `span.end()` `status.message` unsanitized |
| **OBS-2** | Allow-listed span keys leak Stripe `cs_live_` / client-secret values |
| **PKG-1** | sql-foundation root export includes test fakes whose executor always succeeds |
| **PERF-3** | SQL indexes are single-column; list / cleanup predicates cannot use them efficiently |
| **PERF-4** | Redis `listDue` / `listRetryable` is ZRANGE plus serial N+1 GET after the full SCAN |
| **PERF-5** | DO hash `listDue` / `listRetryable` fans out to all partitions times full limit |
| **PERF-6** | Webhook path parses, clones, stringifies, and SHA-256s the full payload multiple times |
| **PERF-7** | `processDue` / `processRetryable` list-then-serial-claim N+1 and 10× oversample |

**Counts:** 1 P0 + 6 P1 blocking + 14 P1 other + 28 P2 = **49 residual IDs**. Critic / implement streams skip any ID they prove already fixed against current code; this bookkeeping list is the audit residual set, not a landing score.

---

## Stream ownership

Non-overlapping file ownership. Streams must not edit another stream's files. Shared notes are called out.

| Stream | Label | Owns (paths) | Residual IDs |
| --- | --- | --- | --- |
| **A** | STRIPE | `packages/core/src/gateways/stripe/**`, `packages/core/docs/stripe.md` | STRIPE-1, STRIPE-2 |
| **B** | PAYPAL | `packages/core/src/gateways/paypal/**`, `packages/core/docs/paypal.md` | PAYPAL-1, PAYPAL-3, PAYPAL-2 |
| **C** | PAYMOB | `packages/core/src/gateways/paymob/**`, `packages/core/docs/paymob.md` | PAYMOB-2, PAYMOB-1, PAYMOB-3 |
| **D** | MOYASAR | `packages/core/src/gateways/moyasar/**`, `packages/core/docs/moyasar.md`, `packages/core/src/types/config.types.ts` (MoyasarConfig JSDoc only) | MOYASAR-1, MOYASAR-2, MOYASAR-3 |
| **E** | WEBHOOKS + `handleWebhook` | `packages/webhooks/src/**`, `packages/webhooks/docs/**`, `packages/webhooks/README.md`, `packages/core/src/client.ts`, `packages/core/docs/webhooks.md`, `packages/core/docs/webhook-events.md`; may tighten `packages/core/src/types/payment-event.ts` if CORE-4 needs it | WEBHOOKS-1, WEBHOOKS-2, WEBHOOKS-3, WEBHOOKS-4, CORE-3, CORE-4, WEBHOOKS-5, CORE-8, PAYMOB-4 |
| **F** | STORES + PERF + sql-foundation | `packages/store-redis/src/**`, `packages/store-postgres/src/**`, `packages/store-sqlite/src/**`, `packages/store-d1/src/**`, `packages/store-turso/src/**`, `packages/store-durable-objects/src/**`, `packages/sql-foundation/src/**`, `packages/sql-foundation/docs/**` | REDIS-1, PERF-1, PERF-2, PERF-3, PERF-4, PERF-5, SQLFOUND-1, PKG-1 |
| **G** | CORE + MONEY | `packages/core/src/types/operation-result.ts`, `webhook-event-map.ts`, `validation.ts` (if needed), `packages/core/src/hooks/**`, `packages/core/src/utils/currency.ts`, `idempotency.ts`, `logger.ts`, matching `*.test.ts`, `packages/core/src/gateways/base.gateway.ts`, `packages/core/docs/operation-results.md`, `packages/core/docs/money.md` | CORE-1, CORE-2, MONEY-1, CORE-5, CORE-6, CORE-7, MONEY-2, MONEY-3, PERF-6 (only if cheap in owned helpers) |
| **H** | RECON + ROUTING | `packages/reconciliation/src/**`, `packages/reconciliation/docs/**`, `packages/routing/src/**`, `packages/routing/docs/**` | RECON-1, RECON-2, RECON-3, RECON-4, ROUTE-1, PERF-7 |
| **I** | TESTKIT + OBS | `packages/testkit/src/**`, `packages/observability/src/**`, `packages/observability/docs/**` | TESTKIT-1, TESTKIT-2, TESTKIT-3, TESTKIT-4, OBS-1, OBS-2 |
| **J** | DOCS audit bookkeeping | `docs/audits/**` only | this file |

### Ownership fences (do not cross)

- **C** must not change inbox engine / `deriveWebhookEventKey`. C **may** type-qualify Paymob `event.id` (redirect vs processed) so WEBHOOKS-1 keys no longer collide; that half lives in Paymob-owned files. Engine + integrator docs stay **E**.
- **E** owns `client.ts` and (if needed) `payment-event.ts`. **G** must not edit those. **G** must not edit `config.types.ts` (**D**).
- **G** must not edit `stripe.gateway.ts` even for PERF-6.
- **J** must not edit `packages/**`.
- Built-in PaymentStatus values to prefer (do not invent new ones): `partially_captured`, `partially_refunded`, `refund_pending`, `refund_failed`, `refund_completed`, `setup_completed`, `paid`, `pending`, `processing`, `authorized`.

### WEBHOOKS-1 split (C + E)

1. **C (preferred half):** redirect `event.id` = `<txnId>:redirect` (or type-qualified); processed `TRANSACTION` keeps `obj.id`; `gatewayPaymentId` stays the signed txn id; update `paymob.md`.
2. **E:** if C did not change `event.id`, engine must not complete Paymob `payment.processing` as terminal **or** `deriveWebhookEventKey` must include notification class. Inbox test: same txn id, different type, must **not** be `already_completed`. Update `packages/webhooks/README.md` and `packages/core/docs/webhooks.md`.

---

## Recommended fix order (audit §)

1. WEBHOOKS-1 (P0) — C event identity + E inbox / docs.
2. CORE-1 — G (`inferRefundOperationOutcome` = P610-INF-2).
3. STRIPE-1 — A (`refund_failed` / `refund_pending`).
4. STRIPE-2 — A (read charge refund totals or fail-closed `processing`).
5. PAYPAL-1 — B (no default full `refunded`).
6. PAYPAL-3 — B (no invented COMPLETED capture).
7. PAYMOB-2 — C (Intention 200 missing id / URL keeps fence).
8. WEBHOOKS-2 / 3 / 4 — E.
9. CORE-3 / CORE-4 — E.
10. CORE-2 — G.
11. PAYMOB-1 (residual) — C.
12. REDIS-1 + RECON-1/2/3 — F + H.
13. MONEY-1 — G.
14. PERF-1 / PERF-2 — F.
15. P2 pack — remaining stream IDs above.

Items **1–7** are the ship gate.

---

## Already fixed (not residual)

From audit historical recheck. Do **not** re-open as this-pass IDs.

```
PP0 PP1 PP2 PP3 PP4 PP5 PP6
S1 S2 S3 S4 S5 S6 S7
PM1 PM2 PM3
M1 M2 M3 M4
C1 C2 C3 C4 C5 C6 C7
R1 W1 ST1
```

These 31 defects are already fixed in current `packages/core` (and routing / webhooks / store for R1 / W1 / ST1). New 2026-08-16 IDs are leftover classes adjacent to those fixes, not regressions of the original 31.

Severity revisions already applied in the audit (kept):

- PAYMOB-1: initially P0 → **P1 residual** (not confirmed live default; official `is_refunded: true`).
- PERF-1: initially P0 → **P1 non-blocking** (poll stall, not a money-integrity lie).
- PAYPAL-3: stream-labeled P2 → **P1 blocking** (`ORDER.COMPLETED` invents paid).
- TESTKIT-1/2/3: stream-labeled P1 → **P2** (mock trains false invariants).

---

## Stream J status

Wrote this ownership + residual checklist. Integrate pass (below) did **not** edit `packages/**`; only this bookkeeping file.

**fixed_ids (this stream):** none — J is bookkeeping only.

---

## Integrate / verify (2026-08-16)

Uncommitted parallel-stream tree. **No commit.** Typecheck + requested tests are green; ship-gate items **1–7** are present in code and covered by tests that would have failed the audit.

### Verify

```
VERIFY: typecheck_ok=true tests_ok=true ok=true
tests=2611 pass / 35 skip / 0 fail / 154 files / 10.88s
```

- Monorepo `bun run typecheck`: all 15 workspace packages exit 0. No merge-conflict markers; no TS breaks from the parallel streams.
- `bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso`: **2611 pass, 0 fail**. Known sql-foundation bun:sqlite multi-connection WAL flake did **not** fire. 35 skips are live-adapter integration (postgres / redis / turso / better-sqlite3).

This file is still **not** a post-gate result. Gate write-up remains `deep-audit-fix-result-2026-08-16.md` after a formal gate run.

### Ship-gate invariants (items 1–7) — landed

| ID | Landed as | Evidence |
| --- | --- | --- |
| **WEBHOOKS-1** | Redirect vs processed no longer share an inbox key | Paymob `event.id` = `{txnId}:redirect` on `TRANSACTION_RESPONSE` (`gatewayPaymentId` stays raw txn id). Engine `deriveWebhookEventKey(paymob, id, notificationClass)` → `paymob:{TRANSACTION\|TRANSACTION_RESPONSE}:{txnId}`. Tests: `paymob.gateway.test.ts` qualifies ids; `engine.test.ts` “WEBHOOKS-1 Paymob redirect then processed is not duplicate_completed” — both run, processed is **not** `already_completed` / `duplicate_completed`. |
| **CORE-1** | Uncertain refund pending is indeterminate | `inferRefundOperationOutcome`: `success:false` (or omitted success) + `pending`/`processing`/`approved` → `indeterminate`, not `failed`. Test: `operation-result.test.ts` “P610-INF-2 / CORE-1”. |
| **STRIPE-1** | Refund entity status, not payment failed | `mapStripeRefundWebhookStatus`: `failed`/`canceled` → `refund_failed`; in-flight → `refund_pending`. Tests: `refund.failed` / canceled / pending webhook cases. |
| **STRIPE-2** | Succeeded PI reads charge refunds; unexpanded charge fail-closes | `succeededPaymentIntentWebhookStatus` maps `amount_refunded` / `refunded` to `refunded`/`partially_refunded`; unexpanded `latest_charge` id → `processing` (not `paid`). Tests: “STRIPE-2: payment_intent.succeeded with amount_refunded is not paid”. |
| **PAYPAL-1** | Refund-resource CAPTURE.REFUNDED is not full refunded | `mapWebhookStatus('PAYMENT.CAPTURE.REFUNDED')` only takes capture `REFUNDED`/`PARTIALLY_REFUNDED`; refund-shaped `COMPLETED` fail-closes to `partially_refunded` and omits this-op face. Test: “CAPTURE.REFUNDED refund-resource COMPLETED partial amount is not full refunded”. |
| **PAYPAL-3** | Capture id string is not settlement | `ORDER.COMPLETED` maps nested captures only; `related_ids.capture_id` without `purchase_units[].payments.captures` → `processing`, not `paid`. Tests assert status + `isPaidOutcome === false`. |
| **PAYMOB-2** | Intention HTTP 200 missing id/URL keeps fence | `requireMutationString` throws `PaymobIndeterminateResponseError`; retry with same `idempotencyKey` refuses a second POST. Tests: empty id / missing checkout URL keep fence (`fetchCalls.length === 1`). |

Old tests that locked the lies were flipped (Stripe refund.* / PI refunded, PayPal refund-resource / capture_id-only, Paymob Intention 200, inbox redirect→processed). Remaining `status === "paid"` / `"failed"` expects are happy-path snapshots, not the blocking holes.

### Other residual IDs — landed (not ship-blocking)

Streams also closed the rest of the residual inventory except the leftovers below.

- **P1 other:** CORE-2 (money-identity freeze between composed after-hooks), CORE-3 (await/boolean-check Promise `verifyWebhook`), CORE-4 (thin 3-field `PaymentEvent` rebuilt + demoted), MONEY-1 (JMD / XCG / XAD in ISO tables), PAYMOB-1 (`is_refund`/`is_void` kept when current-state present-and-false; `has_parent_transaction` used), WEBHOOKS-2/3/4 (missing durable / parse `InvalidWebhookError` are retryable `handler_failed`, not `invalid_webhook`; inline stores `payloadRef`), REDIS-1 (renew ZADDs due/retry), RECON-1/2/3 (auth-hold compare, capture/refund totals on determinate statuses, `retry_later` not dead-lettered at default `maxAttempts`), PERF-1 (SCAN is repair-only, not poll), PERF-2 (SQL expired-lease UPDATE bounded to list limit).
- **P2 pack (closed):** CORE-5/6/7/8, MONEY-2/3, PAYPAL-2 (docs now say `refund_completed` + dual-write `refund.pending`), PAYMOB-3 (`error_occured` → `failed`), PAYMOB-4 (`webhook-events.md` matches `processing`), MOYASAR-1/2, WEBHOOKS-5, SQLFOUND-1 (`atomic-claims.md` documents idle-hash supersede), RECON-4 (scheduling docs require applying the local update), ROUTE-1 (**intentional fail-closed** + documented `NoRouteMatchError` for complementary amount-split), TESTKIT-1/2/3/4, OBS-1/2, PKG-1 (`createFakeExecutor` moved to `./testing.ts`), PERF-3 (composite list/cleanup indexes), PERF-4 (poll is ZRANGE + keyed GET; SCAN not on the list path). PERF-7 oversample cap is **200** (was up to 1000).

### Remaining (not ship-blocking)

| ID | Status |
| --- | --- |
| **PERF-5** | Still hash-partition fan-out: `listDue`/`listRetryable` wake every enumerable DO isolate. Bounded per-shard UPDATE (PERF-2); no cheaper correct global earliest-`limit` without a global index. |
| **PERF-6** | Webhook path still parse/clone/stringify/SHA-256s large Stripe bodies more than once. Not touched (G must not edit `stripe.gateway.ts`). |
| **PERF-7** | Still list-then-serial-claim N+1. Oversample reduced (3× / +16, cap 200) when `maxInFlightByGateway` is set; default 10 stays 10. |
| **MOYASAR-3** | Adapter + `moyasar.md` reject raw `creditcard` before HTTP. Generic `CreatePaymentParams.moyasarSource` JSDoc in `payment.types.ts` still says “Supports: creditcard, …”. Type-check then fail-closed; no card-data leak. |

Historical PP0–ST1 stay already fixed. Disputed list is still empty.

**Ship gate:** items 1–7 are fixed and tested. Formal gate artifact is still outstanding (`deep-audit-fix-result-2026-08-16.md`).
