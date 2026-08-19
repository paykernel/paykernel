# @paykernel/store-sqlite

## Unreleased

### Patch

- **S19-WH-HASH-TOCTOU:** webhook `claim` binds `ifMatchPayloadHash` into the conditional UPDATE. Idle hash mismatch under the fence is `payload_hash_conflict` with no rewrite.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).


## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available` (not `in_progress`); fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim binds `available_at` gate on pending reclaim.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
