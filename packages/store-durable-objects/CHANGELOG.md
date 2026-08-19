# @paykernel/store-durable-objects

## Unreleased

### Patch

- **S19-WH-HASH-TOCTOU:** webhook `claim` UPSERT honors `ifMatchPayloadHash` (idle miss is `payload_hash_conflict`, no rewrite).
- **PERF-5:** `listDue` / `listRetryable` peek every enumerable hash shard when `partitions > 1` (now returning `{ occupied, earliest }`). A single enumerable isolate lists directly (no peek). Full list runs only on shards that can contribute to the global earliest-N; later occupied shards whose earliest is after the cutoff are skipped. Boolean peek (rolling old Workers) is fail-closed to “must list”. Expired `claimed` still counts as occupied.
- **P17-RPC:** Worker wrappers must forward `bindHashPartitionLayout` (DO-1). `REQUIRED_DO_RPC_METHODS` lists the required stub surface; smoke Worker + wrangler sketch included.
- **P17-ERR:** Reconstruct `StoreError` after a stub hop (`err.name` / `{ __pkStoreError, code }`) before `mapDriverError`. Cloned `StoreLeaseLostError` stays non-retryable (not `StoreUnavailableError`).
- **P17-CLEAN:** Bounded `deleteExpired` uses a per-partition budget and rotating start so later hash partitions are not starved.
- **P17-NS:** Worker client passes `tableNamespace` on every store RPC; `PaymentsStoreObject` applies it. Mock namespaces no longer auto-inject a prefix.
- **P17-TENANT:** Worker tenant strategy is a static `tenantId` or a function of key only (store contracts have no `tenantId`).
- **P17-CURSOR:** `bindHashPartitionLayout` consumes every `sql.exec` cursor (`.toArray()`) and seals the write inside `transactionSync`.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- **B5 multi-partition discovery:** Worker client `listDue` / `listRetryable` / `deleteExpired` no longer route only to sentinel shards (`__list__` / `__cleanup__`). Under `kind: "hash"`, they fan out to all N partitions (merge/dedupe/limit for lists; sum deleted for cleanup). Under `kind: "key"` (and dynamic tenant), those methods throw `StoreUnsupportedFeatureError` instead of silently returning empty. Soft-release of expired claims remains per-partition SQL. See `docs/sharding.md`.
- Reconciliation `listDue` soft-releases expired claimed rows so abandoned jobs are rediscoverable via poll; `markManualReview` requires active (unexpired) lease (parity with complete/fail).


## 0.1.0-next.0


### Patch

- Webhook claim maps pending+future `available_at` to `not_available`; fail honors `restoreAttempt`.
- Webhook `listRetryable`/`get` soft-release expired claimed rows; claim gates pending on `available_at`.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
