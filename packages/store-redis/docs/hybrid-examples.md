# Hybrid deployment examples (roadmap §13.6)

Redis is **optional**. These patterns show how to compose adapters at the **application** layer. Core and webhooks never import adapters.

---

## 1. Bun Redis + PostgreSQL (recommended hybrid)

**Use when:** Bun app, shared Redis/Valkey for low-latency leases, PostgreSQL for durable audit / long retention.

```ts
import {
  createRedisIdempotencyStoreFromBun,
  createRedisWebhookInboxStoreFromBun,
} from "@paykernel/store-redis/bun";
import {
  createPostgresReconciliationStoreFromPg,
  migratePostgresAdapter,
  createPgPostgresExecutor,
} from "@paykernel/store-postgres/pg";
import { Pool } from "pg";
import { createWebhookInboxEngine } from "@paykernel/webhooks";

// Coordination: Redis
const idempotency = createRedisIdempotencyStoreFromBun({
  redis: { fromEnv: true }, // PAYMENTS_SDK_REDIS_URL / REDIS_URL / VALKEY_URL
});
const webhookInbox = createRedisWebhookInboxStoreFromBun({
  redis: { fromEnv: true },
});

// Durable audit / recon history: Postgres
const pool = new Pool({ connectionString: process.env.PAYMENTS_SDK_PG_URL });
const executor = createPgPostgresExecutor(pool);
await migratePostgresAdapter(executor);
const reconciliation = createPostgresReconciliationStoreFromPg({ client: pool });

const engine = createWebhookInboxEngine({ store: webhookInbox /* … */ });
```

Notes:

- Inject stores into the client/engine — do not put Redis inside core.
- Bun binding rejects Cluster/Sentinel; use a single Redis endpoint or a Cluster-capable binding for cluster.

---

## 2. Upstash Redis + Turso / D1 (serverless coordination)

**Use when:** edge/serverless workers, Upstash for coordination, Turso (Phase 15 `@paykernel/store-turso`) or D1 (Phase 16 `@paykernel/store-d1`) for durable history.

```ts
import { Redis } from "@upstash/redis";
import { createRedisStoresFromUpstash } from "@paykernel/store-redis/upstash";

const redis = Redis.fromEnv();
const { idempotency, webhookInbox, reconciliation } = createRedisStoresFromUpstash({
  client: redis,
});

// App also wires Turso (Phase 15) or D1 (Phase 16) for long-term durable stores.
// import { createTursoStoresFromServerless, migrateTursoAdapter } from "@paykernel/store-turso/serverless";
// import { createD1PaymentStores, migrateD1Adapter } from "@paykernel/store-d1";
// Prefer Postgres/Turso/D1 for multi-year audit durability; accept Redis retention limits explicitly when Redis-only.
```

Validate Upstash persistence/TTL plan against [persistence.md](./persistence.md). Do not assume HTTP Redis is a multi-year audit log.

---

## 3. Redis-only (explicit warnings)

**Use when:** you already operate Redis with **known** AOF/RDB (or managed persistence), retention policy, and monitoring — and accept operational risk.

Warnings:

1. Manifest durability is **configuration-dependent**, not `durable` like PostgreSQL.
2. Eviction, failover lag, and bad `appendfsync` can lose terminals and leases.
3. **Not** recommended as the sole long-term audit store (distinction #4).
4. Operators must document RPO/RTO; the adapter will not invent false durability.

```ts
import { createRedisStores } from "@paykernel/store-redis";
import { createPortFromIoredis } from "@paykernel/store-redis/ioredis";
import Redis from "ioredis";

const client = new Redis(process.env.PAYMENTS_SDK_REDIS_URL!, {
  enableOfflineQueue: false,
});
const stores = createRedisStores({
  port: createPortFromIoredis(client),
  retentionTtlMs: 7 * 24 * 60 * 60 * 1000, // explicit retention — not infinite audit
});
```

---

## 4. No-Redis PostgreSQL (full contracts without Redis)

**Use when:** you do not want Redis infrastructure at all (default recommendation for many apps).

```ts
import {
  createPostgresStoresFromPg,
  migratePostgresAdapter,
} from "@paykernel/store-postgres/pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.PAYMENTS_SDK_PG_URL });
await migratePostgresAdapter(/* executor */);
const stores = createPostgresStoresFromPg({ client: pool });
// All three Phase 9 contracts — no Redis install required.
```

This path proves **A5**: applications need not install or operate Redis to use the SDK’s safety model.

---

## Related

- [overview.md](./overview.md) — optional Redis
- [persistence.md](./persistence.md) — four distinctions
- [guarantees.md](./guarantees.md)
- Postgres adapter: [overview](../../store-postgres/docs/overview.md)
