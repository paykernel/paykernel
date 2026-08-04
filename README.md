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
| [`packages/testkit`](./packages/testkit)                   | [`@paykernel/testkit`](./packages/testkit)                               | Mock gateway, conformance, Phase 9 store contracts, NON-PRODUCTION memory stores                     |
| [`packages/store-postgres`](./packages/store-postgres) | [`@paykernel/store-postgres`](./packages/store-postgres)             | Phase 12 PostgreSQL durable stores (idempotency, webhook inbox, reconciliation); multi-host claims   |
| [`packages/store-redis`](./packages/store-redis)       | [`@paykernel/store-redis`](./packages/store-redis)                   | Phase 13 **optional** Redis/Valkey/Upstash stores (Lua claims); not required to use the SDK          |
| [`packages/store-sqlite`](./packages/store-sqlite)     | [`@paykernel/store-sqlite`](./packages/store-sqlite)                 | Phase 14 **single-host** SQLite stores (Bun/Node/better-sqlite3); not multi-host                     |
| [`packages/store-turso`](./packages/store-turso)       | [`@paykernel/store-turso`](./packages/store-turso)                   | Phase 15 **multi-host remote** Turso/libSQL stores; not local SQLite; no `/sync`                     |
| [`packages/store-d1`](./packages/store-d1) | [`@paykernel/store-d1`](./packages/store-d1) | Phase 16 **multi-host** Cloudflare D1 stores (Workers binding); not local SQLite; not Turso; not DO |
| [`packages/store-durable-objects`](./packages/store-durable-objects) | [`@paykernel/store-durable-objects`](./packages/store-durable-objects) | Phase 17 **multi-host partitioned** SQLite-backed Durable Objects; not D1; not local SQLite; not Turso |
| [`internal/sql-store`](./internal/sql-store)               | `@paykernel/internal-sql-store` (**private**; never published)           | Phase 11 relational foundation: schemas, migrations, atomic claim templates for adapters             |

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

```
paykernel/                         # private workspace root (not published)
├── packages/
│   ├── core/                      # @paykernel/core (publishable; portable)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── README.md
│   ├── webhooks/                  # @paykernel/webhooks (publishable; portable)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── docs/                  # webhook-inbox.md, crash-boundaries.md
│   │   ├── package.json
│   │   └── README.md
│   ├── reconciliation/            # @paykernel/reconciliation (Phase 19; portable)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── docs/                  # overview, reconciliation, safe-lookup, scheduling, batch, crash-boundaries
│   │   ├── package.json
│   │   └── README.md
│   ├── observability/             # @paykernel/opentelemetry (Phase 20; portable)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── docs/                  # overview, operation-context, metrics, redaction, opentelemetry, instrumentation
│   │   ├── package.json
│   │   └── README.md
│   ├── routing/                   # @paykernel/routing (Phase 21; portable)
│   │   ├── src/
│   │   ├── dist/
│   │   ├── docs/                  # overview, routing-inputs, selection, safe-fallback, telemetry
│   │   ├── package.json
│   │   └── README.md
│   ├── testkit/                   # @paykernel/testkit (publishable; portable)
│   │   ├── src/
│   │   ├── package.json
│   │   └── README.md
│   ├── store-postgres/            # @paykernel/store-postgres (Phase 12)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── README.md
│   ├── store-redis/               # @paykernel/store-redis (Phase 13; optional)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── README.md
│   ├── store-sqlite/              # @paykernel/store-sqlite (Phase 14; single-host)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── README.md
│   ├── store-turso/               # @paykernel/store-turso (Phase 15; multi-host remote)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── package.json
│   │   └── README.md
│   ├── store-d1/     # @paykernel/store-d1 (Phase 16; multi-host D1)
│   │   ├── src/
│   │   ├── docs/
│   │   ├── examples/              # wrangler.toml
│   │   ├── migrations/
│   │   ├── package.json
│   │   └── README.md
│   └── store-durable-objects/     # @paykernel/store-durable-objects (Phase 17; partitioned SQLite DO)
│       ├── src/
│       ├── docs/
│       ├── examples/              # wrangler.toml (new_sqlite_classes)
│       ├── package.json
│       └── README.md
├── internal/
│   └── sql-store/                 # @paykernel/internal-sql-store (private; Phase 11)
├── scripts/                       # monorepo tooling (baseline, pack, smoke, boundaries)
├── docs/
│   ├── monorepo.md                # workspace DX guide
│   ├── workspace-boundaries.md    # package boundary policy
│   ├── releases.md                # changesets / publish
│   └── adapter-selection.md       # Phase 18 capability matrix + decision tree
├── package.json                   # private workspaces root (packages/* + internal/*)
├── tsconfig.base.json             # shared TypeScript options
├── eslint.config.js               # shared ESLint flat config
├── .prettierrc                    # shared Prettier options
├── bunfig.toml
├── bun.lock
└── roadmap.md
```

