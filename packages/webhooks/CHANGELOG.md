# @paykernel/webhooks

## Unreleased

### Patch Changes

- **B3:** `ackAfterClaim` parking uses `fail({ restoreAttempt: true })` so the parking claim does not consume `maxAttempts` (documented as max **handler** attempts). Regression: `maxAttempts=3` + ackAfterClaim → 3 handler failures before `dead_letter`.
- **B4:** Key-addressed `claim` respects `availableAt` — pending rows with future `availableAt` return `{ kind: "not_available" }` (no attempt++). Engine maps to `scheduled_for_retry`. True backoff under provider redelivery.
- **N2 (envelope unwrap):** Default `processRetryable` materialization auto-unwraps core `PersistedPaymentEventEnvelope` (`schemaVersion`+`event`+`payloadHash`) so handlers receive `.event` (PaymentEvent). Plain PaymentEvent / custom `payloadRef` shapes pass through. Custom `resolveEvent` still overrides. Docs: README + webhook-inbox.md.
- **N8:** Document that `WebhookInboxStatus` `'failed'` is unused by the engine (fail → `pending` | `dead_letter` only); retained on the public type for 0.x / custom-store compatibility.
- Document `NonRetryableHandlerError({ deadLetter: false })` poison risk; durable_retry still dead-letters after `maxAttempts`. Prefer default `deadLetter: true`.

### Contract notes (0.x)

- Additive `ClaimWebhookResult` kind: `not_available` (break exhaustive switches that assumed a closed set).
- Additive `FailWebhookInput.restoreAttempt?: boolean` (default false).

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
