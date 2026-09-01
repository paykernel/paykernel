# @paykernel/store-postgres

## 0.1.1

### Patch Changes

- fix: replace workspace:* with registry versions for consumer install

  All 18 packages with runtime workspace:* dependencies were published as 0.1.0/1.0.0 with unresolvable workspace:* specifiers, breaking `npm install` for consumers (Unsupported URL Type "workspace:"). Patch to 0.1.1/1.0.1 with concrete registry versions (^1.0.0, ^0.1.0 etc) via changesets internal dependency update. No API changes.

## 0.1.0

### Minor Changes

- df66280: Initial PayKernel package family under the `@paykernel` npm scope.

## Unreleased

### Patch

- **S19-WH-HASH-TOCTOU:** webhook `claim` binds `ifMatchPayloadHash` into the UPSERT (`$8`). Idle hash mismatch under the fence is `payload_hash_conflict` with no rewrite.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).

- Docs honesty: webhook `listRetryable` comments note Redis bulk SCAN soft-release + ZSET re-index list-discovery parity (R8 fixed).

## 0.1.0-next.0

### Patch

- Webhook claim maps pending+future `available_at` to `not_available` (not `in_progress`); fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows so abandoned work is drainable via `processRetryable`.
- Claim templates gate pending on `available_at` (via sql-foundation).

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
