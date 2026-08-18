# Session-audit r6 fix-gate result (2026-08-18)

**Source of truth:** [`session-audit-2026-08-18.md`](./session-audit-2026-08-18.md)  
**Bookkeeping (not this verdict):** [`session-audit-r6-fix-pass-2026-08-18.md`](./session-audit-r6-fix-pass-2026-08-18.md)  
**Workflow:** `.grok/workflows/paykernel-session-audit-r6-fix-gate.rhai`  
**Method:** adversarial re-read of current source (`read_file` / `grep`). Implement/integrate summaries were not treated as evidence.

| Field | Value |
| --- | --- |
| `final_pass` | **true** |
| `typecheck_ok` | **true** — `bun run typecheck` exit 0 (core through examples) |
| `tests_ok` | **true** — `bun test packages/core packages/webhooks packages/reconciliation packages/store-redis packages/store-durable-objects examples` → **2111 pass / 16 skip / 0 fail** |
| `invariants_ok` | **true** — C1, I1, I2, I3, I4, I7, I8, I9 hold in source |
| `gate_pass` | **true** |
| `gate_summary` | Adversarial source re-read: C1 I1 I2 I3 I4 I7 I8 I9 are closed; typecheck green; 2111 pass / 16 live-Redis skip / 0 fail. Should-fix I5 I6 I10–I16 do not leave money/fulfillment lies. Only residual is recon sanitize missing some I11 secret leaves. |
| `implement_ok` / `implement_fail` | **9 / 0** |

16 skips are live Redis integration tests (no Redis server). Isolated WAL flake was not in this set.

---

## Blocking

*(empty — no ship-gate leftovers)*

---

## Non-blocking residual

- **I12-RECON-SANITIZE:** `sanitizeReconciliationError` key-redacts known secret keys on plain objects **before** `JSON.stringify`. The original raw-stringify lie is gone. Residual: recon `SECRET_PATTERNS` still omits I11 value leaves (`cs_live_` / `cs_test_`, `csk_`, typed `pi_`/`seti_…_secret_…`, PayPal `A21AA…`, PAN digit runs). Honesty only — not a money or fulfillment map.

---

## What was fixed vs remaining

### Blocking ship-gate (8 IDs) — all closed

#### C1-STRIPE-PI-UNEXPANDED — fixed

`succeededPaymentIntentWebhookStatus` no longer returns `processing` because `latest_charge` is a string id. Refund status is taken only from an *observable* expanded charge (`stripeChargeSnapshotForRefundStatus` ignores string / id-only refs). Settled money is `resolveStripeCapturedMinor` (`amount_received` first). Missing settled → `processing`; finite settled `< amount` → `partially_captured`; otherwise `paid`.

Happy-path `payment_intent.succeeded` fixture includes `latest_charge: "ch_123"` + `amount_received: 1000` and expects `paid`. STRIPE-2 unexpanded + `amount_received` expects `paid` / `payment.succeeded`; unexpanded without received stays `processing`.

**Not C1:** Checkout Session hydration (`stripeCheckoutPaidSessionStatus`) still fail-closes unexpanded `latest_charge` to `processing`. Unused `{ unexpandedCharge }` option is dead (callers pass `"ignore"`). Neither reintroduces the default-PI webhook lie.

#### I1-PAYMOB-UNSIGNED-ACTION — fixed

`sanitizeWebhookTransactionForStatus` deletes `is_refund` / `is_void` when `is_refunded` / `is_voided` is present (true **or** false). Transaction and redirect parse both sanitize before `mapTransactionStatus` / `paymobMapContextFromTransaction`. HMAC still binds `is_refunded ?? is_refund` (verify only). Tests: forged `is_refund: true` + signed `is_refunded: false` stays `paid`, not `refund_completed` (including `has_parent_transaction`).

#### I2-PAYMOB-MUTATION-FENCE — fixed

`capturePayment` / `refundPayment` / `voidPayment` go through `runIdempotentMutation` **before** `executeIdempotent`. Missing store, missing key, or store without `reserve()` throws `InvalidRequestError` and does not POST (`fetchCalls.length === 0`). Create/get/webhook stay unfenced. `executeIdempotent` still runs the executor when a key is omitted — only create uses that path.

#### I3-PAYMOB-FLAGS-PENDING — fixed

`mapPaymobFromFlags`: `flags.pending === true` → `payment.processing` **before** bare `flags.success === true` → `payment.succeeded`. `payment-event.test.ts` I3: flags `success+pending`, no status → `payment.processing`. Built-in `mapTransactionStatus` still ranks `pending` first so status-first dual-write stays safe.

