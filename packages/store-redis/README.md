# @paykernel/store-redis

Redis / Valkey / Upstash stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** coordination (Phase 13).

> **Optional infrastructure.** Redis is **not** required to use the SDK. Prefer PostgreSQL/D1/Turso when you already have durable SQL, or hybrid: Redis for claims/leases + SQL for long-term audit. PostgreSQL alone (`@paykernel/store-postgres`) can satisfy all Phase 9 contracts.

## Install

```bash
bun add @paykernel/store-redis
# optional drivers (pick a binding):
bun add ioredis
# or
bun add redis
# or
bun add @upstash/redis
# Bun native Redis needs no npm peer — use the /bun subpath
```

## Quick start (driver-free root)

```ts
import {
  createRedisIdempotencyStore,
  type RedisCommandPort,
} from "@paykernel/store-redis";

const port: RedisCommandPort = {
  async send(command, args) {
    // adapt any client that can run EVAL / HGETALL / ZRANGE …
    return client.send(command, args);
  },
};

const store = createRedisIdempotencyStore({ port });
const r = await store.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
```

### Driver subpaths

Root entry **never** statically imports optional drivers:

| Subpath | Package / runtime | Notes |
|---------|-------------------|--------|
| `@paykernel/store-redis/bun` | `Bun.RedisClient` (runtime-provided) | Prefer injected client; `createBunRedisFromEnv` / URL are convenience only. Rejects Cluster/Sentinel/`clusterKeys`. Uses `send()` for EVAL. |
| `@paykernel/store-redis/upstash` | `@upstash/redis` | HTTP REST — serverless latency; EVAL still server-side Lua. |
| `@paykernel/store-redis/ioredis` | `ioredis` | Prefer `enableOfflineQueue: false` (`IOREDIS_STORE_CLIENT_DEFAULTS`). Cluster + `keys.clusterKeys`. |
| `@paykernel/store-redis/node-redis` | `redis` (node-redis) | Prefer `disableOfflineQueue: true` (`NODE_REDIS_STORE_CLIENT_DEFAULTS`). Cluster + hash tags. |

```ts
import {
  createRedisStoresFromBun,
  createBunRedisCommandPort,
} from "@paykernel/store-redis/bun";

// preferred: inject client
const stores = createRedisStoresFromBun({ redis: { client } });

// convenience only:
// createRedisStoresFromBun({ redis: { url: process.env.REDIS_URL! } });
// createRedisStoresFromBun({ redis: { fromEnv: true } });
```

Example (ioredis):

```ts
import Redis from "ioredis";
import { createRedisStoresFromIoredis } from "@paykernel/store-redis/ioredis";

const client = new Redis(process.env.PAYMENTS_SDK_REDIS_URL!, {
  enableOfflineQueue: false,
});
const stores = createRedisStoresFromIoredis({ client });
```

Full binding examples: [docs/drivers.md](./docs/drivers.md).

## Guarantees (honest)

| Axis | Value |
|------|--------|
| Coordination | **multi-host** when all workers share one Redis/Valkey |
| Claims | **strong** (atomic Lua; never get-then-set) |
| Durability | **configuration-dependent** (AOF/RDB / cloud persistence) |
| Audit store | **not** the sole long-term audit store by default |

Four durability distinctions:

1. **Coordination-safe** — multi-worker claims while Redis is up.
2. **Durable across process restart** — keys still in Redis after app restart.
3. **Durable across Redis restart** — only with correct AOF/RDB (or managed persistence).
4. **Only-audit-store** — **not recommended**; hybrid with PostgreSQL/D1/Turso for history.

See [docs/guarantees.md](./docs/guarantees.md) and [docs/persistence.md](./docs/persistence.md).

## Design notes

- Injectable clock: `now` is passed as Lua `ARGV` so `FakeClock` conformance works.
- `generation++` + unguessable `leaseToken` on reserve/claim/renew.
- Indeterminate idempotency rows block reserve (A4); `deleteExpired` never removes them by default.
- Do **not** use Pub/Sub for webhook delivery correctness or retries.
- Bun binding **rejects** Cluster / Sentinel configuration and `clusterKeys: true`.
- Disable / control offline command queues for correctness-critical ops.
- Does **not** depend on `internal/sql-store` (Redis is not relational).

## Testing

```bash
# unit tests (no live Redis) — live suites skip cleanly
bun test packages/store-redis

# optional local Redis 7.2
docker compose -f packages/store-redis/docker-compose.yml up -d

# live integration / conformance (must run and pass when set)
export PAYMENTS_SDK_REDIS_URL=redis://127.0.0.1:33027
# or REDIS_URL / VALKEY_URL (prefer PAYMENTS_SDK_REDIS_URL)
bun test packages/store-redis
```

Live suites cover three-store conformance + FakeClock, multi-client concurrent claims,
lease reclaim/stale token, deleteExpired, INFO server version, and binding parity (unit).

Details: [docs/testing.md](./docs/testing.md).

## Documentation

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

| Doc | Topic |
| --- | ----- |
| [docs/overview.md](./docs/overview.md) | Purpose, optional Redis, subpaths |
| [docs/crash-boundaries.md](./docs/crash-boundaries.md) | Crash / reclaim / Redis restart |
| [docs/drivers.md](./docs/drivers.md) | `/bun` `/upstash` `/ioredis` `/node-redis` |
| [docs/scripts-atomicity.md](./docs/scripts-atomicity.md) | Lua, tagged results, now ARGV |
| [docs/key-design.md](./docs/key-design.md) | Prefixes, tenants, hash tags, TTL |
| [docs/persistence.md](./docs/persistence.md) | Four durability distinctions |
| [docs/hybrid-examples.md](./docs/hybrid-examples.md) | Hybrid and no-Redis scenarios |
| [docs/testing.md](./docs/testing.md) | Env, docker-compose, conformance |
| [docs/guarantees.md](./docs/guarantees.md) | `REDIS_STORAGE_ADAPTER_MANIFEST` |
| [store-contracts.md](../testkit/docs/store-contracts.md) | Phase 9 contracts |

## License

MIT
