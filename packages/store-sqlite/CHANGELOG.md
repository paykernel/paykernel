# @paykernel/store-sqlite

## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available` (not `in_progress`); fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim binds `available_at` gate on pending reclaim.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