#### I4-REDIS-RESERVED-KEYS — fixed

`recordKey` / `assertLogicalKey` reject exact `due` / `retry` / `retain`. Idempotency / inbox / recon writes go through `recordKey`. Indexes stay `…:recon:due` / `…:whinbox:retry` / `…:retain`. `RedisKeyDesignError` maps to `StoreInvalidSchemaError`. Entrypoint mocks: `schedule({ key: "due" })` / `claim({ key: "retry" })` / `reserve({ key: "retain" })` throw without EVAL.

#### I7-EXAMPLE-RECON-BIND — fixed

Checkout kernel never calls `getLastProviderSideSuccess()`. Missing `gatewayPaymentId` → lookup `unavailable`. Any `NetworkError` (tagged or not) keeps the order and schedules recon; `err.message` is not copied into the HTTP body. Tests lock cross-order bind and untagged NetworkError keep-order.

#### I8-HEX-TO-BYTES — fixed

Public `hexToBytes` rejects odd length and non-hex nibbles (`hexNibble`, no pad, no `parseInt`). Tests: `"abc"` length; `"0g"` / `"ag"` / `"0G"` character.

#### I9-BEHAVIORAL-CONTRACTS — fixed

`behavioral-contracts.md` matches `executeWithHooks`: post-submit `NetworkError.afterProviderSubmit` → `outcome: 'indeterminate'` + `reconciliationRequired` (not a thrown failed-create). Moyasar (and Paymob) capture/refund/void **require** store + `reserve()` + key and never run unguarded. Pre-submit / GET still throw `NetworkError`.

### Should-fix (same pass, 9th implement item) — original lies gone

None promoted to blocking. None left in the original money/fulfillment-lie shape.

| ID | Gate read |
| --- | --- |
| **I5-LEASE-HEARTBEAT** | `runHandlerUnderLease` auto-renews on `leaseMs/3`. Heartbeat `lease_lost` does not `complete` as owner. |
| **I6-DURABLE-ACK** | Engine: `ackAfterClaim` requires `workerGuaranteed: true` (constructor throw or retryable `handler_failed`, never parked). Example: all `scheduled_for_retry` → **503**. |
| **I10-MISSING-SECRET-CLASS** | Engine classifies missing `webhookSecret` / `hmacSecret` / `webhookId` as retryable config, not forgery. Stripe `verifyWebhook` throws `InvalidRequestError`. `handleWebhook` rethrows that error (example does not 400-ACK it). |
| **I11-WH-SANITIZE** | `sanitize.ts`: `cs_live_` / `cs_test_`, `csk_`, `pi_`/`seti_…_secret_…`, PayPal `A21AA…`, PAN digit runs, object-key redaction. |
| **I12-RECON-SANITIZE** | Redacts known secret **keys** on plain objects before `JSON.stringify`. Original raw-stringify lie is gone. Residual: recon pattern set still omits some I11 leaves (`cs_live_` / `csk_` / typed PI secrets / `A21AA` / PAN) — honesty only, not a money map. |
| **I13-WH-PAYMOB-STATUS** | `extractInboxDomainStatus` prefers nested `refund.status` then `payment.status`; top-level WebhookEvent `status: paid` does not qualify when a nested event/entity exists. Redirect still ignores status. |
| **I14-STALE-HASH-SUPERSEDE** | `processRetryable` re-reads; listed hash ≠ current hash → skip (no claim with stale hash). Test: `hash-a` list + `hash-b` idle stays `hash-b`. |
| **I15-DO-ENSURE-SCHEMA** | `readyStores` always `ensureCachedSchema` (including omitted `tableNamespace`). Migrate errors fail closed (no INSERT). |
| **I16-EXAMPLE-PROVIDER-PAID** | Route remains unauthenticated **and is labeled** test hook / do not deploy (kernel JSDoc, handlers, host apps, READMEs). |

### Remaining (not ship-blockers)

- Formal prior bookkeeping file must not be read as a gate pass; this file is the gate artifact.
- Checkout Session unexpanded `latest_charge` → `processing` remains STRIPE-CKO-1, not C1.
- `succeededPaymentIntentWebhookStatus` still accepts unused `{ unexpandedCharge }`.
- Live Redis conformance remains skipped without a server (16 skips).
- Recon sanitize value-level I11 leaves (see non-blocking residual).
- Out of scope unchanged: client/injected lease clock vs DB `NOW()`, Stripe secret rotation, Moyasar token-in-body, 0.x major-unit `number` results, `test:coverage` core-only.

**Working tree:** uncommitted session-audit (r6) diffs. Do **not** commit. Do **not** push.
