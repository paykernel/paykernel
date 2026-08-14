# Driver bindings

**Rule:** the package **root** entry must never statically import optional peer drivers (`ioredis`, `redis`, `@upstash/redis`) or Bun Redis modules. Drivers live on **isolated subpath exports** and optional peerDependencies only.

Enforced by `bun run check:boundaries` and `public-api.test.ts`.

## Subpaths

| Import path | Optional dependency | Binding helpers |
| ----------- | ------------------- | --------------- |
| `@paykernel/store-redis` | none | `createRedis*Store({ port })`, port, keys, manifest, scripts |
| `@paykernel/store-redis/bun` | Bun runtime (`Bun.RedisClient`) | `createBunRedisCommandPort` / `createPortFromBunRedis`, `createRedisStoresFromBun`, `createBunRedisFromEnv`, topology reject |
| `@paykernel/store-redis/upstash` | `@upstash/redis` | `createUpstashCommandPort` / `createPortFromUpstash`, `createRedisStoresFromUpstash` |
| `@paykernel/store-redis/ioredis` | `ioredis` | `createIoredisCommandPort` / `createPortFromIoredis`, `createRedisStoresFromIoredis`, `IOREDIS_STORE_CLIENT_DEFAULTS` |
| `@paykernel/store-redis/node-redis` | `redis` | `createNodeRedisCommandPort` / `createPortFromNodeRedis`, `createRedisStoresFromNodeRedis`, `NODE_REDIS_STORE_CLIENT_DEFAULTS` |

Install peers as needed:

```bash
bun add @paykernel/store-redis
bun add ioredis              # Node / Bun with ioredis
# or
bun add redis                # node-redis
# or
bun add @upstash/redis       # Upstash
# Bun native Redis needs no npm peer — use /bun under the Bun runtime
```

## Narrow port (root-friendly)

Any stack can implement `RedisCommandPort` and use the root factories without importing a driver subpath:

```ts
import {
  createRedisStores,
  type RedisCommandPort,
} from "@paykernel/store-redis";

const port: RedisCommandPort = {
  async send(command, args) {
    // uppercase command name + string args (RESP-friendly)
    return client.send(command, [...args]);
  },
};

const stores = createRedisStores({ port });
```

- Stores depend only on `send(command, args)` for EVAL / HGETALL / ZRANGE / etc.
- Do not expand into a large generic Redis abstraction beyond this port.

---

## Bun (`/bun`)

Preferred: **inject** a `Bun.RedisClient` instance.

```ts
import {
  createRedisStoresFromBun,
  createBunRedisCommandPort,
  createBunRedisClientFromUrl,
  createBunRedisFromEnv,
} from "@paykernel/store-redis/bun";

// Preferred: inject client
const stores = createRedisStoresFromBun({
  redis: { client: myBunRedisClient },
});
// or build a port and use root factories:
// const port = createBunRedisCommandPort(myBunRedisClient);

// Convenience only — URL / env discovery
const client = createBunRedisClientFromUrl(process.env.PAYMENTS_SDK_REDIS_URL!);
// or: createBunRedisFromEnv() / redis: { url } / redis: { fromEnv: true }
// fromEnv reads PAYMENTS_SDK_REDIS_URL → REDIS_URL → VALKEY_URL
```

### Bun topology and caveats

| Topic | Policy |
| ----- | ------ |
| Cluster / Sentinel | **Rejected** at factory construction (`StoreUnsupportedFeatureError`) |
| `keys.clusterKeys: true` | **Rejected** on Bun binding |
| Offline queue | Prefer disabled / controlled for correctness-critical ops |
| MULTI / EXEC | Not first-class on Bun native client; use raw `send()` if needed. **Claims use Lua**, not MULTI/EXEC |
| Pub/Sub | **Do not** use for webhook delivery correctness or retries |
| Scripts | Via `send("EVAL" \| "EVALSHA", …)` / port |

---

## ioredis (`/ioredis`)

```ts
import Redis from "ioredis";
import {
  createRedisStoresFromIoredis,
  IOREDIS_STORE_CLIENT_DEFAULTS,
} from "@paykernel/store-redis/ioredis";

const client = new Redis(process.env.PAYMENTS_SDK_REDIS_URL!, {
  ...IOREDIS_STORE_CLIENT_DEFAULTS, // enableOfflineQueue: false, maxRetriesPerRequest: 1
});

const stores = createRedisStoresFromIoredis({ client });
```

**Offline queue:** with `enableOfflineQueue: true` (ioredis default), commands may buffer while disconnected and replay after reconnect — ambiguous for claims. Prefer `false` for payment-critical paths.

Cluster-capable deployments may set `keys: { clusterKeys: true }` so record + index (retry/due **and** lease-expiry recovery ZSET) share a hash tag slot (see [key-design.md](./key-design.md)). Recovery is that keyed ZSET, **not** Cluster `SCAN`.

---

## node-redis (`/node-redis`)

```ts
import { createClient } from "redis";
import {
  createRedisStoresFromNodeRedis,
  NODE_REDIS_STORE_CLIENT_DEFAULTS,
} from "@paykernel/store-redis/node-redis";

const client = createClient({
  url: process.env.PAYMENTS_SDK_REDIS_URL,
  ...NODE_REDIS_STORE_CLIENT_DEFAULTS, // disableOfflineQueue: true
});
await client.connect();

const stores = createRedisStoresFromNodeRedis({ client });
```

Supports cluster hash-tag key layout when using Redis Cluster via node-redis cluster client (`keys: { clusterKeys: true }`). Abandoned-claim recovery is the lease-expiry ZSET, not Cluster `SCAN`.

---

## Upstash (`/upstash`)

```ts
import { Redis } from "@upstash/redis";
import { createRedisStoresFromUpstash } from "@paykernel/store-redis/upstash";

const client = Redis.fromEnv(); // or new Redis({ url, token })
const stores = createRedisStoresFromUpstash({ client });
```

HTTP/REST transport: higher serverless latency / cold starts. **EVAL still runs server-side Lua** (atomicity preserved). Contract behavior (Lua + tags) matches other bindings. Validate persistence/retention policy for your Upstash plan (see [persistence.md](./persistence.md)).

---

## Offline queue (all bindings)

Correctness-critical transitions (reserve/claim/renew/complete/fail) must not silently replay after an ambiguous disconnect. Prefer:

1. Disable offline command queues where the driver supports it.
2. Map connection failures to `StoreUnavailableError` / `StoreTimeoutError`.
3. Re-enter via reclaim / dual fencing, not “assume the buffered claim ran.”

## No Pub/Sub correctness

Webhook delivery and retries use the **inbox store** (claim + lease + fail/retry scheduling). Redis Pub/Sub is at-most-once / non-durable for this purpose and is **forbidden** as the correctness path.

## Error mapping

Driver failures are mapped into the Phase 9 `StoreErrorCode` taxonomy (`StoreUnavailableError`, `StoreTimeoutError`, `StoreLeaseLostError`, …). Messages are sanitized — no secret or full-URL leakage.

---

## Related

- [overview.md](./overview.md)
- [key-design.md](./key-design.md)
- [scripts-atomicity.md](./scripts-atomicity.md)
- [workspace-boundaries.md](../../../docs/workspace-boundaries.md)
