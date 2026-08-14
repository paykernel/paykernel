# Migrations — PostgreSQL adapter

**Helpers:** `migratePostgresAdapter`, `verifyPostgresAdapterSchema`  
**Foundation:** [`internal/sql-store` migrations](../../../internal/sql-store/docs/migrations.md)

## Policy (non-negotiable)

| Rule | Detail |
| ---- | ------ |
| Explicit only | Call migrate from app bootstrap, deploy job, or CLI — never as a silent side effect |
| Never on import | Importing `@paykernel/store-postgres` does not open a connection or apply DDL |
| Never on default factory | `createPostgres*Store` / `createPostgresStores` do **not** migrate |
| Idempotent | Already-applied foundation versions are skipped |
| Operator-owned | You choose upgrade windows and rollouts |

Covered by package tests (`import-no-migrate.test.ts` and live migrate integration when PG URL is set).

## Apply

```ts
import {
  migratePostgresAdapter,
  verifyPostgresAdapterSchema,
  type PostgresExecutor,
} from "@paykernel/store-postgres";

const executor: PostgresExecutor = /* from driver binding or custom */;

// Optional namespace (validated identifiers only):
const namespace = { tablePrefix: "pay_", sqlSchema: "payments" };

const result = await migratePostgresAdapter(executor, {
  namespace,
  // nowIso?: string  — for applied_at (tests / FakeClock)
  // targetVersion?: number
});

const check = await verifyPostgresAdapterSchema(executor, { namespace });
if (!check.ok) {
  throw new Error(check.errors.join("; "));
}
```

Dialect is fixed to **`postgres`** inside the adapter helpers (wraps sql-store `migrate` / `verifySchema`).

When `namespace.sqlSchema` is set, `migratePostgresAdapter` / foundation `migrate()` issue `CREATE SCHEMA IF NOT EXISTS` for that validated identifier. Operators still need `CREATE` privilege — migrate does not grant it.

### Driver subpaths

Subpaths re-export the same helpers for convenience:

```ts
import { migratePostgresAdapter } from "@paykernel/store-postgres/pg";
// same for /postgres-js, /bun-sql, /drizzle
```

## What gets created

Foundation logical tables (names resolved via `createSchemaNamespace` / `resolveTableName`):

| Logical table | Role |
| ------------- | ---- |
| `payment_idempotency` | Lease-aware mutation idempotency |
| `payment_webhook_inbox` | Webhook inbox claims |
| `payment_reconciliation_jobs` | Reconciliation job schedule / claim |
| `payment_storage_migrations` | Applied version ledger |

Timestamps use portable **TEXT ISO-8601** at the foundation layer. Operators may use `TIMESTAMPTZ` at the DB boundary with casting; the contract surface remains ISO strings.

**Tenant (v1 honesty):** `tenantColumn` enables a nullable `tenant_id` column + index **only**. Foundation v1 DDL always emits that column and a `tenant_id` index (the flag does not omit them). v1 does **not** isolate tenants, does **not** write `tenant_id` from stores, and does **not** use a custom column name in DDL (always `tenant_id`). Primary key remains `key`. Operators who need isolation must prefix keys or wait for a later schema. Do not claim isolation.

**Statuses (CHECK-legal vs adapter writes):** postgres never writes idempotency `expired` (reclaim uses `lease_expires_at`). Webhook `fail` writes `pending` / `dead_letter`, not `failed`. `expired` and `failed` remain CHECK-legal for operator SQL and memory expire-on-read.

**Webhook operator columns:** `gateway`, `provider_event_id`, `first_received_at`, `last_received_at` exist for operator/index use. Store `claim()` does not populate them (`ClaimWebhookInput` has no `gateway`).

## Verify without applying

```ts
const check = await verifyPostgresAdapterSchema(executor, {
  namespace,
  expectedVersion: /* optional pin */,
  listTables: async () => /* optional custom discovery */,
});
```

Use in health checks or pre-flight deploy gates.

## Production checklist

1. Provision PostgreSQL (shared primary or HA cluster all workers use).
2. Grant DDL for migrate role (or run migrations from a privileged job). When `sqlSchema` is set, that role also needs `CREATE` so `CREATE SCHEMA IF NOT EXISTS` can succeed.
3. Run `migratePostgresAdapter` once per environment (or as a deploy step).
4. `verifyPostgresAdapterSchema` before routing traffic.
5. Construct stores with the **same** namespace used for migrate.
6. Do not run migrate on every request or inside hot factory paths.

## Related

- [overview.md](./overview.md)
- [drivers.md](./drivers.md)
- [testing.md](./testing.md)
- sql-store [migrations.md](../../../internal/sql-store/docs/migrations.md)
