# Session audit 2026-08-18

Deep review findings to critic → fix → verify → gate. Do not treat this file as proof — re-read the cited code.

## Blocking (must fix)

### C1-STRIPE-PI-UNEXPANDED

Default Stripe `payment_intent.succeeded` snapshots send `latest_charge` as a string id plus `amount_received`. `succeededPaymentIntentWebhookStatus` returns `processing` before reading settled money. The happy-path test omits `latest_charge` (not what Stripe sends). `STRIPE-2` test locks the lie.

- `packages/core/src/gateways/stripe/stripe.gateway.ts` ~3250–3264
- `packages/core/src/gateways/stripe/stripe.gateway.test.ts` ~217–241 and ~1871–1895

**Required:** if `amount_received` is finite and `> 0`, map to `paid` unless an *expanded* charge proves a refund. Keep `processing` only when settled money is missing. Flip the unexpanded+amount_received fixture to expect `paid`.

### I1-PAYMOB-UNSIGNED-ACTION

HMAC uses `is_refunded ?? is_refund`. Sanitize only drops `is_refund` when `is_refunded === true`. Forged `is_refund: true` next to signed `is_refunded: false` still verifies and maps to `refund_completed`. Same for `is_void` / `is_voided`.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` ~1466–1483, ~2094–2098, ~3418–3424
- tests ~3369–3425

**Required:** if signed current-state flag is present (true or false), ignore unsigned action alias on the webhook path.

### I2-PAYMOB-MUTATION-FENCE

`executeIdempotent` runs the POST when `idempotencyKey` is omitted. Moyasar throws. Paymob has no native mutation idempotency.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` ~2981–2989

**Required:** fail closed for capture/refund/void without store + atomic `reserve()` + key (parity with Moyasar).

### I3-PAYMOB-FLAGS-PENDING

`mapPaymobFromFlags` ranks bare `success` before `pending`. Built-in parse sets status first (safe). Public flags-only mapper can emit `payment.succeeded` for 3DS `success+pending`.

- `packages/core/src/types/webhook-event-map.ts` ~487–491

**Required:** `pending === true` → `payment.processing` before the bare success arm.

### I4-REDIS-RESERVED-KEYS

`recordKey(..., "recon", "due")` equals `reconciliationDueIndexKey`. Same for webhook `"retry"` and `"retain"`.

- `packages/store-redis/src/keys.ts` ~130–178

**Required:** reject reserved logical keys at write (`due`, `retry`, `retain`) or put indexes on a different segment.

### I8-HEX-TO-BYTES

Public `hexToBytes` pads odd length and `parseInt(..., 16)` accepts `"0g"` / `"ag"`. Not on the live webhook compare path (`timingSafeEqualHex`).

- `packages/core/src/runtime/crypto-portable.ts` ~62–79

**Required:** reject odd length and non-hex. Update tests.

### I9-BEHAVIORAL-CONTRACTS

`behavioral-contracts.md` still says post-submit timeouts throw `NetworkError` and Moyasar mutations run unguarded. Code maps `afterProviderSubmit` to `indeterminate` and Moyasar throws without store+reserve+key.

- `packages/core/docs/behavioral-contracts.md` ~60–68 and §1 Moyasar

**Required:** rewrite to match `executeWithHooks` + Moyasar fail-closed.

### I7-EXAMPLE-RECON-BIND

Checkout kernel binds `mock.getLastProviderSideSuccess()` onto an order with no `gatewayPaymentId`. Deletes the order on untagged `NetworkError`.

- `examples/checkout-kernel/src/kernel.ts` ~229–232, ~401–422

**Required:** never attach a global last-success. Keep the order and schedule recon on create `NetworkError`.

## Should-fix (same pass if ownership allows)

| ID | Issue | Path |
| --- | --- | --- |
| I5-LEASE-HEARTBEAT | 30s lease, no auto-renew during handler | `packages/webhooks/src/engine.ts` |
| I6-DURABLE-ACK | `scheduled_for_retry` parked → 200 without worker | engine + `examples/checkout-kernel/src/http-policy.ts` |
| I10-MISSING-SECRET-CLASS | missing webhook secret → verify false → 400 ACK | gateways + `packages/webhooks/src/engine.ts` classify |
| I11-WH-SANITIZE | no `cs_live_` / `pi_…_secret_` / PAN | `packages/webhooks/src/sanitize.ts` |
| I12-RECON-SANITIZE | `JSON.stringify(error)` no key redaction | `packages/reconciliation/src/sanitize.ts` |
| I13-WH-PAYMOB-STATUS | top-level `status: paid` suppresses refund key | `packages/webhooks/src/engine.ts` |
| I14-STALE-HASH-SUPERSEDE | `processRetryable` listed hash can overwrite newer idle body | webhook store + engine |
| I15-DO-ENSURE-SCHEMA | `readyStores` skips schema unless `tableNamespace` | `packages/store-durable-objects/src/object/payments-store-object.ts` ~189–197 |
| I16-EXAMPLE-PROVIDER-PAID | unauthenticated `/internal/provider-paid` | examples hosts + README |

## Out of scope for this pass

Client/injected lease clock vs DB `NOW()`, Stripe secret rotation, Moyasar provider token-in-body design, 0.x major-unit `number` results, `test:coverage` core-only.
