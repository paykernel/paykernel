# @paykernel/store-redis

## 0.1.0-next.0

### Patch Changes

- Webhook claim `not_available` includes top-level `availableAt`; fail Lua honors `restoreAttempt` (ARGV[10]).
- **Webhook fail lease fence (B6):** `WEBHOOK_FAIL_LUA` requires an unexpired lease (`lease_expires_ms > nowMs`), matching complete/SQL fail. Expired leases → `lease_lost` / `StoreLeaseLostError`.
- **Webhook claim backoff (B4):** `WEBHOOK_CLAIM_LUA` returns tag `not_available` when `status=pending` and `available_ms > nowMs`. Expired claimed leases still reclaim for recovery.
- **Docs (B7):** Documented client `nowMs` ARGV / Redis `TIME` caveat for multi-host skew.

### Major Changes

- Initial PayKernel prerelease under the `@paykernel` npm scope.
