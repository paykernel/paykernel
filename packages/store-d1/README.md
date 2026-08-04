# @paykernel/store-d1

Cloudflare **D1** durable stores for `@paykernel/core` lease-aware **idempotency**, **webhook inbox**, and **reconciliation** contracts (Phase 9).

> **Phase 16 production adapter.** Multi-host safe when all Worker instances share one D1 database via Workers binding. Claims use engine-level conditional writes (`INSERT … ON CONFLICT` / `UPDATE … RETURNING`), not application get-then-set.
>
> This is **not** `packages/store-sqlite` (local single-host file DB).  
> This is **not** `packages/store-turso` (Turso / libSQL clients).  
> Durable Objects is a **separate** package ([`@paykernel/store-durable-objects`](../store-durable-objects/README.md), Phase 17) — not this one.

## Install

```bash
bun add @paykernel/store-d1
# optional DX types (not required at runtime):
bun add -d @cloudflare/workers-types
```

## Quick start (Workers binding)

```ts
import {
  createD1PaymentStores,
  migrateD1Adapter,
} from "@paykernel/store-d1";

// Explicit migrate — NEVER automatic on import or factory construction.
// Run once in ops/CI or a one-shot Worker, not on every request.
await migrateD1Adapter(env.PAYMENTS_DB);

const stores = createD1PaymentStores({
  db: env.PAYMENTS_DB,
  // Optional: read-after-write under D1 read replication
  // session: "first-primary",
});

const r = await stores.idempotency.reserve({
  key: "pay_123",
  fingerprint: "fp",
  owner: "worker-1",
  leaseMs: 30_000,
});
```

### Executor-based factories

```ts
import {
  createD1Executor,
  createD1IdempotencyStore,
  createD1Stores,
  migrateD1Adapter,
} from "@paykernel/store-d1";

const executor = createD1Executor(env.PAYMENTS_DB);
await migrateD1Adapter(executor);
const store = createD1IdempotencyStore({ executor });
// or
const bundle = createD1Stores({ executor });
```

Normal operation uses the **D1 Workers binding only** — no Cloudflare REST API or account token is required for store construction.

## Wrangler binding

See [`examples/wrangler.toml`](./examples/wrangler.toml):

```toml
name = "payments-worker"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "PAYMENTS_DB"
database_name = "payments"
database_id = "<your-d1-id>"
```

Migration SQL for Wrangler must **omit** `BEGIN`/`COMMIT` wrappers. Prefer explicit `migrateD1Adapter` for schema parity ([docs/migrations.md](./docs/migrations.md)).

## Claims (summary)

Prefer engine-level single-statement:

```sql
INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING …
```

Multi-statement only inside D1 `batch()` (transactional: failure aborts/rolls back the sequence). **Never** unprotected get-then-set across round-trips.

Details: [docs/claims.md](./docs/claims.md).

## Guarantees (honest)

| Field | Value |
| ----- | ----- |
| `coordinationScope` | `multi-host` (shared D1) |
| `durability` | `durable` |
| `consistency.claims` | `strong` |
| `consistency.readAfterWrite` | `session` |
| `consistency.staleReadsPossible` | `true` without Sessions under read replication |

See [docs/guarantees.md](./docs/guarantees.md) and `D1_STORAGE_ADAPTER_MANIFEST`.

## Docs

See monorepo [`docs/adapter-selection.md`](../../docs/adapter-selection.md) for the Phase 18 capability matrix and decision tree.

| Doc | Topic |
| --- | ----- |
| [overview](./docs/overview.md) | Package purpose and boundaries |
| [guarantees](./docs/guarantees.md) | Manifest honesty |
| [binding](./docs/binding.md) | D1 prepare/bind/run/batch/withSession; no REST required |
| [claims](./docs/claims.md) | Atomic UPSERT strategy |
| [sessions-and-replication](./docs/sessions-and-replication.md) | withSession / first-primary / stale replicas |
| [migrations](./docs/migrations.md) | Explicit migrate only; Wrangler notes |
| [crash-boundaries](./docs/crash-boundaries.md) | Crash / lease / isolate restart |
| [numeric-portability](./docs/numeric-portability.md) | TEXT IDs/tokens/hashes; ISO timestamps |
| [limits](./docs/limits.md) | Batch/CPU/multi-region; vs DO |
| [wrangler](./docs/wrangler.md) | Binding + deploy notes |
| [testing](./docs/testing.md) | Mock D1 + conformance + FakeClock |

## Boundaries

- Root entry does **not** import `cloudflare:workers`, `bun:sqlite`, `better-sqlite3`, `@libsql/client`, or Turso clients.
- Structural `D1DatabaseLike` types duck-type real Workers bindings.
- Core / webhooks / testkit must **not** depend on this package.
- `paymentsSdk.runtime: "cloudflare-only"`.
