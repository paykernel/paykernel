# @paykernel/store-durable-objects

## Unreleased

### Patch

- **B5 multi-partition discovery:** Worker client `listDue` / `listRetryable` / `deleteExpired` no longer route only to sentinel shards (`__list__` / `__cleanup__`). Under `kind: "hash"`, they fan out to all N partitions (merge/dedupe/limit for lists; sum deleted for cleanup). Under `kind: "key"` (and dynamic tenant), those methods throw `StoreUnsupportedFeatureError` instead of silently returning empty. Soft-release of expired claims remains per-partition SQL. See `docs/sharding.md`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).


## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available`; fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim gates pending on `available_at`.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
