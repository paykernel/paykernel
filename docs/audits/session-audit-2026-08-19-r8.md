# Session audit 2026-08-19 (r8)

Deep review findings after r7 ship-gate closed. Do not treat this file as proof — re-read the cited code.

Yesterday’s r7 ship-gate (S19-CKO-TIMEOUT, S19-PAYMOB-JSON, S19-PAYMOB-REDIR-STATUS, S19-PAYMOB-REFUND-UNPAID, S19-MAP-REFUND-PENDING, S19-WH-HASH-TOCTOU, S19-STRIPE-LATE-REFUND and C1 / I1–I4 / I7–I9) stays closed unless current source reintroduces the original lie.

## Blocking (must fix)

### S20-FINGERPRINT-REDACT

`fingerprintParams` hashes `redactForFingerprint(...)`. Logger redaction is correct for logs. It is wrong for “detect key reuse with different input.” Sensitive keys (`token`, `otp`, `email`, `phone`, `name`, `number`, `card`) and 13–19 digit PAN-like **values** become the literal `"[REDACTED]"`.

Reproduced:

- `paymobBillingData` `{ email/name/phone A }` vs `{ email/name/phone B }` → same SHA-256
- `{ otpValue: "1111" }` vs `{ otpValue: "2222" }` → same SHA-256 (`otp` substring)
- `{ gatewayPaymentId: "1234567890123" }` vs `{ gatewayPaymentId: "9876543210987" }` → same SHA-256

- `packages/core/src/utils/idempotency.ts` `fingerprintParams` / `redactForFingerprint`
- `packages/core/src/utils/logger.ts` `SENSITIVE_KEY_PATTERNS` / `isOpaqueSensitiveString`
- Paymob `executeIdempotent(..., p)` fingerprints the full params bag including billing
- Moyasar STC confirm fingerprints `{ transactionUrl, otpValue }`
- Tests lock Visa vs Mastercard collision (`utils.test.ts`)

**Required:** Keep PII out of the stored record, but digest the real leaf (`[REDACTED:` + sha256Hex(value) + `]` or equivalent). Do **not** PAN-redact allow-listed ids (`gatewayPaymentId`, `orderId`, `paymentId`). Two billing bags / two OTPs / two 13-digit ids **must not** share a fingerprint. Economically identical money amounts must still collide. Flip the Visa/MC test: card numbers stay out of the digest string, but two different PANs must not make two otherwise-identical bags collide (hash the leaf, do not constant-replace).

### S20-DOCS-FULFILL

Live examples were fixed. Docs people paste were not.

- `packages/core/docs/hooks.md` ~42–47: `onWebhookVerified` → `updatePaymentStatus(event.paymentId, event.status)` (pre-claim, any status)
- `packages/core/docs/webhooks.md` ~211–219: fulfill in `onWebhookVerified` after homemade `alreadyProcessed`
- `packages/core/docs/webhooks.md` ~312–314: inbox handler `fulfillOrder(ctx.event)` with no paid rematch / `gatewayPaymentId` bind
- `docs/getting-started.md` ~206–217: provider recon snapshot uses local trusted money, not `getPayment` amounts
- `packages/core/README.md` Stripe sample comments mention inbox; code still fulfills on `event.status === "paid"` without claiming

**Required:** Every sample matches `examples/checkout-kernel` + getting-started inbox section: claim first; fulfill only on `payment.succeeded` | `capture.completed` **and** `payment.status === "paid"`; bind `gatewayPaymentId`. Build recon snapshots from `getPayment` money only. Never `if (result.success) fulfill()`. Never fulfill in `onWebhookVerified`.

## Should-fix (same pass)

### S20-SETUP-INFER

`{ success: true, status: "setup_completed" }` with no explicit `outcome` infers `"failed"` (`isSettledSuccessStatus` omits `setup_completed`; fallthrough at `operation-result.ts` ~419–421). Built-in Moyasar/Stripe dual-write `outcome: succeeded`. Custom adapters and any mapper that only looks at `status` treat successful card-setup as a failed payment.

**Required:** `setup_completed` → operation `succeeded` (still not `isPaidOutcome`). Add test.

### S20-FAILED-DECLINED

