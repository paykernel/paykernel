# Lua scripts and atomicity

**Package:** `@paykernel/store-redis`  
**Source:** `src/scripts/*.lua.ts`, parsers in `src/scripts/results.ts`  
**Registry:** `REDIS_SCRIPT_REGISTRY`

## Rule

Atomic claims = **single Lua script / engine-level op**.

**Forbidden as a claim strategy:** non-atomic get-then-set races in application JS:

```text
// FORBIDDEN multi-process “claim”
const row = await get(key);
if (!row || expired(row)) await set(key, claimedRow);
```

All reserve/claim/renew/complete/fail/markIndeterminate/markManualReview transitions that change ownership or terminal state go through an audited script.

## Tagged results (not magic integers alone)

Scripts return a **Redis array** whose first element is a **string tag**:

| Example tags | Meaning |
| ------------ | ------- |
| `acquired` | Lease obtained (reserve/claim) |
| `in_progress` | Active non-expired lease held by someone |
| `already_completed` / `already_terminal` | Terminal success already recorded |
| `fingerprint_conflict` / `payload_hash_conflict` | Same key, different body/fingerprint |
| `indeterminate` | Uncertain outcome blocks reserve (A4) |
| `lease_lost` | Token/generation fence failed (incl. **expired** lease on complete/fail) |
| `not_available` | Webhook claim: `pending` but `available_ms > nowMs` (backoff not elapsed) |
| `ok` | Renew / mutator success |
| `not_found` / `not_due` | Reconciliation schedule/claim outcomes |

Parsers (`parseTaggedResult`, `parseIdempotencyRecord`, …) map tags to Phase 9 result discriminants. Do **not** rely on bare integers `0`/`1` as the only wire format — tags make mis-mapping fail loudly.

## Injectable `now` ARGV (FakeClock) — TIME caveat

Scripts take **caller-supplied time** as ARGV (epoch ms + ISO strings), **not** Redis `TIME` alone.

Why:

1. **FakeClock** conformance: tests advance lease expiry without waiting wall clock.
2. Deterministic reclaim predicates in multi-worker tests.
3. Operators still may pass wall-clock `now` in production.

Reclaim, complete, fail, and claim backoff compare stored `lease_expires_ms` / `available_ms` against **`ARGV nowMs`**.

### TIME caveat (B7 residual)

Production multi-host safety depends on reasonably synchronized client clocks. Redis `TIME` is **not** used as the sole lease authority (would break FakeClock and some managed clients). Under large clock skew, a worker can early-reclaim a still-live lease or reject a complete/fail near expiry. Prefer NTP; a hybrid Redis-`TIME` + client-skew bound is optional hardening, not required for 0.x FakeClock conformance.

## generation++ and leaseToken

On successful reserve / claim / renew that issues a new lease:

- `generation` increments (monotonic fencing).
- A new unguessable `leaseToken` is issued (opaque string from the client ARGV; script stores it).
- Prior tokens fail subsequent mutators (`lease_lost`).

## Webhook claim backoff + fail fencing

- **`WEBHOOK_CLAIM_LUA`**: when `status == pending` and `available_ms > nowMs`, returns tag `not_available` (does not burn attempts). Expired `claimed` leases still reclaim for crash recovery.
- **`WEBHOOK_FAIL_LUA`**: requires unexpired lease (`lease_expires_ms > nowMs`) — same fence as `WEBHOOK_COMPLETE_LUA` / SQL fail. Expired token → `lease_lost`.

## Reconciliation fail fencing

- **`RECON_FAIL_LUA`**: requires unexpired lease (`lease_expires_ms > nowMs`) after status=`claimed` + token match — same fence as `RECON_COMPLETE_LUA` / `WEBHOOK_FAIL_LUA` / SQL fail. Expired token → `lease_lost` (no schedule/terminal mutate).

## List rediscovery after abandoned claim (Approach A)

Claim scripts **ZREM** the logical key from the retry/due ZSET. Soft-release + **ZADD** lives in `WEBHOOK_GET_LUA` / `RECON_GET_LUA` for key-addressed reads.

For scheduler poll paths (`listRetryable` / `listDue`), Redis also runs a **bulk soft-release** before `ZRANGEBYSCORE`:

1. `SCAN` store record keys (skip the index key).
2. Run the store's GET Lua with injectable `nowMs` — expired `claimed` → `pending`/`scheduled` + re-index.
3. Then `ZRANGEBYSCORE` + hydrate scheduled/pending rows.

This is **Approach A** (list bulk soft-release via SCAN + existing GET soft-release), matching SQL `listRetryable` bulk UPDATE of expired claimed and memory `listDue`/`listRetryable` soft-release. It does **not** keep claimed keys on the due/retry index until complete (Approach B) and does **not** maintain a parallel claimed-expiry ZSET (Approach C).

Without this path, `processRetryable` / `claimDue`/`processDue` starve after a mid-claim crash because abandoned keys stay off-index until an external `get`.

## Per-store scripts (registry)

| Store | Scripts |
| ----- | ------- |
| Idempotency | `reserve`, `renew`, `complete`, `markIndeterminate`, `get`, `deleteIfExpired` |
| Webhook inbox | `claim`, `renew`, `complete`, `fail`, `get`, `deleteIfExpired` |
| Reconciliation | `schedule`, `claim`, `renew`, `complete`, `fail`, `markManualReview`, `get`, `deleteIfExpired` |

`deleteIfExpired` **must not** remove `indeterminate` idempotency rows by default (A4).

## EVAL / EVALSHA

`createEvalHelper(port)`:

1. Best-effort `SCRIPT LOAD` + `EVALSHA`.
2. On `NOSCRIPT`, fall back to `EVAL`.
3. `clearScriptCache()` after reconnect / FLUSHALL when needed.

## MULTI/EXEC

Claim correctness does **not** require client MULTI/EXEC. Lua is atomic per script. Bun may need raw `send()` for MULTI/EXEC if an app uses them for other reasons — still prefer one script per store transition.

## No Pub/Sub

Pub/Sub is not a substitute for scripted claim/retry.

## Related

- [crash-boundaries.md](./crash-boundaries.md)
- [key-design.md](./key-design.md)
- [guarantees.md](./guarantees.md)
- Memory oracle: [`packages/testkit/src/memory/memory-stores.ts`](../../testkit/src/memory/memory-stores.ts)
