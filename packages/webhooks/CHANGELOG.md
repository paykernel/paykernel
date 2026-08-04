# @paykernel/webhooks

## Unreleased

### Patch Changes

- **B3:** `ackAfterClaim` parking uses `fail({ restoreAttempt: true })` so the parking claim does not consume `maxAttempts` (documented as max **handler** attempts). Regression: `maxAttempts=3` + ackAfterClaim → 3 handler failures before `dead_letter`.
- **B4:** Key-addressed `claim` respects `availableAt` — pending rows with future `availableAt` return `{ kind: "not_available" }` (no attempt++). Engine maps to `scheduled_for_retry`. True backoff under provider redelivery.
- **N2:** Document `NonRetryableHandlerError({ deadLetter: false })` poison risk; durable_retry still dead-letters after `maxAttempts`. Prefer default `deadLetter: true`.

### Contract notes (0.x)

- Additive `ClaimWebhookResult` kind: `not_available` (break exhaustive switches that assumed a closed set).
- Additive `FailWebhookInput.restoreAttempt?: boolean` (default false).

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
