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
| `lease_lost` | Token/generation fence failed |
| `ok` | Renew / mutator success |
| `not_found` / `not_due` | Reconciliation schedule/claim outcomes |

Parsers (`parseTaggedResult`, `parseIdempotencyRecord`, …) map tags to Phase 9 result discriminants. Do **not** rely on bare integers `0`/`1` as the only wire format — tags make mis-mapping fail loudly.

## Injectable `now` ARGV (FakeClock)

Scripts take **caller-supplied time** as ARGV (epoch ms + ISO strings), not Redis `TIME` alone.

Why:

1. **FakeClock** conformance: tests advance lease expiry without waiting wall clock.
2. Deterministic reclaim predicates in multi-worker tests.
3. Operators still may pass wall-clock `now` in production.

Reclaim compares stored `lease_expires_ms` against `ARGV nowMs`.

## generation++ and leaseToken

On successful reserve / claim / renew that issues a new lease:

- `generation` increments (monotonic fencing).
- A new unguessable `leaseToken` is issued (opaque string from the client ARGV; script stores it).
- Prior tokens fail subsequent mutators (`lease_lost`).

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