`inferOperationOutcome` maps every `status: "failed"` to `declined` even with no `decline` object. A 5xx-mapped snapshot then looks like a hard card decline; callers that “don’t retry declines” will not reconcile.

**Required:** Bare `status: "failed"` without `decline` → `failed`. `declined` only when `result.decline` is present or an explicit `outcome: declined`. Flip tests that lock `{ success: false, status: "failed" }` → `"declined"` unless a decline object is present.

### S20-WH-FAIL-RECLAIM

`processRetryable` claims with `ifMatchPayloadHash` (S19 closed). `bestEffortRecordFailAfterLeaseLost` does **not** (`packages/webhooks/src/engine.ts` ~1174–1189). After the handler ran and `fail()` is `lease_lost`, idle WEBHOOKS-3 `processVerified` can move the row to `hash-b`. This reclaim still writes `hash-a` and may dead-letter the old body.

**Required:** Pass `ifMatchPayloadHash: args.payloadHash`. On `payload_hash_conflict`, skip — do not rewrite. Add a get→reclaim race test.

### S20-HEARTBEAT-RACE

`stopHeartbeat()` only `clearInterval`. No `closed` flag. A tick already in the macrotask queue can `renew()` after `await renewTail` and rotate `currentToken` while `complete` uses the previous token → `lease_lost` → `handler_failed` after a successful fulfill → retry → duplicate fulfillment unless the handler is idempotent. Same shape in recon `runProcessDueHandlerUnderLease` (`scheduler.ts` ~726–751).

**Required:** `let closed = false`; ignore renew after stop; set `closed` before awaiting the tail; do not rotate after close. Add a test if cheap.

### S20-MEM-GET-WIPE

Durable webhook/recon `get()` is read-only (S19-CLOCK-LEASE). Memory `get()` still `releaseExpiredLease()` and clears `lease_token`:

- `packages/testkit/src/memory/memory-stores.ts` ~659–663, ~988–990
- `packages/webhooks/src/memory-store.ts` ~339–342
- `packages/reconciliation/src/memory-store.ts` ~377–380

**Required:** Pure read on memory `get()`, like idempotency memory and Redis `WEBHOOK_GET_LUA`. Soft-release only on list/claim.

### S20-REDIS-IFMATCH-EMPTY

Redis `input.ifMatchPayloadHash ?? ""` and Lua `if ifMatchPayloadHash ~= ''` treat empty string as **omit** (idle WEBHOOKS-3 supersede still runs). SQL/memory treat `""` as CAS-match-empty (`$8::text IS NULL OR payload_hash = $8`).

**Required:** Omit only when the field is missing/NULL. Reject empty hashes at the store boundary. Never treat `""` as omit.

### S20-CLAIM-DUE-N

`claimDue` claims sequentially but still **returns N live leases**. Serial host work on that array is the original peer-steal / `lease_lost` after the handler ran. README says prefer `processDue`.

**Required:** Claim-one-and-return, **or** types/README make `claimDue` discovery-only and `processDue` the only production worker. Prefer documenting + not holding N if changing the API is too wide; if you keep bulk return, README/types must say hosts must not do serial work on the array (use `processDue`).

### S20-LIST-NOW

Durable `get()` is closed. `listDue` / `listRetryable` on Postgres/SQLite/Turso/D1/Redis still wipe with `input.now`. Recon `processDue` always passes scheduler `now`. If that clock is ahead of the store clock that issued the lease, list clears an unexpired token.

**Required:** Match DO recon: wipe only with issuer/`ctx.clock`; use caller `now` only for due/available **filters**. Keep FakeClock: inject the store clock in tests.

### S20-SQLITE-MEMORY

`openBunSqliteDatabase(path = ":memory:")` (and sibling open helpers) default to ephemeral memory while `SQLITE_STORAGE_ADAPTER_MANIFEST.durability` is `"durable"`. File-backed factories do not apply `busy_timeout` / WAL by default.

**Required:** No `:memory:` default on production open helpers (require an explicit path). Document `:memory:` as ephemeral. Apply `busy_timeout` on file-backed factories if cheap. Do not change `engines.node` honesty already documented.

### S20-PAYPAL-REFUND-UNKNOWN

