# @paykernel/store-redis

## Unreleased

### Patch Changes

- **S19-WH-HASH-TOCTOU:** `WEBHOOK_CLAIM_LUA` ARGV[10] `ifMatchPayloadHash`. Idle hash mismatch under the fence is `payload_hash_conflict` with no rewrite; empty omits the CAS (WEBHOOKS-3).
- **PERF-4:** `listDue` / `listRetryable` load a ZRANGE page with one list-GET EVAL (soft-release + NEW-STORE-1 ghost `ZREM`). `KEYS[1]` is the index; `KEYS[2..]` are record hashes. Cluster still requires `clusterKeys`.
- **NEW-STORE-1:** `listDue` / `listRetryable` GET Lua `ZREM`s ghost ZSET members when the hash is missing so `LIMIT` windows cannot fill with dead keys.
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- **N6 / markIndeterminate reason:** sanitize and cap `reason` via `enforceMaxSanitizedError` before JSON serialize (SQL adapter parity; length + secret-pattern hygiene).

## 0.1.0-next.0

### Patch Changes

- Webhook claim `not_available` includes top-level `availableAt`; fail Lua honors `restoreAttempt` (ARGV[10]).
- **Webhook fail lease fence (B6):** `WEBHOOK_FAIL_LUA` requires an unexpired lease (`lease_expires_ms > nowMs`), matching complete/SQL fail. Expired leases → `lease_lost` / `StoreLeaseLostError`.
- **Webhook claim backoff (B4):** `WEBHOOK_CLAIM_LUA` returns tag `not_available` when `status=pending` and `available_ms > nowMs`. Expired claimed leases still reclaim for recovery.
- **Docs (B7):** Documented client `nowMs` ARGV / Redis `TIME` caveat for multi-host skew.
- **Recon fail lease fence (R7/R9):** `RECON_FAIL_LUA` requires unexpired lease (`lease_expires_ms > nowMs`), matching `RECON_COMPLETE_LUA` / webhook fail / SQL. Expired token → `lease_lost` (no reschedule/terminal mutate).
- **Recon markManualReview lease fence (N3):** `RECON_MARK_MANUAL_REVIEW_LUA` requires unexpired lease (`lease_expires_ms > nowMs`), matching complete/fail/SQL.
- **List rediscovery (R6/R8):** `listDue` / `listRetryable` bulk SCAN soft-release expired `claimed` rows (via GET Lua) and re-index due/retry ZSETs before `ZRANGEBYSCORE`, so poll workers rediscover abandoned work without a prior `get` (SQL parity; Approach A).

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
