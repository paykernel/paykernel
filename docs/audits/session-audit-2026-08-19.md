# Session audit 2026-08-19

Deep review findings to critic → fix → verify → gate. Do not treat this file as proof — re-read the cited code.

Yesterday’s ship-gate (C1, I1–I4, I7–I9 and should-fix I5/I6/I10–I16) stays closed unless current source reintroduces the original lie.

## Blocking (must fix)

### S19-CKO-TIMEOUT

`createCheckoutSession` POSTs through `executeWithHooks("createCheckoutSession")`. `stripeRequest` tags mutating POSTs `afterProviderSubmit: true`. `isPostSubmitMoneyMutation` omits `createCheckoutSession`, so timeout after Stripe accepted the session is a thrown `NetworkError`. Empty/non-JSON 200 already throws (`NEW-STRIPE-CKO-200`) and is also not converted to indeterminate. Missing caller `idempotencyKey` mints a new UUID per call.

- `packages/core/src/gateways/base.gateway.ts` `isPostSubmitMoneyMutation` / `tryIndeterminateFromNetworkError`
- `packages/core/src/gateways/stripe/stripe.gateway.ts` `createCheckoutSession`

**Required:** treat `createCheckoutSession` as post-submit uncertain. Return a checkout-shaped result with `reconciliationRequired: true` (or equivalent non-retryable tagged outcome). Do not reuse `applyIndeterminatePaymentOutcome` (wrong shape). Keep `getCheckoutSession` throwing. Add/flip tests: POST timeout is not a retryable failed-create.

### S19-PAYMOB-JSON

`parseJson` catch returns `{}`. On GET inquiry HTTP 200, `normalizeApiTransactionResponse` accepts `{}`, `mapTransactionStatus` falls through to `failed`, missing `success` → `declined`. Stripe/Moyasar/PayPal throw on invalid JSON. Recon `update_local_to_failed` will mark a captured payment failed.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` `parseJson`, `getPayment`, `normalizeApiTransactionResponse`, `mapTransactionStatus`

**Required:** invalid/empty JSON on GET → throw (unavailable / `GatewayApiError`). Mutations keep `requireMutation*` indeterminate. Do not map missing `success` to `failed` when `id` and money fields are also missing. Flip/add tests: empty/HTML 200 inquiry is not `declined`.

### S19-PAYMOB-REDIR-STATUS

Redirect parse forces `type: TRANSACTION_RESPONSE` so dual-write is `payment.processing`, but envelope `status` stays `mapTransactionStatus(success=true)` → `paid`. Tests lock `status === "paid"`. Handlers that fulfill on `event.status === "paid"` settle a browser-replayable GET.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` redirect parse (~1422–1447)
- tests that expect redirect `status === "paid"`

**Required:** demote redirect envelope `status` to `processing` (same as `stableType`). Flip tests.

### S19-PAYMOB-REFUND-UNPAID

