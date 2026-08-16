# Crash boundaries — Redis adapter

**Package:** `@paykernel/store-redis`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)  
**Engine-level webhook pipeline:** [webhooks crash-boundaries](../../webhooks/docs/crash-boundaries.md)

This document answers: if a worker dies before or after a side effect and before durable complete, what does Redis still hold, and how does reclaim behave? Also: what changes if Redis itself restarts?

---

## Process model

| Event | Effect |
| ----- | ------ |
| Worker crash mid-handler | Lease HASH remains `reserved` / `claimed` until `lease_expires_ms` (compared with injectable `now` ARGV). Another worker reclaims with a **new** `leaseToken` + incremented `generation`. Stale token mutators throw `StoreLeaseLostError`. |
| Successful `complete` / terminal fail / manual review | Terminal status written in Redis HASH. Survives **app** process restart while Redis holds the key. Survival across **Redis** restart requires persistence (AOF/RDB / managed). |
| Connection drop mid-script | Lua runs atomically server-side: either fully applied or not. Client may not know which; map to `StoreUnavailableError` / `StoreTimeoutError`. Do **not** treat uncertain outcomes as business failure without reclaim/replay policy. |
| Offline queue replay after reconnect | **Dangerous** for correctness-critical ops. Prefer `enableOfflineQueue: false` (ioredis) / equivalent. Do not silently re-issue claims after ambiguous reconnect. |

---

## Atomicity

- **Claims** are engine-level: one Lua script per transition (reserve/claim, renew, complete, fail, markIndeterminate, …).
- Never get-then-set across connections for claim correctness.
- Mutators fence on current `lease_token`. **Complete** (webhook + recon) and **recon fail** also require an unexpired lease. **Webhook fail** accepts a matching token after expiry (WEBHOOKS-2) — do **not** document it as the same fence as complete. Tag `lease_lost` → `StoreLeaseLostError`.
- ZSET indexes (retry/due) update **inside** the same script as the HASH where applicable — not a separate non-atomic follow-up for the critical path.
- **Pub/Sub is never** used for delivery correctness or retries.

See [scripts-atomicity.md](./scripts-atomicity.md).

---

## Crash scenarios (all three stores)

### 1. Crash after acquire / claim, before side effect

| | |
| - | - |
| **Store** | HASH leased (`reserved` / `claimed`); `leaseToken` / `generation` set. |
| **Side effect** | Did not run. |
| **After expiry** | Peer reclaims with new token + higher generation. Old token rejected. |
| **App** | Safe to re-run work after reclaim (no external side effect yet). |

### 2. Crash after external side effect, before complete

| | |
| - | - |
| **Store** | Still leased until expiry (or until another worker reclaims). Terminal complete **not** written. |
| **Side effect** | May have committed at the provider / downstream. |
| **Idempotency** | Prefer `markIndeterminate` **if** the worker still holds a valid lease; otherwise treat as uncertain and reconcile — **never invent terminal failure**. |
| **Webhooks / recon** | Design handlers for **at-least-once** execution; reclaim re-runs the handler. |
| **Stale complete** | After reclaim, the crashed worker’s token fails mutators (`StoreLeaseLostError`). |

### 3. Crash after successful complete

| | |
| - | - |
| **Store** | Terminal status in Redis (subject to persistence/TTL policy). |
| **Restart (app)** | `reserve` / `claim` observe terminal outcome (`already_completed`, etc.); do not re-run side effects. |
| **Restart (Redis without persistence)** | Terminal row may be **gone** — not a durable audit trail. Prefer hybrid SQL for long-term history. |

### 4. Connection drop / timeout mid-script

| | |
| - | - |
| **Redis** | Script commit or no-op — not half-applied for a single EVAL. |
| **Client** | May not know which; map to `unavailable` / `timeout` (`retryable: true` where appropriate). |
| **Policy** | Re-read / re-claim with dual fencing; do not convert uncertainty into business failure. |

### 5. Stale mutator after peer reclaim or renew

| | |
| - | - |
| **Store** | Script returns tagged `lease_lost` under old token. |
| **Error** | `StoreLeaseLostError` (`code: "lease_lost"`, not retryable as “same ownership”). |
| **Meaning** | Another worker owns the work — not a definitive payment failure. |

### 6. Redis service restart / failover

| | |
| - | - |
| **Ephemeral / no AOF** | Keys lost → leases and terminals vanish; workers may double-run work. |
| **AOF/RDB configured** | Keys restored per Redis durability semantics (see [persistence.md](./persistence.md)). |
| **Replica promotion** | Possible brief inconsistency windows depending on replication config — treat as configuration-dependent. |
| **Policy** | Do not use Redis alone as the sole long-term audit store by default. |

---

## Lease reclaim (dual fencing)

1. Lease expires (`lease_expires_ms` compared with injectable `nowMs` ARGV — **not** hard-dependent on Redis `TIME` alone so FakeClock works).
2. Peer claim/reserve succeeds with **new** `leaseToken` and higher `generation`.
3. Prior token fails token-gated mutators. Complete and recon fail require unexpired lease + matching token. Webhook fail accepts a matching token after expiry (WEBHOOKS-2); after peer reclaim the old token fails.
4. Handler may run again (at-least-once). Idempotent side effects are mandatory for webhooks/recon.

### List-based recovery (webhook + recon)

Claim **ZADD**s the key onto the retry/due ZSET scored by `lease_expires_ms`. After lease expiry, recovery is that **keyed ZSET**, not Cluster `SCAN`:

| Path | Behavior |
| ---- | -------- |
| Key-addressed `get` | Soft-releases expired `claimed` → `pending`/`scheduled` (restores one unfinished attempt) and **ZADD**s the retry/due index. |
| `listRetryable` / `listDue` | **`ZRANGEBYSCORE` the lease-expiry ZSET** up to `nowMs`, soft-release those claimed rows, re-index retry/due, then `ZRANGEBYSCORE` the due/retry index — so `processRetryable` / `claimDue`/`processDue` rediscover abandoned work **without** a prior `get`. Missing hash **ZREM**s the ghost member (NEW-STORE-1) so `LIMIT` cannot fill with dead keys. |
| Key-addressed `claim` | Reclaims expired leases with a new token. Pending/scheduled burns an attempt; expired `claimed` reclaim does not. |

`SCAN` is optional extra on **standalone** only (housekeeping / `deleteExpired`). It is not Cluster-safe recovery (per-node cursor would miss keys).

This matches SQL/memory list soft-release recovery for durable_retry / recon poll workers.

---

## Secrets and payloads

- `last_error` / diagnostic fields accept **sanitized** text only (max length enforced).
- Do **not** store raw provider payloads or signatures by default.
- `StoreError` messages and mapped driver errors must not leak secrets, passwords, or full Redis URLs.

---

## Relation to webhook engine

When using `@paykernel/webhooks` with this adapter’s inbox store:

- The engine cannot atomically couple arbitrary provider HTTP with `complete`.
- Reclaim after crash ⇒ handler re-run. See engine [crash-boundaries.md](../../webhooks/docs/crash-boundaries.md).
- Do **not** use Redis Pub/Sub as a substitute for inbox claim/retry correctness.

---

## Related

- [overview.md](./overview.md)
- [persistence.md](./persistence.md) — four durability distinctions
- [guarantees.md](./guarantees.md) — manifest notes
- [scripts-atomicity.md](./scripts-atomicity.md)
- [testing.md](./testing.md)
