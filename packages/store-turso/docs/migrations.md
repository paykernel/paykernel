# Migrations — Turso adapter

**Helpers:** `migrateTursoAdapter`, `verifyTursoAdapterSchema`  
**Foundation:** [`@paykernel/sql-foundation` migrations](../../sql-foundation/docs/migrations.md)  
**Dialect:** **`sqlite`** (sql-store foundation schema + sqlite claim templates)

## Policy (non-negotiable)

| Rule | Detail |
| ---- | ------ |
| Explicit only | Call migrate from app bootstrap, deploy job, or CLI — never as a silent side effect |
| Never on import | Importing `@paykernel/store-turso` does not open a connection or apply DDL |
| Never on default factory | `createTurso*Store` / `createTursoStores` do **not** migrate |
| Idempotent | Already-applied foundation versions are skipped |
| Operator-owned | You choose upgrade windows and rollouts |

Covered by package tests (`import-no-migrate.test.ts`, `migrate.turso.test.ts`).

## Apply

```ts
import {
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
  type TursoExecutor,
} from "@paykernel/store-turso";

const executor: TursoExecutor = /* from driver binding or custom */;

// Optional namespace (validated identifiers only):
const namespace = { tablePrefix: "pay_" };

const result = await migrateTursoAdapter(executor, {
  namespace,
  // nowIso?: string  — for applied_at (tests / FakeClock)
  // targetVersion?: number
});

const check = await verifyTursoAdapterSchema(executor, { namespace });
if (!check.ok) {
  throw new Error(check.errors.join("; "));
}
```

Dialect is fixed to **`sqlite`** inside the adapter helpers (wraps sql-store `migrate` / `verifySchema`).

### Driver subpaths

Subpaths re-export the same helpers for convenience:

```ts
import { migrateTursoAdapter } from "@paykernel/store-turso/libsql";
// same for /serverless
```

## What gets created

Foundation logical tables (names resolved via `createSchemaNamespace` / `resolveTableName`):

| Logical table | Role |
| ------------- | ---- |
| `payment_idempotency` | Lease-aware mutation idempotency |
| `payment_webhook_inbox` | Webhook inbox claims |
| `payment_reconciliation_jobs` | Reconciliation job schedule / claim |
| `payment_storage_migrations` | Applied version ledger |

Timestamps use portable **TEXT ISO-8601**. Generations are **INTEGER**; lease tokens are **TEXT**. No JS `number` for 64-bit ID semantics beyond what INTEGER SQLite provides for generation counters.

## Verify without applying

```ts
const check = await verifyTursoAdapterSchema(executor, {
  namespace,
  expectedVersion: /* optional pin */,
  listTables: async () => /* optional custom discovery */,
});
```

Use in health checks or pre-flight deploy gates.

## Production checklist

1. Provision a **shared remote** Turso / libSQL database (all workers use the same URL).
2. Grant DDL for migrate role (or run migrations from a privileged job).
3. Run `migrateTursoAdapter` once per environment (or as a deploy step).
4. `verifyTursoAdapterSchema` before routing traffic.
5. Construct stores with the **same** namespace used for migrate.
6. Do not run migrate on every request or inside hot factory paths.
7. Do not use Drizzle push as the source of truth for foundation payment tables — prefer sql-store migrate (see [drizzle.md](./drizzle.md)).

## Related

- [overview.md](./overview.md)
- [drivers.md](./drivers.md)
- [testing.md](./testing.md)
- sql-store [migrations.md](../../../internal/sql-store/docs/migrations.md)
