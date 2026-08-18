# Testing the PostgreSQL adapter

## Quick matrix

| Suite | Needs live PG? | How to run |
| ----- | -------------- | ---------- |
| Unit / public API / errors / import-no-migrate | **No** | `bun test packages/store-postgres` |
| Driver binding smoke (`drivers.unit.test.ts`) | **No** | same — constructs executors without connecting |
| Conformance (all three contracts × postgres-js + pg) | **Yes** (skip when unset) | set URL then `bun test packages/store-postgres` |
| Multi-connection concurrent claim (A1) | **Yes** | same |
| Integration: txn rollback, stale lease, migrate, unavailable | **Yes** | same |
| Migrate unit + live | partial unit without PG | same |

Live tests use:

```text
PAYMENTS_SDK_PG_URL   # preferred
DATABASE_URL          # fallback
```

**Local file (recommended):** copy `.env.example` → `.env` under `packages/store-postgres/`:

```bash
cp packages/store-postgres/.env.example packages/store-postgres/.env
# edit PAYMENTS_SDK_PG_URL
bun test packages/store-postgres
```

`src/test-utils/pg-env.ts` loads that `.env` automatically (does not override already-exported env vars). `.env` is **gitignored** — only `.env.example` is committed.

When neither env nor `.env` is set, live suites are **`describe.skipIf(!hasLivePostgres())`** — CI stays green without Postgres.

## Unit (no live PG)

From monorepo root:

```bash
bun test packages/store-postgres
# or
cd packages/store-postgres && bun test
```

Covers factories, error mapping, import-does-not-migrate, and other offline paths.

## Live PostgreSQL

### Env

```bash
export PAYMENTS_SDK_PG_URL="postgres://payments:payments@127.0.0.1:5432/payments_sdk"
# or
export DATABASE_URL="postgres://…"
```

### Supabase / managed hosts

Direct `db.<project>.supabase.co:5432` is often **IPv6-only**. From IPv4-only networks, use the **session pooler**:

```bash
# Session mode (port 5432 on pooler) — preferred for multi-connection / transaction tests
export PAYMENTS_SDK_PG_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
```

`node-postgres` live tests use `createNodePgPoolConfig()` which sets
`ssl: { rejectUnauthorized: false }` for Supabase / `sslmode=require` so intermediate
cert chains work in CI/dev. Production apps should pin the provider CA instead.

Optional override:

```bash
export PAYMENTS_SDK_PG_SSL_NO_VERIFY=1
```

### docker-compose (package-local)

```bash
docker compose -f packages/store-postgres/docker-compose.yml up -d
export PAYMENTS_SDK_PG_URL=postgres://payments:payments@127.0.0.1:54329/payments_sdk
bun test packages/store-postgres
```

`packages/store-postgres/docker-compose.yml` runs **postgres:16-alpine** on host port **54329** (avoids clashing with a local 5432). Tests use unique `tablePrefix` namespaces and drop foundation tables in `finally`.

## Conformance suites (A3 multi-binding)

Wired in `src/conformance.postgres.test.ts` to testkit:

- `runIdempotencyStoreConformanceSuite`
- `runWebhookInboxStoreConformanceSuite`
- `runReconciliationStoreConformanceSuite`

**Primary binding:** `postgres-js` (`createPostgresJsPostgresExecutor`) — each suite as its own test.  
**Secondary binding:** `pg` Pool (`createPgPostgresExecutor`) — all three suites in one live test.

Factories receive `{ clock }` so **FakeClock** drives lease expiry. Lease reclaim predicates bind injectable `now` into SQL templates — they do not hard-depend on `SQL NOW()` for test paths.

Example pattern (illustrative):

```ts
await runIdempotencyStoreConformanceSuite({
  name: "postgres-idempotency",
  createStore: async ({ clock }) =>
    createPostgresIdempotencyStore({
      executor,
      clock,
      namespace: { tablePrefix: prefix },
    }),
});
```

## Multi-connection contention (A1)

`src/multi-connection.test.ts` and `src/integration.postgres.test.ts` open **≥2 independent clients** against the same database and race concurrent `reserve`:

- Exactly one `acquired`
- Others `in_progress`
- Engine-level `ON CONFLICT` / conditional update — not a process mutex

This is multi-process safety evidence for advertising `multi-host` + `claims: "strong"`.

## Other live proofs

| Test | File | Asserts |
| ---- | ---- | ------- |
| Transaction rollback | `integration.postgres.test.ts` | `withTransaction` + throw → no durable claim row |
| Stale lease token | multi-connection + integration | old token → `StoreLeaseLostError` |
| Migrate idempotent | migrate + integration | empty → migrate → verify; second migrate no-op |
| Connection unavailable | integration | `ECONNREFUSED` / bad port → `StoreUnavailableError` |

## Injectable clock

```ts
import { createFakeClock } from "@paykernel/testkit";
import { createPostgresIdempotencyStore } from "@paykernel/store-postgres";

const clock = createFakeClock();
const store = createPostgresIdempotencyStore({ executor, clock, namespace });
// advance clock → lease expiry → peer reclaim
```

Default without `clock` is wall-clock system time.

## Monorepo scripts

Root:

```bash
bun run build      # includes adapter-postgres after sql-store
bun run typecheck  # includes adapter-postgres
bun test           # includes packages/store-postgres
bun run test:adapter-postgres
```

## Related

- [store-contracts.md](../../store-contracts/docs/contracts.md) — suite semantics
- [guarantees.md](./guarantees.md) — what multi-host means
- [crash-boundaries.md](./crash-boundaries.md)
