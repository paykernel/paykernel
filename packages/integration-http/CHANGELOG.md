# @paykernel/integration-http

## 0.1.0

### Minor Changes

- 0bebd63: Phase 24: optional framework webhook integrations (raw-body handlers, inbox HTTP mapping, durable ACK policy). Core and webhooks stay framework-agnostic.

### Patch Changes

- Updated dependencies [df66280]
- Updated dependencies [94547b7]
- Updated dependencies [6f78c47]
- Updated dependencies [9de3699]
  - @paykernel/core@1.0.0
  - @paykernel/webhooks@0.1.0

## Unreleased

- Initial release: portable HTTP mapping (`mapInboxOutcome`, `retryAfterSeconds`), header/correlation helpers, gateway signature extraction, `processWebhookHttp`, and `requireStringBindings`.
