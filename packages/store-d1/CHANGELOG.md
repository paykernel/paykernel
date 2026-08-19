# @paykernel/store-d1

## Unreleased

### Patch

- **S19-WH-HASH-TOCTOU:** webhook `claim` UPSERT honors `ifMatchPayloadHash` (idle miss is `payload_hash_conflict`, no rewrite).
- **P16-TX:** Live `createD1Executor` no longer attaches `transaction()` / `BEGIN IMMEDIATE`. Store `withTransaction` fails closed with `StoreUnsupportedFeatureError`. Mock D1 may prove same-connection SQLite via an internal hook.
- **P16-ALS:** Example and smoke Wrangler configs set `nodejs_compat` (required for `node:async_hooks` ALS).
- **P16-SUCCESS:** `query` / `execute` / `batch` throw when D1 reports `success: false` (failed UPSERT is not a claim miss).
- **P16-SESSION:** `createD1Executor` and `migrateD1Adapter` default to `first-primary` when `withSession` exists; `session: false` opts out.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).


## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available`; fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim gates pending on `available_at`.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