`mapRefundStatus` maps anything outside `COMPLETED` / `PENDING` / `FAILED` / `CANCELLED` to **`failed`**. HTTP 200 means PayPal accepted the refund POST. Tests lock `WEIRD_NEW_STATUS` → `failed` (`paypal.gateway.test.ts` ~4155). A caller that retries the “failed” refund with a **new** `PayPal-Request-Id` can refund twice.

**Required:** After HTTP 200, unknown refund status → `pending` or `indeterminate`, never `failed`. Flip the test.

### S20-PAYMOB-REDIR-TERM

`redirectEnvelopeStatus` only demotes paid / authorized / partials / refunded → `processing`. A signed redirect with `is_voided=true` still yields envelope `cancelled` and stable `payment.cancelled`; `success=false` yields `payment.failed`. Handlers that restock/fail the order on those arms can run from a replayable GET.

**Required:** Demote **all** terminal redirect stables (`payment.cancelled`, `payment.failed`, `refund.*`) and envelope statuses (`cancelled`, `failed`, `refund_completed`, …) to `processing`. Flip tests.

### S20-PAYMOB-AMOUNT-REFUND

`mapPaymobTransactionSignals` (no flags): amount-only `refundedAmountCents > 0` ranks above decisive `fromStatus` except processing/refund.pending/refund.failed. `status: "paid"` + leftover refund cents can stay `refund.completed`.

**Required:** Do not amount-promote over a decisive `fromStatus`. Only use amount-only refund when `fromStatus` is undefined.

## Nits (same pass if cheap)

- **S20-PAYPAL-JSON:** `parseJsonResponse` empty → `{}`; invalid JSON → `{ name, message }`. Mutations then fail closed via `assert*Response(..., afterProviderSubmit)`. GET inquiry throws status-`0` “missing id”. Throw on empty/non-JSON: mutating + `afterProviderSubmit`; GET → `GatewayApiError` without inventing `{}`.
- **S20-PAYMOB-SUCCESS-OMIT:** Inquiry with real `id` / `amount_cents` but omitted `success` maps declined. Missing `success` on an identified txn → `processing` / throw unavailable, not `declined`. Keep explicit `success: false` as failed.
- **S20-CREATE-COUNT:** `GET /internal/create-count` is not `enableTestHooks`-gated.
- **S20-TRAILING-ZERO:** `money("10.500", "USD")` / `money("100.00", "JPY")` throw `excess_precision`. Strip trailing zeros on the unused remainder before `reject`.
- **S20-RETRY-NAN:** `Math.max(1, NaN)` is `NaN` → `throw undefined`. Sanitize `maxAttempts` to a finite integer ≥ 1.

## Out of scope

- Stripe `webhookSecrets[]` rotation
- Moyasar token-in-body protocol (document inbox + HTTPS only; do not invent a header HMAC)
- Stripe/PayPal `createPayment` ephemeral request id (documented residual; mutations already require caller key)
- 0.x major-unit `number` results
- C1: unexpanded `latest_charge` + `amount_received > 0` stays `paid` when no refund snapshot
- Formal prior bookkeeping files must not be read as this verdict

## Stream ownership (r8 workflow)

| Stream | IDs |
| --- | --- |
| A | S20-FINGERPRINT-REDACT, S20-TRAILING-ZERO |
| B | S20-SETUP-INFER, S20-FAILED-DECLINED, S20-RETRY-NAN |
| C | S20-DOCS-FULFILL |
| D | S20-PAYPAL-REFUND-UNKNOWN, S20-PAYPAL-JSON |
| E | S20-PAYMOB-REDIR-TERM, S20-PAYMOB-SUCCESS-OMIT |
| F | S20-PAYMOB-AMOUNT-REFUND (+ mapper dual-write for redirect cancelled/failed) |
| G | S20-WH-FAIL-RECLAIM, S20-HEARTBEAT-RACE (webhooks engine) |
| H | S20-CLAIM-DUE-N, S20-HEARTBEAT-RACE (recon scheduler only) |
| I | S20-MEM-GET-WIPE, S20-REDIS-IFMATCH-EMPTY, S20-LIST-NOW, S20-SQLITE-MEMORY |
| J | S20-CREATE-COUNT |
| K | audit bookkeeping only |
