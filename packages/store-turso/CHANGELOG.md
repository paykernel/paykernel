# @paykernel/store-turso

## 0.1.0

### Minor Changes

- df66280: Initial PayKernel package family under the `@paykernel` npm scope.

## Unreleased

### Patch

- **S19-WH-HASH-TOCTOU:** webhook `claim` UPSERT honors `ifMatchPayloadHash` (idle miss is `payload_hash_conflict`, no rewrite).
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).

## 0.1.0-next.0

### Patch

- Webhook claim maps pending+future `available_at` to `not_available`; fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim gates pending on `available_at`.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
