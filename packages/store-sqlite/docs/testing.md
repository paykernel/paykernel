# Testing — SQLite adapter

**Package:** `@paykernel/store-sqlite`  
**Conformance:** Phase 9 suites from `@paykernel/testkit`  
**Contracts:** [store-contracts.md](../../testkit/docs/store-contracts.md)

---

## Run

```bash
# From monorepo root
bun run test:adapter-sqlite
# or
bun test packages/store-sqlite

# Package-local
cd packages/store-sqlite
bun test
```

---

## What the suite covers

| Area | Notes |
| ---- | ----- |
| Unit | Errors, mapping, public API surface, import-no-migrate |
| Conformance | All three Phase 9 stores (idempotency, webhook inbox, reconciliation) |
| Bun memory | `:memory:` SQLite + FakeClock |
| Bun file-backed | Temp file, WAL, restart-friendly paths |
| Contention | Multi-connection same-file claims under Bun |
| busy_timeout / WAL | Pragma helpers and writer contention behavior |
| Restart | File-backed durability across reopen |
| Migrate | Explicit migrate / verify; no migrate on import or default create |

---

## FakeClock

Pass `createFakeClock()` from `@paykernel/testkit` as `clock` so lease reclaim is deterministic:

```ts
import { createFakeClock } from "@paykernel/testkit";
import { createSqliteIdempotencyStore } from "@paykernel/store-sqlite";

const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
const store = createSqliteIdempotencyStore({ executor, clock });
// … acquire with short leaseMs …
clock.advance(2_000);
// … reclaim succeeds …
```

Stores **must** use the injected clock for lease predicates (not only wall-clock `Date.now()`), so conformance lease tests remain honest.

---

## In-memory helpers

```ts
import {
  createInMemoryBunSqliteExecutor,
  createInMemoryBunSqliteStores,
  createBunSqliteStoresInMemory,
  migrateSqliteAdapter,
} from "@paykernel/store-sqlite/bun";

const { executor, close } = createInMemoryBunSqliteExecutor();
// Helper applies test-friendly pragmas; it does NOT migrate schema.
await migrateSqliteAdapter(executor);

// Or full store bundle (also no migrate):
const bundle = createInMemoryBunSqliteStores(); // alias: createBunSqliteStoresInMemory
await migrateSqliteAdapter(bundle.executor);
// … use bundle.idempotency / webhookInbox / reconciliation …
bundle.close();
```

`:memory:` is process-local only — fine for unit/conformance, not a durable production deployment.

---

## Skip-clean bindings

| Binding | When suite runs | When skipped |
| ------- | --------------- | ------------ |
| Bun `bun:sqlite` | Default on Bun CI | — |
| `node:sqlite` | Node ≥ 22.5 with module present | Unavailable → **skip cleanly** (no fail) |
| `better-sqlite3` | Peer installed and native module loads | Not installed / Bun ABI mismatch → **skip cleanly** |

Mock DatabaseSync / better-sqlite3 surfaces always exercise the executor adapter without claiming multi-host coordination.

Do not fail the whole monorepo gate because optional drivers are missing on a machine.

---

## Concurrency scope

| Proven here | Not claimed |
| ----------- | ----------- |
| Same-host multi-connection claims on one file (Bun) | Multi-host / network FS coordination |
| Same-isolate concurrent claims (testkit concurrency option) | Distributed lock correctness across hosts |
| Dual fencing after reclaim/renew | Multi-region active-active |

---

## Import-no-migrate / factory-no-migrate

Tests assert:

1. Importing `@paykernel/store-sqlite` does not create tables.
2. Default `createSqlite*Stores` / driver factory construction does not migrate.
3. Schema appears only after explicit `migrateSqliteAdapter`.

---

## Related

- [drivers.md](./drivers.md)
- [migrations.md](./migrations.md)
- [claims.md](./claims.md)
- adapter-postgres [testing.md](../../store-postgres/docs/testing.md) (env-gated multi-host pattern contrast)
