# @paykernel/integration-cloudflare-workers

## 0.1.1

### Patch Changes

- fix: replace workspace:* with registry versions for consumer install

  All 18 packages with runtime workspace:* dependencies were published as 0.1.0/1.0.0 with unresolvable workspace:* specifiers, breaking `npm install` for consumers (Unsupported URL Type "workspace:"). Patch to 0.1.1/1.0.1 with concrete registry versions (^1.0.0, ^0.1.0 etc) via changesets internal dependency update. No API changes.

- Updated dependencies
  - @paykernel/integration-http@0.1.1

## 0.1.0

### Minor Changes

- 0bebd63: Phase 24: optional framework webhook integrations (raw-body handlers, inbox HTTP mapping, durable ACK policy). Core and webhooks stay framework-agnostic.

### Patch Changes

- Updated dependencies [0bebd63]
  - @paykernel/integration-http@0.1.0

## Unreleased

- Initial release: `handleCloudflareWebhook` and `readWorkerBindings`.
