# @paykernel/store-postgres

## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available` (not `in_progress`); fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows so abandoned work is drainable via `processRetryable`.
- Claim templates gate pending on `available_at` (via sql-foundation).

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
