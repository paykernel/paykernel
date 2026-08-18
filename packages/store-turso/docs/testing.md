# Testing the Turso adapter

## Quick matrix

| Suite | Needs remote Turso? | How to run |
| ----- | ------------------- | ---------- |
| Unit / public API / errors / import-no-migrate | **No** | `bun test packages/store-turso` |
| Driver binding unit tests | **No** | same |
| Conformance (libsql `file:` / `:memory:`) | **No** | same — local libsql |
| Concurrency (local multi-connection file:) | **No** | same |
| Live remote multi-connection / multi-instance | **Yes** (skip when unset) | set `TURSO_*` / `LIBSQL_*` then test |
| FakeClock lease reclaim | **No** (local path) | conformance + package tests |

When remote env is unset, live suites are **skipped cleanly** — CI stays green without Turso Cloud credentials.

## Env vars (live remote)

Prefer first match:

```text
TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
LIBSQL_URL + LIBSQL_AUTH_TOKEN
PAYMENTS_SDK_TURSO_URL + PAYMENTS_SDK_TURSO_AUTH_TOKEN
```

```bash
export TURSO_DATABASE_URL="libsql://your-db.turso.io"
export TURSO_AUTH_TOKEN="…"
# or
export LIBSQL_URL="libsql://…"
export LIBSQL_AUTH_TOKEN="…"
bun test packages/store-turso
# or
bun run test:adapter-turso
```

Optional local file (package-local, gitignored):

```bash
# packages/store-turso/.env
TURSO_DATABASE_URL=libsql://…
TURSO_AUTH_TOKEN=…
```

`src/test-utils/turso-env.ts` loads `.env` automatically (does not override already-exported env vars). **Never commit tokens.**

`hasLiveTurso()` / `isRemoteTursoUrl()` gate remote suites. Local `file:` and `:memory:` do **not** require env.

## Unit (no remote)

From monorepo root:

```bash
bun test packages/store-turso
# or
cd packages/store-turso && bun test
```

Covers factories, error mapping (token redaction), import-does-not-migrate, public-api root-no-driver bans, and offline paths.

## Local libsql CI path

Use `@libsql/client` with `file:` or `:memory:` for full store conformance without Turso Cloud:

```ts
import { createClient } from "@libsql/client";
import {
  createLibsqlTursoExecutor,
  migrateTursoAdapter,
  createTursoIdempotencyStore,
} from "@paykernel/store-turso/libsql";

const client = createClient({ url: "file:./tmp-conformance.db" });
const executor = createLibsqlTursoExecutor(client);
await migrateTursoAdapter(executor, { namespace: { tablePrefix } });
const store = createTursoIdempotencyStore({ executor, clock, namespace });
```

This path validates SQLite dialect SQL and claim logic. It is **not** a substitute for env-gated multi-host remote concurrency proofs when advertising production remote multi-host.

## Conformance suites

Wired in `src/conformance.turso.test.ts` to testkit:

- `runIdempotencyStoreConformanceSuite`
- `runWebhookInboxStoreConformanceSuite`
- `runReconciliationStoreConformanceSuite`

Factories receive `{ clock }` so **FakeClock** drives lease expiry. Lease reclaim predicates bind injectable `now` into SQL — they do not hard-depend on wall clock alone.

## Multi-connection / multi-instance

`src/concurrency.turso.test.ts` (and related live suites) open **≥2 independent clients** against the same database and race concurrent `reserve` / `claim`:

- Exactly one `acquired`
- Others `in_progress`
- Engine-level UPSERT — not a process mutex

Serverless and libsql remote paths are exercised independently when env is set.

## Namespaces

Live and shared-DB tests use unique `tablePrefix` values (`uniqueTablePrefix()` in `turso-env.ts`) and drop foundation tables in `finally` where safe. Avoid colliding with production table names on shared databases.

## Injectable clock

```ts
import { createFakeClock } from "@paykernel/testkit";
import { createTursoIdempotencyStore } from "@paykernel/store-turso";

const clock = createFakeClock();
const store = createTursoIdempotencyStore({ executor, clock, namespace });
// advance clock → lease expiry → peer reclaim
```

Default without `clock` is wall-clock system time.

## Monorepo scripts

Root:

```bash
bun run build      # includes adapter-turso after adapter-sqlite
bun run typecheck  # includes adapter-turso
bun test           # includes packages/store-turso
bun run test:adapter-turso
```

## Related

- [store-contracts.md](../../store-contracts/docs/contracts.md) — suite semantics
- [guarantees.md](./guarantees.md) — what multi-host means
- [concurrency.md](./concurrency.md)
- [crash-boundaries.md](./crash-boundaries.md)
- [drivers.md](./drivers.md)
