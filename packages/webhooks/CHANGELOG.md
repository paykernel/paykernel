# @paykernel/webhooks

## Unreleased

### Patch Changes

- **NEW-WEBHOOKS-1:** `processRetryable` claims one listed row at a time (next `store.claim` after the previous handler returns). Parallel pre-claim of `limit` leases is unsafe with default `leaseMs=30s` when handlers average ≥3s (peer reclaim + this worker still handles).
- **NEW-WEBHOOKS-2:** Processed Paymob `TRANSACTION` inbox keys include domain status when available (`paymob:TRANSACTION:{id}:{status}`) so a later same-id void/refund snapshot is not `already_completed`. Redirect stays `TRANSACTION_RESPONSE:{txnId}`. Do not complete fulfillment on Paymob `payment.processing`.
- **NEW-WH-1:** Inbox notification class uses `provider.eventType` or known native HMAC classes (`TRANSACTION` / `TRANSACTION_RESPONSE`) only — remapped `payment.succeeded` is not a second key.
- **NEW-STORE-3:** Memory `complete` / `renew` do not soft-release expired leases before the token fence (fail closed without restore-then-lose).
- **PERF-7 (superseded):** listed claims are no longer issued concurrently — NEW-WEBHOOKS-1 serial claim is the fence.
- **Deep audit 2026-08-16:** Paymob inbox keys qualify redirect vs processed (`paymob:TRANSACTION_RESPONSE:{txnId}` vs `paymob:TRANSACTION:{txnId}`); `:redirect` suffix and class prefix collapse to one key. Missing durable snapshots and parse-stage `InvalidWebhookError` are retryable, not `invalid_webhook`. Inline claims persist `payloadRef` so `processRetryable` does not dead-letter paid rows.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged; contract + memory + durable adapter (postgres/sqlite/d1/turso/redis/DO) parity + conformance so crash/deploy reclaim does not burn handler `maxAttempts`.
- **WEBHOOKS-2:** Canonical payload hash source — `resolveInboxPayloadHash` prefers gateway `event.payloadHash`; docs/README refuse treating `hashWebhookPayload(rawBodyString)` as interchangeable with object hashes. Core JSDoc aligned.
- **WEBHOOKS-3:** Confirmed `not_available` → `scheduled_for_retry { reason: "not_available" }` (no silent 200); adapter policy docs stress 5xx unless a durable worker owns the row.
- **WEBHOOKS-4:** Claim classifies `already_completed` / `duplicate_failed` before `payload_hash_conflict` so completed rows redelivered with a mismatched hash still ACK as done.
- **B3:** `ackAfterClaim` parking uses `fail({ restoreAttempt: true })` so the parking claim does not consume `maxAttempts` (documented as max **handler** attempts). Regression: `maxAttempts=3` + ackAfterClaim → 3 handler failures before `dead_letter`.
- **B4:** Key-addressed `claim` respects `availableAt` — pending rows with future `availableAt` return `{ kind: "not_available" }` (no attempt++). Engine maps to `scheduled_for_retry`. True backoff under provider redelivery.
- **N2 (envelope unwrap):** Default `processRetryable` materialization auto-unwraps core `PersistedPaymentEventEnvelope` (`schemaVersion`+`event`+`payloadHash`) so handlers receive `.event` (PaymentEvent). Plain PaymentEvent / custom `payloadRef` shapes pass through. Custom `resolveEvent` still overrides. Docs: README + webhook-inbox.md.
- **N3:** `defaultLeaseMs` / per-call `leaseMs` must be finite and `> 0` — constructor / process throws a clear config error otherwise (default remains 30s). Prevents immediately-expired leases from misconfig.
- **N4 residual (docs):** If `ackAfterClaim` park `fail({ restoreAttempt: true })` hits `StoreLeaseLostError` (pathological lease/clock skew), engine returns `scheduled_for_retry` but the parking attempt may remain burned — no safe tokenless restore. Documented in webhook-inbox.md + crash-boundaries.
- **N5:** Post-claim missing-handler branch marked unreachable / TS-narrowing only (validated pre-claim).
- **N6/N7 (docs):** README + webhook-inbox.md aligned on HTTP-agnostic `scheduled_for_retry` policy (recommended 200 durable ACK vs 5xx provider redelivery); claim-kind table includes `not_available`.
- **N8:** Document that `WebhookInboxStatus` `'failed'` is unused by the engine (fail → `pending` | `dead_letter` only); retained on the public type for 0.x / custom-store compatibility.
- Document `NonRetryableHandlerError({ deadLetter: false })` poison risk; durable_retry still dead-letters after `maxAttempts`. Prefer default `deadLetter: true`.

### Contract notes (0.x)

- Additive `ClaimWebhookResult` kind: `not_available` (break exhaustive switches that assumed a closed set).
- Additive `FailWebhookInput.restoreAttempt?: boolean` (default false).

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
