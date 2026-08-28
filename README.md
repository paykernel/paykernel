# PayKernel

A type-safe payment orchestration toolkit for TypeScript, built for MENA payment providers and modern server runtimes.

> The payment orchestration kernel for TypeScript.

**Repository:** [paykernel/paykernel](https://github.com/paykernel/paykernel) · **npm scope:** `@paykernel`

## Packages

| Package                                                    | Name                                                                             | Description                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`packages/core`](./packages/core)                         | [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core) | Publishable unified payment SDK (Moyasar, PayPal, Paymob, Stripe)                                    |
| [`packages/webhooks`](./packages/webhooks)                 | [`@paykernel/webhooks`](./packages/webhooks)                             | Portable webhook inbox engine (claim, lease fencing, modes, processing outcomes) — Phase 10          |
| [`packages/reconciliation`](./packages/reconciliation)     | [`@paykernel/reconciliation`](./packages/reconciliation)                 | Portable reconciliation primitives (safe lookup, drift, decision-only policy, store-backed schedule) — Phase 19 |
| [`packages/observability`](./packages/observability)       | [`@paykernel/opentelemetry`](./packages/observability)                   | Phase 20 portable metrics, spans, redacting telemetry glue, optional OTEL bridge (no hard OTEL in core) |
| [`packages/routing`](./packages/routing)                   | [`@paykernel/routing`](./packages/routing)                               | Phase 21 portable select-only gateway routing + restricted post-attempt fallback eligibility (core-only) |
| [`packages/testkit`](./packages/testkit)                   | [`@paykernel/testkit`](./packages/testkit)                               | Mock gateway, conformance, store-contracts re-exports, NON-PRODUCTION memory stores                   |
| [`packages/store-contracts`](./packages/store-contracts) | [`@paykernel/store-contracts`](https://www.npmjs.com/package/@paykernel/store-contracts) | Publishable Phase 9 portable store contracts (lease stores, errors, manifests) |
| [`packages/sql-foundation`](./packages/sql-foundation) | [`@paykernel/sql-foundation`](https://www.npmjs.com/package/@paykernel/sql-foundation) | Publishable Phase 11 relational foundation (schemas, migrations, claim SQL templates) |
| [`packages/store-postgres`](./packages/store-postgres) | [`@paykernel/store-postgres`](./packages/store-postgres)             | Phase 12 PostgreSQL durable stores (idempotency, webhook inbox, reconciliation); multi-host claims   |
| [`packages/store-redis`](./packages/store-redis)       | [`@paykernel/store-redis`](./packages/store-redis)                   | Phase 13 **optional** Redis/Valkey/Upstash stores (Lua claims); not required to use the SDK          |
| [`packages/store-sqlite`](./packages/store-sqlite)     | [`@paykernel/store-sqlite`](./packages/store-sqlite)                 | Phase 14 **single-host** SQLite stores (Bun/Node/better-sqlite3); not multi-host                     |
| [`packages/store-turso`](./packages/store-turso)       | [`@paykernel/store-turso`](./packages/store-turso)                   | Phase 15 **multi-host remote** Turso/libSQL stores; not local SQLite; no `/sync`                     |
| [`packages/store-d1`](./packages/store-d1) | [`@paykernel/store-d1`](./packages/store-d1) | Phase 16 **multi-host** Cloudflare D1 stores (Workers binding); not local SQLite; not Turso; not DO |
| [`packages/store-durable-objects`](./packages/store-durable-objects) | [`@paykernel/store-durable-objects`](./packages/store-durable-objects) | Phase 17 **multi-host partitioned** SQLite-backed Durable Objects; not D1; not local SQLite; not Turso |
| [`internal/sql-store`](./internal/sql-store)               | `@paykernel/internal-sql-store` (**private**; never published)           | Thin re-export of `@paykernel/sql-foundation` (BC shim; adapters depend on sql-foundation)             |

Consumer install:

```bash
bun add @paykernel/core
# optional inbox engine:
bun add @paykernel/webhooks
# optional reconciliation domain package (no mandatory queue):
bun add @paykernel/reconciliation
# optional observability (metrics / spans / redacting telemetry; no mandatory OTEL):
bun add @paykernel/opentelemetry
# optional safe routing policies (select-only; no auto multi-gateway retry after indeterminate):
bun add @paykernel/routing
# optional durable Postgres stores (app layer):
bun add @paykernel/store-postgres
# optional Redis coordination stores (app layer; Redis never required):
bun add @paykernel/store-redis
# optional single-host SQLite stores (app layer; not multi-host):
bun add @paykernel/store-sqlite
# optional multi-host remote Turso/libSQL stores (app layer; not local SQLite):
bun add @paykernel/store-turso
# optional multi-host Cloudflare D1 stores (Workers binding; not sqlite/turso/DO):
bun add @paykernel/store-d1
# optional multi-host partitioned Durable Object stores (Workers DO; not D1/sqlite/turso):
bun add @paykernel/store-durable-objects
# or
npm install @paykernel/core
```

```typescript
import { PaymentClient } from "@paykernel/core";
// optional:
// import { createWebhookInboxEngine } from "@paykernel/webhooks";
// import { createPaymentReconciler } from "@paykernel/reconciliation";
// import { withPaymentOperation, createInMemoryPaymentMetrics } from "@paykernel/opentelemetry";
// import { createPaymentRouter, route } from "@paykernel/routing";
// import { createPostgresStores } from "@paykernel/store-postgres";
// import { createRedisStores } from "@paykernel/store-redis";
// import { createSqliteStores } from "@paykernel/store-sqlite";
// import { createTursoStores } from "@paykernel/store-turso";
// import { createD1PaymentStores } from "@paykernel/store-d1";
// import { createDoPaymentStores } from "@paykernel/store-durable-objects";
```

## Package structure (monorepo)

Workspaces are `packages/*`, `internal/*`, and `examples/*`. The root package is private and is never published. Layout, build order, and commands: [`docs/monorepo.md`](./docs/monorepo.md).

## Development

Root scripts forward into workspace packages so Phase 0 command names stay stable:

```bash
bun install
bun run build
bun test
bun test examples
bun run test:coverage
bun run typecheck
bun run typecheck:types
bun run typecheck:all
bun run format
bun run format:check
bun run lint
bun run check:boundaries
bun run check:runtime-portability
bun run test:runtime
bun run pack:check
bun run publint
bun run attw
bun run validate:package
bun run baseline
```

Package-local work:

```bash
cd packages/core
bun run build
bun test

cd packages/webhooks
bun run build
bun test

cd packages/testkit
bun run build
bun test

cd packages/store-postgres
bun run build
bun test
# live PG: export PAYMENTS_SDK_PG_URL=postgres://… then bun test

cd packages/store-redis
bun run build
bun test
# live Redis: export PAYMENTS_SDK_REDIS_URL=redis://… then bun test

cd packages/store-sqlite
bun run build
bun test

cd packages/store-turso
bun run build
bun test
# live Turso: export TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… then bun test

cd packages/store-d1
bun run build
bun test
# default: mock D1 CI path; live/miniflare skip unless harness env set

cd packages/store-durable-objects
bun run build
bun test
# default: mock DO SQL CI path; live/miniflare skip unless harness env set
```

See [`docs/monorepo.md`](./docs/monorepo.md) for layout details, boundary rules, and release notes.

## Documentation

**Start here:** [`docs/README.md`](./docs/README.md) · [`docs/getting-started.md`](./docs/getting-started.md) (create payment → verify → inbox claim → fulfill → reconcile)

| Audience | Docs |
| --- | --- |
| First payment / production composition | [`docs/getting-started.md`](./docs/getting-started.md) |
| Which store | [`docs/adapter-selection.md`](./docs/adapter-selection.md) |
| Examples | [`examples/README.md`](./examples/README.md) — private checkout kernel + Bun Hono/Elysia (single-host in-memory SQLite) |
| Core | [`packages/core/README.md`](./packages/core/README.md) · [money](./packages/core/docs/money.md) · [outcomes](./packages/core/docs/operation-results.md) · [webhooks](./packages/core/docs/webhooks.md) · [events](./packages/core/docs/webhook-events.md) · [runtime](./packages/core/docs/runtime.md) |
| Inbox | [`packages/webhooks/README.md`](./packages/webhooks/README.md) · [webhook-inbox.md](./packages/webhooks/docs/webhook-inbox.md) |
| Reconciliation | [`packages/reconciliation/README.md`](./packages/reconciliation/README.md) |
| Routing | [`packages/routing/README.md`](./packages/routing/README.md) |
| Extra gateways | [Tap Payments](./packages/gateway-tap/README.md) (`@paykernel/gateway-tap`) · [MyFatoorah](./packages/gateway-myfatoorah/README.md) (`@paykernel/gateway-myfatoorah`) — Phase 23; not core built-ins |
| Observability | [`packages/observability/README.md`](./packages/observability/README.md) (`@paykernel/opentelemetry`) |
| Contracts | [`packages/store-contracts/README.md`](./packages/store-contracts/README.md) · [contracts.md](./packages/store-contracts/docs/contracts.md) |
| SQL foundation | [`packages/sql-foundation/README.md`](./packages/sql-foundation/README.md) · [relational-foundation.md](./packages/sql-foundation/docs/relational-foundation.md) |
| Testkit | [`packages/testkit/README.md`](./packages/testkit/README.md) |
| Stores | [postgres](./packages/store-postgres/README.md) · [redis](./packages/store-redis/README.md) · [sqlite](./packages/store-sqlite/README.md) · [turso](./packages/store-turso/README.md) · [d1](./packages/store-d1/README.md) · [durable objects](./packages/store-durable-objects/README.md) |
| Contributors | [`docs/monorepo.md`](./docs/monorepo.md) · [`docs/workspace-boundaries.md`](./docs/workspace-boundaries.md) · [`docs/releases.md`](./docs/releases.md) |

`roadmap.md` is a completed phase log (0–25 shipped, Phase 23 leftover gateways) plus leftover product work. It is not the consumer index. Phase 25 (1.0): 1.0 contract cut, compat CI, `bun-hono-postgres` RC.

## License

MIT
