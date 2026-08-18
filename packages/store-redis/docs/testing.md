# Testing the Redis adapter

## Quick matrix

| Suite | Needs live Redis? | How to run |
| ----- | ----------------- | ---------- |
| Unit / public API / errors / keys / script parsers / mocks | **No** | `bun test packages/store-redis` |
| Driver smoke + binding parity (tagged EVAL) | **No** | same (`drivers/drivers.unit.test.ts`) |
| Bun topology reject (cluster/sentinel/clusterKeys) | **No** | same |
| Lua atomicity source policy (no JS get-then-set) | **No** | same |
| Conformance (all three contracts + FakeClock) | **Yes** (skip when unset) | set URL then `bun test packages/store-redis` |
| Multi-connection / concurrent claim | **Yes** | same |
| Lease reclaim / stale token / deleteExpired / INFO version | **Yes** | same |

Live tests use (preferred first):

```text
PAYMENTS_SDK_REDIS_URL   # preferred
REDIS_URL                # fallback
VALKEY_URL               # fallback
```

When none is set, live suites use **`describe.skipIf(!hasLiveRedis())`** — CI stays green without Redis.

When the URL **is** set, live integration/conformance **must run (not skip) and pass**.

Helpers: `src/test-utils/redis-env.ts` (`getRedisUrl`, `hasLiveRedis`, `createLivePort`, `uniqueKeyPrefix`).

Primary live binding under Bun: native `Bun.RedisClient`; fallbacks: ioredis (`enableOfflineQueue: false`), then node-redis.

## Unit (no live Redis)

From monorepo root:

```bash
bun test packages/store-redis
# or
cd packages/store-redis && bun test
```

Covers factories, error mapping/sanitization, key design, tagged result parsers, Bun cluster reject, public API (root must not import drivers), and store logic against mock ports.

## Live Redis / Valkey

### Env

```bash
export PAYMENTS_SDK_REDIS_URL="redis://127.0.0.1:6379"
# optional aliases:
# export REDIS_URL=…
# export VALKEY_URL=…
bun test packages/store-redis
```

Prefer `PAYMENTS_SDK_REDIS_URL` in monorepo scripts and CI.

### docker-compose (package-local)

```bash
docker compose -f packages/store-redis/docker-compose.yml up -d
export PAYMENTS_SDK_REDIS_URL=redis://127.0.0.1:33027
# optional parity aliases for local shells:
export REDIS_URL=redis://127.0.0.1:33027
bun test packages/store-redis
```

`packages/store-redis/docker-compose.yml` runs **redis:7.2-alpine** on host port **33027** (avoids clashing with a local 6379). Tests use unique key prefixes per run (`uniqueKeyPrefix`).

### TLS / Valkey / Redis 7.2+

- Target **Redis 7.2+** or compatible Valkey for integration confidence.
- TLS (`rediss://`) is supported when the chosen driver is configured for TLS; enable in CI when infrastructure permits.
- Binding parity: same contracts via ioredis, node-redis, Upstash, and Bun (where runtime available).

## Conformance suites

Wired in `src/conformance.redis.test.ts` to testkit:

- `runIdempotencyStoreConformanceSuite`
- `runWebhookInboxStoreConformanceSuite`
- `runReconciliationStoreConformanceSuite`

Factories receive `{ clock }` so **FakeClock** drives lease expiry. Scripts bind injectable `nowMs` ARGV — they do not hard-depend on Redis `TIME` for test paths.

Example pattern (illustrative):

```ts
await runIdempotencyStoreConformanceSuite({
  name: "redis-idempotency",
  createStore: async ({ clock }) =>
    createRedisIdempotencyStore({
      port,
      clock,
      keys: { prefix: "psdk", tenantId: uniqueTenant },
    }),
});
```

## Injectable clock

```ts
import { createFakeClock } from "@paykernel/testkit";
import { createRedisIdempotencyStore } from "@paykernel/store-redis";

const clock = createFakeClock();
const store = createRedisIdempotencyStore({ port, clock, keys });
// clock.advance(…) → lease expiry → peer reclaim
```

Default without `clock` is wall-clock system time.

## Offline queue / reconnect

Live or unit proofs should prefer drivers with offline queue **disabled** for claim paths. Ambiguous reconnect must map to unavailable/timeout + reclaim, not silent double claim.

## Monorepo scripts

Root:

```bash
bun run build      # includes adapter-redis after adapter-postgres
bun run typecheck  # includes adapter-redis
bun test           # includes packages/store-redis
bun run test:adapter-redis
```

## Related

- [store-contracts.md](../../store-contracts/docs/contracts.md) — suite semantics
- [guarantees.md](./guarantees.md) — what multi-host means
- [crash-boundaries.md](./crash-boundaries.md)
- [drivers.md](./drivers.md)
