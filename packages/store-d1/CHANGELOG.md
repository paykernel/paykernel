# @paykernel/store-d1

## Unreleased

### Patch

- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).


## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available`; fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim gates pending on `available_at`.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
