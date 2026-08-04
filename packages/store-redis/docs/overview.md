# Redis / Valkey adapter overview (Phase 13)

**Package:** `@paykernel/store-redis`  
**Path:** `packages/store-redis`  
**Contracts:** Phase 9 lease-aware stores in [`@paykernel/testkit`](../../testkit/docs/store-contracts.md)

This package is an **optional** production storage adapter. It implements multi-host-safe **idempotency**, **webhook inbox**, and **reconciliation** coordination against shared Redis, Valkey, or Upstash.

> **Redis is optional infrastructure.** The SDK does **not** require Redis. PostgreSQL alone (`@paykernel/store-postgres`) can satisfy all Phase 9 contracts. Prefer Redis only when you already operate Redis/Valkey, need low-latency leases/TTLs, or want hybrid coordination + SQL audit history.

## Purpose

| Concern | What this package provides |
| ------- | -------------------------- |
| Atomic claims | Server-side **Lua scripts** (tagged results); never application get-then-set |
| Multi-host coordination | Safe when all workers share one Redis/Valkey (or compatible managed service) |
| Driver choice | Optional peers + isolated subpaths; **root entry imports no drivers** |
| Clock / FakeClock | Injectable clock; `now` passed as Lua `ARGV` |
| Conformance | Wired to testkit suites (env-gated live Redis) |
| Honest guarantees | `durability: configuration-dependent` — not blindly durable |

## Explicit non-default

- Installing `@paykernel/core` does **not** install this package.
- Core and webhooks never depend on Redis clients or this adapter.
- Apps that already use PostgreSQL/D1/Turso need **not** add Redis.
- Default recommendation: do **not** introduce Redis solely because this adapter exists.

## What you get

```ts
import {
  createRedisIdempotencyStore,
  createRedisWebhookInboxStore,
  createRedisReconciliationStore,
  createRedisStores,
  REDIS_STORAGE_ADAPTER_MANIFEST,
  type RedisCommandPort,
} from "@paykernel/store-redis";
```

- Factories take a narrow `RedisCommandPort` + optional injectable `clock` / key options.
- Driver bindings: `/bun`, `/upstash`, `/ioredis`, `/node-redis` (see [drivers.md](./drivers.md)).
- Manifest: multi-host when shared; durability configuration-dependent (see [guarantees.md](./guarantees.md)).

## Multi-host coordination

1. **Keys are the work record** while Redis holds them (HASH rows + ZSET indexes).
2. **Atomic Lua** serializes reserve/claim/renew/complete/fail at the engine.
3. **Lease fencing** uses opaque `leaseToken` + monotonic `generation`.
4. Process crash mid-handler leaves a leased record until expiry; peers reclaim with a new token.
5. Survival across **Redis process/service restart** depends on AOF/RDB or managed persistence — see [persistence.md](./persistence.md).

Details: [crash-boundaries.md](./crash-boundaries.md).

## Subpaths

| Entry | Imports optional drivers? |
| ----- | ------------------------- |
| `@paykernel/store-redis` (root) | **No** |
| `…/bun`, `…/upstash`, `…/ioredis`, `…/node-redis` | Yes (isolated) |

## Boundaries

| Package | Relation to adapter-redis |
| ------- | ------------------------- |
| `packages/core` | **Must not** depend on it |
| `packages/webhooks` | **Must not** depend on it (inject store at app layer) |
| `packages/testkit` | Contracts + conformance only |
| `packages/store-postgres` | **Must not** depend on it (hybrid is app composition) |
| `internal/sql-store` | **Must not** be depended on by this package (Redis is not relational) |

## Non-goals (this package / Phase 13)

- Making Redis mandatory or the default recommendation
- Pub/Sub for webhook delivery correctness or retries
- Large generic Redis client abstraction beyond `RedisCommandPort`
- Depending on `internal/sql-store`
- SQLite (Phase 14 single-host) / Turso (Phase 15 multi-host remote) / D1 (Phase 16 multi-host Workers) live as sibling packages; Durable Objects remain Phase 17
- `packages/reconciliation` domain package
- New PSPs or gateway extraction

## Related docs

| Doc | Topic |
| --- | ----- |
| [README](../README.md) | Quick start |
| [crash-boundaries.md](./crash-boundaries.md) | Crash / reclaim / Redis restart |
| [drivers.md](./drivers.md) | Subpath bindings, offline queue, no Pub/Sub correctness |
| [scripts-atomicity.md](./scripts-atomicity.md) | Lua scripts, tagged results, now ARGV |
| [key-design.md](./key-design.md) | Prefixes, tenants, hash tags, TTL |
| [persistence.md](./persistence.md) | Four durability distinctions, AOF/RDB |
| [hybrid-examples.md](./hybrid-examples.md) | Redis+Postgres, Upstash+SQL, Redis-only, no-Redis |
| [testing.md](./testing.md) | Env, docker-compose, conformance, skips |
| [guarantees.md](./guarantees.md) | Manifest honesty notes |
| [store-contracts.md](../../testkit/docs/store-contracts.md) | Phase 9 contracts |
| [workspace-boundaries.md](../../../docs/workspace-boundaries.md) | Monorepo matrix |