## Development

Root scripts forward into workspace packages so Phase 0 command names stay stable:

```bash
bun install
bun run build
bun test
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

- **Monorepo DX:** [`docs/monorepo.md`](./docs/monorepo.md)
- **Workspace boundaries:** [`docs/workspace-boundaries.md`](./docs/workspace-boundaries.md)
- **Releases:** [`docs/releases.md`](./docs/releases.md)
- **Adapter selection (Phase 18):** [`docs/adapter-selection.md`](./docs/adapter-selection.md) — capability matrix, decision tree, recommended defaults (honest manifests)
- **Storage adapters pointer (core):** [`packages/core/docs/storage-adapters.md`](./packages/core/docs/storage-adapters.md)
- **Published package docs:** [`packages/core/docs/`](./packages/core/docs/)
- **Runtime portability (Phase 8):** [`packages/core/docs/runtime.md`](./packages/core/docs/runtime.md)
- **Store contracts / adapter manifests (Phase 9):** [`packages/testkit/docs/store-contracts.md`](./packages/testkit/docs/store-contracts.md)
- **Webhook inbox engine (Phase 10):** [`packages/webhooks/docs/webhook-inbox.md`](./packages/webhooks/docs/webhook-inbox.md)
- **Crash boundaries (10.6):** [`packages/webhooks/docs/crash-boundaries.md`](./packages/webhooks/docs/crash-boundaries.md)
- **SQL foundation (Phase 11):** [`internal/sql-store/docs/relational-foundation.md`](./internal/sql-store/docs/relational-foundation.md)
- **PostgreSQL adapter (Phase 12):** [`packages/store-postgres/docs/overview.md`](./packages/store-postgres/docs/overview.md)
- **Redis adapter (Phase 13, optional):** [`packages/store-redis/docs/overview.md`](./packages/store-redis/docs/overview.md)
- **SQLite adapter (Phase 14, single-host):** [`packages/store-sqlite/docs/overview.md`](./packages/store-sqlite/docs/overview.md)
- **Turso adapter (Phase 15, multi-host remote):** [`packages/store-turso/docs/overview.md`](./packages/store-turso/docs/overview.md)
- **Cloudflare D1 adapter (Phase 16, multi-host Workers):** [`packages/store-d1/docs/overview.md`](./packages/store-d1/docs/overview.md)
- **Cloudflare DO adapter (Phase 17, multi-host partitioned):** [`packages/store-durable-objects/docs/overview.md`](./packages/store-durable-objects/docs/overview.md)
- **Behavioral contracts:** [`packages/core/docs/behavioral-contracts.md`](./packages/core/docs/behavioral-contracts.md)
- **Phase 0 baseline:** [`packages/core/docs/baseline/`](./packages/core/docs/baseline/)
- **Roadmap:** [`roadmap.md`](./roadmap.md)
- **Core README:** [`packages/core/README.md`](./packages/core/README.md)
- **Webhooks README:** [`packages/webhooks/README.md`](./packages/webhooks/README.md)
- **Testkit README:** [`packages/testkit/README.md`](./packages/testkit/README.md)
- **Adapter postgres README:** [`packages/store-postgres/README.md`](./packages/store-postgres/README.md)
- **Adapter redis README:** [`packages/store-redis/README.md`](./packages/store-redis/README.md)
- **Adapter sqlite README:** [`packages/store-sqlite/README.md`](./packages/store-sqlite/README.md)
- **Adapter turso README:** [`packages/store-turso/README.md`](./packages/store-turso/README.md)
- **Adapter cloudflare-d1 README:** [`packages/store-d1/README.md`](./packages/store-d1/README.md)
- **Adapter cloudflare-do README:** [`packages/store-durable-objects/README.md`](./packages/store-durable-objects/README.md)

## License

MIT
