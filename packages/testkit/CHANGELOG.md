# @paykernel/testkit

## Unreleased

### Patch Changes

- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- **N2 (webhook inbox conformance):** `runWebhookInboxStoreConformanceSuite` now asserts claim `not_available` / `availableAt` gate (no attempt++) and `fail({ restoreAttempt: true })` attempt restore (parking claim parity). Adapters that already implement correctly keep passing.
- **Paid-like parity:** `paymentStatusToOperationOutcome("approved")` returns `requires_action` (not `succeeded`), matching core `inferOperationOutcome` / PayPal pre-capture semantics. `isPaidOutcome` remains false for approved.
- **N5 / deleteExpired parity:** memory idempotency `deleteExpired` only removes terminal `completed`/`expired` rows (SQL/Redis parity). Reclaimable `reserved` rows with past `leaseExpiresAt` are no longer wiped by cleanup; soft-release/reclaim remains separate.
- **N4 docs:** store-contracts markdown documents intentional `markIndeterminate` near-expiry parking vs post-reclaim fencing, and terminal-only `deleteExpired`.
- Reconciliation conformance: `listDue` rediscovers abandoned expired claims (poll recovery).

- **Recon listDue recovery (R5/R6):** `runReconciliationStoreConformanceSuite` now requires that after claim-abandon and lease expiry, `listDue` soft-releases/re-indexes the job (poll-path rediscovery). Memory store regression test locks soft-release inside `listDue`. Key-addressed reclaim alone is no longer sufficient for the suite.

## 0.1.0-next.0

### Patch Changes

- Re-export lease-aware store contracts and adapter manifests from `@paykernel/store-contracts` (production adapters no longer hard-depend on full testkit at runtime).

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
