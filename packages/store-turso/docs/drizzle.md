# Optional Drizzle notes (Phase 15.4)

**Package:** `@paykernel/store-turso`  
**Status:** **Docs-only** examples. Drizzle is **not** required for core adapter operation.  
There is no mandatory `./drizzle` export and no hard dependency on `drizzle-orm`.

---

## Non-negotiable rule

**Correctness-critical claims (`reserve` / `claim` / token-gated mutators) MUST go through**

`createTurso*Store` / `createTursoStores` (or subpath factories that wrap them)

**not** through raw Drizzle query builders alone.

| Path | OK for claims? |
| ---- | -------------- |
| `createTursoIdempotencyStore({ executor })` | **Yes** |
| `createTursoStoresFromLibsql` / `FromServerless` | **Yes** |
| Multi-step Drizzle `select` then `update` / `insert` | **No** — get-then-set races |
| Drizzle SQL fragments that preserve single-statement UPSERT + RETURNING | Only if equivalent to tested adapter SQL — prefer adapter stores |

See [claims.md](./claims.md).

---

## Recommended wiring

1. Apply foundation DDL with **`migrateTursoAdapter`** (sql-store dialect `sqlite`) — single source of truth for payment store tables.
2. Build a `TursoExecutor` from the same underlying libsql / serverless client your app uses.
3. Call `createTurso*Store({ executor, clock?, namespace? })`.
4. Optionally declare **read-only / join** mirrors of foundation columns with Drizzle in the **app** repo for analytics — not as the claim engine.

```ts
import { createClient } from "@libsql/client";
import {
  createLibsqlTursoExecutor,
  createTursoStores,
  migrateTursoAdapter,
} from "@paykernel/store-turso/libsql";
// If you also use Drizzle for app tables, keep payment claims on the adapter:

const client = createClient({
  url: process.env.LIBSQL_URL!,
  authToken: process.env.LIBSQL_AUTH_TOKEN,
});
const executor = createLibsqlTursoExecutor(client);
await migrateTursoAdapter(executor);

const { idempotency, webhookInbox, reconciliation } = createTursoStores({
  executor,
});
// use stores for reserve/claim/complete — not drizzle for those paths
```

---

## Example schema mirrors (optional)

These match sql-store foundation **column intent** for dialect sqlite (TEXT timestamps, INTEGER generation). Table names assume default namespace (no prefix). Adjust with your `tablePrefix` if used.

Illustrative Drizzle SQLite table definitions (app-owned; not exported by this package):

```ts
// app-owned example — do NOT use these alone for atomic claims
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const paymentIdempotency = sqliteTable("payment_idempotency", {
  key: text("key").primaryKey().notNull(),
  status: text("status").notNull(), // reserved | completed | indeterminate | expired
  fingerprint: text("fingerprint").notNull(),
  resultJson: text("result_json"),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  attempts: integer("attempts").notNull().default(0),
  generation: integer("generation").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  tenantId: text("tenant_id"),
  completedAt: text("completed_at"),
  indeterminateAt: text("indeterminate_at"),
  errorSanitized: text("error_sanitized"),
});

export const paymentWebhookInbox = sqliteTable("payment_webhook_inbox", {
  key: text("key").primaryKey().notNull(),
  status: text("status").notNull(), // pending | claimed | completed | failed | dead_letter
  payloadHash: text("payload_hash").notNull(),
  gateway: text("gateway"),
  providerEventId: text("provider_event_id"),
  payloadRef: text("payload_ref"),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  attempts: integer("attempts").notNull().default(0),
  generation: integer("generation").notNull().default(0),
  availableAt: text("available_at"),
  firstReceivedAt: text("first_received_at"),
  lastReceivedAt: text("last_received_at"),
  completedAt: text("completed_at"),
  lastErrorSanitized: text("last_error_sanitized"),
  tenantId: text("tenant_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const paymentReconciliationJobs = sqliteTable("payment_reconciliation_jobs", {
  key: text("key").primaryKey().notNull(),
  status: text("status").notNull(), // scheduled | claimed | completed | failed | manual_review
  subjectId: text("subject_id"),
  reason: text("reason"),
  dueAt: text("due_at").notNull(),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  attempts: integer("attempts").notNull().default(0),
  generation: integer("generation").notNull().default(0),
  lastErrorSanitized: text("last_error_sanitized"),
  tenantId: text("tenant_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});
```

### Do

- Use mirrors for reporting, joins, and typed reads in app code.
- Keep `migrateTursoAdapter` as DDL authority for these tables.

### Do not

- Replace `reserve`/`claim` with Drizzle multi-step get-then-set.
- Run dual migrations (Drizzle push **and** sql-store) that drift column sets.
- Store raw provider payloads/signatures by default in extra columns without a deliberate policy.

---

## Related

- [claims.md](./claims.md)
- [migrations.md](./migrations.md)
- [overview.md](./overview.md)
- sql-store [relational-foundation.md](../../../internal/sql-store/docs/relational-foundation.md)