`resolveRemainingActionAmountCents` only blocks uncaptured **auth** refunds. A failed/pending sale (`success: false` / `pending: true`, `captured_amount` omitted) uses full `amount_cents` as remaining and POSTs refund/capture.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` `resolveRemainingActionAmountCents`

**Required:** refuse refund/capture unless inquiry shows captured/paid or a positive `captured_amount`. Pending/failed sales throw `InvalidRequestError` before POST. Add tests.

### S19-MAP-REFUND-PENDING

I3 only moved bare `success` below `pending`. `hasAmountRefund` / `isRefunded` / `isRefund+success` still rank first. Built-in `mapTransactionStatus` ranks `pending` first. Flags-only `mapProviderEventTypeToStable` can emit `refund.completed` while `pending` is set. `refund_pending` is unmapped in `mapPaymobStatusOnly`.

- `packages/core/src/types/webhook-event-map.ts` `mapPaymobFromFlags`

**Required:** rank `flags.pending` / status `pending` / `processing` / `refund_pending` above refund arms. Map `refund_pending` → `refund.pending`. Add flags-only test mirroring I3.

### S19-WH-HASH-TOCTOU

I14 compares list snapshot to a later `get`. Between `get` and `claim`, an idle row may have a newer hash. Worker claims with the stale `get` hash; idle mismatch **supersedes** (WEBHOOKS-3) and rolls the body back.

- `packages/webhooks/src/engine.ts` `processRetryable` (~1575–1595)

**Required:** do not supersede backwards. If store hash ≠ listed hash at claim time, skip. Prefer compare-inside-claim or re-read immediately before claim and skip on mismatch. Add a get→claim race test.

### S19-STRIPE-LATE-REFUND

`succeededPaymentIntentWebhookStatus` ignores string `latest_charge` for refunds (C1: use `amount_received`). Stripe does not decrement `amount_received` on refund. Delayed first delivery of `payment_intent.succeeded` after `charge.refunded` last-writes `paid`. `getPayment` re-fetches the charge and reports `refunded`. Classic Checkout `payment_status: paid` + string PI is the same class.

- `packages/core/src/gateways/stripe/stripe.gateway.ts` `succeededPaymentIntentWebhookStatus`, `stripeCheckoutPaidSessionStatus`

**Required:** when a charge snapshot is observable, keep refund rematch. When `charges.data` has refunds, honor them. `getCheckoutSession` must rematch expanded PI refunds (see S19-CKO-GET). Do **not** undo C1 (unexpanded + `amount_received` > 0 stays `paid` when no refund evidence). Document that apps must not last-write PI.succeeded over `charge.refunded`. Add a test: expanded/list charge with `amount_refunded` is not `paid`.

## Should-fix (same pass)

### S19-PAYMOB-LEGACY-ID

Legacy create sets `gatewayId` to the numeric **order** id. `assertPaymobTransactionId` accepts `/^\d+$/` and sends it as `transaction_id`. Intention `pi_…` is already rejected.

- `packages/core/src/gateways/paymob/paymob.gateway.ts` legacy create + `assertPaymobTransactionId`

**Required:** do not put order id on `gatewayId` (use a distinct `orderId` only). Mutations still require webhook/dashboard `obj.id`. Docs: never pass create `gatewayId` from iframe checkout into refund/inquiry.

### S19-CKO-AMOUNT / S19-CKO-GET

Checkout webhook amount always uses `amount_total`. Status can be `partially_captured` from PI `amount_received`. `getCheckoutSession` expands `payment_intent` then ignores it and returns native `payment_status` + `amount_total`.

- `packages/core/src/gateways/stripe/stripe.gateway.ts` parse amount + `getCheckoutSession`

**Required:** when PI is expanded, publish settled `amount_received` and rematch refunds like `getPayment`.

### S19-STRIPE-CHARGE-SWALLOW

`getPayment` catch on `GET /charges/{id}` sets `chargeRefundStateUnknown` → succeeded PI maps `processing`. 401/429/5xx look like “still settling.”

- `packages/core/src/gateways/stripe/stripe.gateway.ts` ~2032–2087

**Required:** propagate auth/5xx as `NetworkError` / `AuthenticationError`. Keep fail-closed `processing` only when the charge is unobservable (string id, no fetch attempted or 404).

### S19-STRIPE-DISPUTE

`charge.dispute.*` falls through to `pending`. Last-write persist can move `paid` → `pending` without a dispute arm.

- `packages/core/src/gateways/stripe/stripe.gateway.ts` default webhook switch

**Required:** map dispute events to domain dispute statuses (or leave unmapped / `provider.unmapped` dual-write) — never overwrite a paid envelope as generic `pending`. Capabilities may stay `disputes: false` if dual-write is `provider.unmapped`.

### S19-EPHEMERAL-KEY

Stripe/PayPal mint a UUID `Idempotency-Key` / `PayPal-Request-Id` when the caller omits `idempotencyKey`. Crash retry mints a new key → duplicate capture/refund/void.

**Required:** capture/refund/void (and Checkout create) require a caller `idempotencyKey` or keep the ephemeral key **only** for in-process `withRetry` and warn loudly. Prefer fail-closed on capture/refund/void without caller key (Paymob/Moyasar parity) if tests allow; otherwise warn + document. Do not silently mint on `createCheckoutSession` if S19-CKO-TIMEOUT now returns indeterminate.

### S19-CLOCK-LEASE

Adapters never use SQL `NOW()` / Redis `TIME`. Soft-release on `get()` **clears `lease_token`** when *this* process clock thinks the lease is due. A fast host steals a 30s lease; original `complete` is `lease_lost` after the handler already ran.

- `packages/store-postgres/src/stores/webhook-inbox-store.ts` `get` soft-release
- same pattern: sqlite / turso / d1 / redis GET lua / DO recon `listDue({ now })`

**Required:** do not wipe tokens on `get()` using a caller/injected now that can diverge. Soft-release only from the store’s own clock on list/claim paths, or remove mutative soft-release from `get()`. DO recon `listDue` must not wipe with Worker `now` against isolate-issued leases. Keep FakeClock testability — do **not** switch all SQL to `NOW()` if that breaks injected clocks. Add a test that `get()` does not clear an unexpired-to-issuer lease.

### S19-CLAIM-DUE

`processDue` claims immediately before each handler. `claimDue` still `Promise.all`s every listed claim. README shows the bulk loop. Default 30s lease + serial work → peer steal.

- `packages/reconciliation/src/scheduler.ts` `claimListedDue` / `claimDue`
- `packages/reconciliation/README.md`

**Required:** `claimDue` claims one-at-a-time **or** README / types tell hosts to use `processDue` only. Prefer one-at-a-time.

### S19-RECON-HB

Webhook handlers renew on `leaseMs/3`. Recon `processDue` never renews. Hang counter parks to `manual_review` at `maxAttempts` even when last disposition was `retry_later`.

- `packages/reconciliation/src/scheduler.ts` `processDue`

**Required:** auto-renew on `leaseMs/3` while the handler runs. Do not count same-worker lease-lost hangs against the `retry_later` budget.

### S19-FINGERPRINT

`fingerprintParams` is `stableStringify`, documented as a hash, persisted by stores (PII / billing).

- `packages/core/src/utils/idempotency.ts`

**Required:** store `sha256Hex(stableStringify(redact(stripAbortSignal(value))))` (or equivalent). Keep stringify for canonicalization tests. Update tests that compare raw stringify equality of stored fingerprints.

### S19-EXAMPLE-BIND / S19-EXAMPLE-RECON / S19-EXAMPLE-AMOUNT

`findOrderForEvent` binds metadata `orderId` before `gatewayPaymentId`. Create charges `mock`; a Stripe webhook with matching metadata fulfills. `fulfill()` never writes the webhook PI. `POST /internal/reconcile` is unauthenticated and unlabeled. `snapshotForOrder` copies **order.amount** onto the provider snapshot. Client-posted `trustedAmount` is charged.

- `examples/checkout-kernel/src/kernel.ts`
- `examples/bun-hono-sqlite/src/app.ts` (and Elysia host)

**Required:** fulfill only when `gatewayPaymentId` matches (or bind PI first). Auth or omit `/internal/reconcile` like provider-paid. Build provider snapshots from `getPayment` money. Rename/stop charging untrusted client amounts in the example (server-side amount).

### S19-DOCS-SUCCESS

`successFromOutcome` includes `requires_action` (keep). Core README / `index.ts` JSDoc still say fulfill from `event.status` / `updatePaymentStatus(event.paymentId, event.status)`.

- `packages/core/src/index.ts` example
- `packages/core/README.md` webhook sample

**Required:** samples use `isPaidOutcome` / `status === "paid"` + inbox. Never `if (result.success) fulfill()`.

## Nits (same pass if cheap)

- **S19-SHA256-LEN:** public `sha256` only writes low 32 bits of bit-length (`crypto-portable.ts`). Set high word. Webhook HMAC unchanged for small bodies.
- **S19-RECON-PAN:** recon sanitize still omits 13–19 digit PAN runs (webhook sanitize has them).
- **S19-SQLITE-ENGINES:** `store-sqlite` engines say `node: >=18` while `/node` needs 22.5+.
- **S19-CKO-UNEXPANDED:** classic Checkout string PI stays `paid` without refund rematch (related to S19-STRIPE-LATE-REFUND / S19-CKO-GET).

## Out of scope

Stripe secret rotation (`webhookSecrets: string[]`), Moyasar token-in-body protocol, 0.x major-unit `number` results, `test:coverage` core-only, labeled `/internal/provider-paid`.
