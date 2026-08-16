# Relational foundation (Phase 11)

**Package:** `@paykernel/sql-foundation` (`packages/sql-foundation`)  
**Status:** **Publishable** public package (npm). Private monorepo shim: `internal/sql-store` → `@paykernel/internal-sql-store` (thin re-export of this package; never published).  
**Contracts (Phase 9):** [`packages/testkit/docs/store-contracts.md`](../../../packages/testkit/docs/store-contracts.md) · production contract types also in [`@paykernel/store-contracts`](../../store-contracts)

This document describes the shared **relational foundation** used by durable adapters (Phase 12+). Related package docs:

- [migrations.md](./migrations.md) — versioned DDL, explicit `migrate` / `verifySchema`
- [atomic-claims.md](./atomic-claims.md) — claim algorithm + dialect templates
- Package [README](../README.md)
- **Phase 12 consumer:** [`packages/store-postgres`](../../../packages/store-postgres/README.md) (`@paykernel/store-postgres`)
- **Phase 14 consumer:** [`packages/store-sqlite`](../../../packages/store-sqlite/README.md) (`@paykernel/store-sqlite`, **single-host only**)
- **Phase 15 consumer:** [`packages/store-turso`](../../../packages/store-turso/README.md) (`@paykernel/store-turso`, **multi-host remote**; dialect `sqlite`)
- **Phase 16 consumer:** [`packages/store-d1`](../../../packages/store-d1/README.md) (`@paykernel/store-d1`, **multi-host Workers D1**; dialect `sqlite`)
- **Phase 17 consumer:** [`packages/store-durable-objects`](../../../packages/store-durable-objects/README.md) (`@paykernel/store-durable-objects`, **multi-host partitioned** SQLite-backed Durable Objects; dialect `sqlite`)

---

## 1. Purpose

Phase 11 provides **shared schemas and claim algorithms** without shipping a general-purpose SQL driver abstraction or ORM.

| In scope                                                                     | Out of scope                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Canonical logical tables / columns aligned with Phase 9 store records        | Shipping production drivers here (those live in `packages/adapter-*`)               |
| Validated namespace (prefix, PG schema, optional tenant column — **not** isolation) | Auto-migrate on import or store construction                                        |
| Row codecs + shared validation (status enums, max error length, hash policy) | Public npm SQL product / general query builder                                      |
| Versioned migrations + explicit `migrate()` / `verifySchema()`               | Core or webhooks depending on this package                                          |
| Pure claim decision functions + dialect-tagged SQL templates                 | Pretending PostgreSQL === SQLite syntax                                             |
| In-process memory-relational **reference** for unit/contention tests         | Replacing testkit memory stores as the Phase 9 conformance home                     |

**Production relational consumers (present):** `packages/store-postgres` (Phase 12, multi-host PostgreSQL), `packages/store-sqlite` (Phase 14, **single-host** local SQLite), `packages/store-turso` (Phase 15, **multi-host remote** Turso/libSQL, dialect `sqlite`), `packages/store-d1` (Phase 16, **multi-host Workers D1**, dialect `sqlite`), and `packages/store-durable-objects` (Phase 17, **multi-host partitioned** SQLite-backed Durable Objects, dialect `sqlite`). Further relational adapters remain later phases. Redis (`adapter-redis`) is optional coordination and must **not** depend on this package.

**Design stance:** share **intent** (tables, decisions, parameter lists) and **dialectize syntax**. Adapters own driver sessions, transactions, and connection pooling.

---

## 2. Private package — not a public SQL ORM

| Rule                          | Detail                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `"private": true`             | Enforced by `bun run check:boundaries` for any package under `internal/*`          |
| Not published                 | Changesets / release workflow skip private packages; never `npm publish` this tree |
| Not a general SQL abstraction | No public “run any SQL” product surface; narrow helpers only                       |
| In-workspace only             | `packages/adapter-*` may depend via `workspace:*` (e.g. `adapter-postgres`)        |

Consumers of the **publishable** SDK (`@paykernel/core`, webhooks, testkit) never need this package. Apps inject stores; adapters implement contracts.

---

## 3. Canonical tables and column intent (map to Phase 9)

Logical names live in `LOGICAL_TABLES` and are resolved through the namespace layer before any SQL is built.

| Logical table                 | Phase 9 contract                                              | Role                                                   |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `payment_idempotency`         | Lease-aware `IdempotencyStore` / `LeaseAwareIdempotencyStore` | Mutation reserve / complete / indeterminate            |
| `payment_webhook_inbox`       | `WebhookInboxStore`                                           | Inbox claim / complete / fail / retry                  |
| `payment_reconciliation_jobs` | `ReconciliationStore`                                         | Schedule / claim due / complete / fail / manual review |
| `payment_storage_migrations`  | (foundation metadata)                                         | Applied migration versions + checksums                 |

### Storage policy (portable)

| Topic                              | Policy                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamps                         | ISO-8601 **text** in portable templates (`TEXT`). PostgreSQL adapters may map to `TIMESTAMPTZ` at the dialect boundary; contract surface remains ISO strings. |
| Lease tokens / keys                | Opaque **strings**; no JS `number` for 64-bit DB IDs.                                                                                                         |
| `payload_hash`                     | Always **TEXT** (hex/base64 digest string), never binary by default.                                                                                          |
| `last_error` / sanitized errors    | Sanitized caller text only; max length `MAX_SANITIZED_ERROR_LENGTH` (512), aligned with webhooks sanitize.                                                    |
| Raw provider payloads / signatures | **Not stored by default.** Optional `payload_ref` is a non-secret pointer only.                                                                               |
| Cached idempotency results         | Safe-to-cache JSON only (no secrets).                                                                                                                         |

### Column maps (snake_case SQL ↔ contract fields)

Authoritative exports: `IDEMPOTENCY_COLUMNS`, `WEBHOOK_INBOX_COLUMNS`, `RECONCILIATION_COLUMNS`, `MIGRATIONS_COLUMNS` in `src/schema/tables.ts`.

**Shared lease fields** (all claimable tables):

- `key` (PK)
- `status` (CHECK enum per store)
- `lease_owner`, `lease_token`, `lease_expires_at`
- `attempts`, `generation`
- `created_at`, `updated_at`
- nullable `tenant_id` (see [Tenant column honesty](#tenant-column-honesty-v1) — **not** isolation)

**Store-specific highlights:**

| Store          | Extra columns                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Idempotency    | `fingerprint`, `result_json`, `completed_at`, `indeterminate_at`, `error_sanitized`                                       |
| Webhook inbox  | `payload_hash`, `gateway`, `provider_event_id`, `payload_ref`, `available_at`, `first_received_at`, `last_received_at`, `last_error_sanitized` |
| Reconciliation | `subject_id`, `reason`, `due_at`, `last_error_sanitized`, `completed_at`                                                  |
| Migrations     | `version` (PK), `name`, `applied_at`, `checksum`                                                                          |

Webhook `gateway`, `provider_event_id`, `first_received_at`, and `last_received_at` exist for **operator / index** use. Store `claim()` does **not** populate them (`ClaimWebhookInput` has no `gateway`).

**Statuses (CHECK values):**

- Idempotency: `reserved` \| `completed` \| `indeterminate` \| `expired`
- Webhook inbox: `pending` \| `claimed` \| `completed` \| `failed` \| `dead_letter`
- Reconciliation: `scheduled` \| `claimed` \| `completed` \| `failed` \| `manual_review`

**Write-path honesty:** official adapters do not write every CHECK-legal status. Postgres never writes idempotency `expired` (reclaim uses `lease_expires_at`). Webhook `fail` writes `pending` / `dead_letter`, not `failed`. `expired` and `failed` remain CHECK-legal for operator SQL and for memory expire-on-read.

**Index intent** (`TABLE_INDEX_INTENTS`): lease expiry, due/available times, status, `tenant_id`, payload_hash, plus composite `(status, available_at)` / `(status, due_at)` / `(status, lease_expires_at)` for listDue/listRetryable — created in migrations; adapters may add dialect-specific partial indexes. The `tenant_id` index is **not** tenant isolation.

Primary keys: business `key` for the three domain tables; `version` for migrations. `tenant_id` is never part of the primary key.

---

## 4. Namespace configuration validation rules

**Never** interpolate unvalidated arbitrary table, schema, or column names into SQL.

| Input          | Validation                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `tablePrefix`  | `[A-Za-z0-9_]+`; safe max **36** (`MAX_SAFE_TABLE_PREFIX_LENGTH` = 63 − longest logical `payment_reconciliation_jobs` 27). Every foundation table is checked — not only short samples. |
| `sqlSchema`    | Strict identifier `^[A-Za-z_][A-Za-z0-9_]*$`, max 63; rejects quotes, dots, spaces, `;`, `--`, `/*`. When set, `migrate()` / `migratePostgresAdapter` issue `CREATE SCHEMA IF NOT EXISTS` for that identifier (operators still need `CREATE` privilege). |
| `tenantColumn` | Namespace flag only. `true` → resolved name `tenant_id`; custom string → validated and stored as `tenantColumnName`; `false`/omitted → disabled. **v1 DDL always uses `tenant_id`** — a custom name is not applied to CREATE TABLE/INDEX. See honesty below. |
| Logical table  | Must be one of `ALL_LOGICAL_TABLES` — unknown names refused                                         |

API:

```ts
import {
  createSchemaNamespace,
  resolveTableName,
  resolveUnqualifiedTableName,
  quoteIdentifier,
} from "@paykernel/sql-foundation";

const ns = createSchemaNamespace({
  tablePrefix: "pay_",
  sqlSchema: "payments",
  tenantColumn: true,
});

// "payments"."pay_payment_idempotency"
const table = resolveTableName("payment_idempotency", ns);
```

Invalid config throws `SchemaNamespaceError` (`code: "invalid_namespace"`). Template builders and `migrate()` only qualify tables through these helpers.

### Tenant column honesty (v1)

`tenantColumn` enables a nullable `tenant_id` column + index **only**. Foundation v1 DDL always emits that column and a `tenant_id` index (the flag does not omit them). v1 does **not** isolate tenants, does **not** write `tenant_id` from stores, and does **not** use a custom column name in DDL (always `tenant_id`). Primary key remains `key`. Operators who need isolation must prefix keys or wait for a later schema. **Do not claim isolation.**

---

## 5. Migration policy

| Rule                                        | Detail                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Explicit only                               | Call `migrate(executor, options)` from app/dev tooling or adapter setup                      |
| Never auto on import                        | Package barrel and construction paths do **not** run migrations (covered by tests)           |
| Never auto on production store construction | Adapters must not migrate as a side effect of `create*Store()`                               |
| Versioned                                   | `CURRENT_SCHEMA_VERSION`, `MIGRATIONS` append-only list, `payment_storage_migrations` ledger |
| Schema object                               | When `sqlSchema` is set, `migrate()` issues `CREATE SCHEMA IF NOT EXISTS` (PostgreSQL). Operators still need `CREATE` privilege. |
| Verify                                      | `verifySchema()` checks applied versions / expected tables without applying DDL              |
| Dialect-honest DDL                          | Separate postgres / sqlite bodies where syntax diverges                                      |

Full detail: [migrations.md](./migrations.md).

---

## 6. Atomic claim algorithm overview + dialect templates

Claims are **engine-level conditional writes**, not application get-then-set.

1. **Pure decisions** (`decideIdempotencyReserve`, `decideWebhookClaim`, `decideReconciliationClaim`) encode generation / attempts / reclaim rules without I/O.
2. **SQL templates** (`idempotencyReserveTemplates`, `webhookClaimTemplates`, `reconciliationClaimTemplates`) provide dialect-tagged fragments (`postgres` | `sqlite` | `generic`) with **bound parameter names only**.
3. Adapters execute templates (or equivalent) under the driver’s atomicity model:
   - PostgreSQL: prefer single-statement `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING`
   - Local SQLite (single-host): multi-step `INSERT OR IGNORE` + conditional `UPDATE` **inside one sync transaction**; no `await` of external I/O inside a synchronous transaction callback
   - Async SQLite-compatible remote (Turso, D1): prefer single-statement UPSERT + RETURNING; multi-statement only inside an atomic batch/txn (D1 `batch()`, Turso write txn) — never unprotected get-then-set across round-trips

Full detail: [atomic-claims.md](./atomic-claims.md).

---

## 7. How Phase 12+ adapters consume this package

```text
packages/store-postgres       ──depends──►  internal/sql-store   (Phase 12 — present)
packages/store-sqlite         ──depends──►  internal/sql-store   (Phase 14 — present; single-host)
packages/store-turso          ──depends──►  internal/sql-store   (Phase 15 — present; multi-host remote)
packages/store-d1  ──depends──►  internal/sql-store   (Phase 16 — present; multi-host D1)
packages/store-durable-objects  ──depends──►  internal/sql-store   (Phase 17 — present; multi-host partitioned DO)
packages/store-redis          ──must not──►  internal/sql-store  (Phase 13 — Lua, not SQL)
         │
         ├── implement Phase 9 store contracts (testkit interfaces)
         ├── pass testkit conformance suites
         ├── prove multi-connection claim contention (scope-honest)
         └── wrap driver as SqlExecutor for migrate/verify (relational only)
```

### Phase 12: `adapter-postgres` (present)

`@paykernel/store-postgres` is a production multi-host consumer of this foundation:

| Responsibility | How postgres adapter uses sql-store |
| -------------- | ----------------------------------- |
| Schema / migrate | `migratePostgresAdapter` → foundation `migrate({ dialect: "postgres" })` |
| Claims | Executes postgres claim templates (`INSERT ON CONFLICT` / conditional `UPDATE … RETURNING`) |
| Namespace / tables | `createSchemaNamespace` / `resolveTableName` only |
| Codecs / validation | Row codecs + max sanitized error length |
| Drivers | Owned by adapter subpaths — **not** by this package |

Docs: [adapter overview](../../../packages/store-postgres/docs/overview.md) · [migrations](../../../packages/store-postgres/docs/migrations.md).

### Phase 14: `adapter-sqlite` (present; single-host)

`@paykernel/store-sqlite` is a production **single-host** consumer of this foundation:

| Responsibility | How sqlite adapter uses sql-store |
| -------------- | --------------------------------- |
| Schema / migrate | `migrateSqliteAdapter` → foundation `migrate({ dialect: "sqlite" })` |
| Claims | Executes sqlite claim templates (`INSERT OR IGNORE` + conditional `UPDATE`) inside **one sync** `BEGIN IMMEDIATE` transaction |
| Namespace / tables | `createSchemaNamespace` / `resolveTableName` only |
| Codecs / validation | Row codecs + max sanitized error length |
| Drivers | Isolated subpaths `/bun`, `/node`, `/better-sqlite3` only — **not** package root |
| Honesty | Manifest `coordinationScope: "single-host"` — never multi-host for a local file |

Docs: [adapter overview](../../../packages/store-sqlite/docs/overview.md) · [claims](../../../packages/store-sqlite/docs/claims.md) · [deployment-limits](../../../packages/store-sqlite/docs/deployment-limits.md).

### Phase 15: `adapter-turso` (present; multi-host remote)

`@paykernel/store-turso` is a production **multi-host remote** consumer of this foundation (dialect **`sqlite`**):

| Responsibility | How turso adapter uses sql-store |
| -------------- | -------------------------------- |
| Schema / migrate | `migrateTursoAdapter` → foundation `migrate({ dialect: "sqlite" })` |
| Claims | Prefer single-statement SQLite UPSERT + RETURNING (async remote); multi-step only in write txn/batch |
| Namespace / tables | `createSchemaNamespace` / `resolveTableName` only |
| Codecs / validation | Row codecs + max sanitized error length |
| Drivers | Isolated subpaths `/serverless`, `/libsql` only — **not** package root; **no** `/sync` |
| Honesty | Manifest `coordinationScope: "multi-host"` for shared remote primary — not local single-host SQLite |

Docs: [adapter overview](../../../packages/store-turso/docs/overview.md) · [claims](../../../packages/store-turso/docs/claims.md) · [embedded-replicas](../../../packages/store-turso/docs/embedded-replicas.md).

### Phase 16: `adapter-cloudflare-d1` (present; multi-host Workers D1)

`@paykernel/store-d1` is a production **multi-host** consumer of this foundation (dialect **`sqlite`**) via the Cloudflare D1 Workers binding:

| Responsibility | How D1 adapter uses sql-store |
| -------------- | ----------------------------- |
| Schema / migrate | `migrateD1Adapter` → foundation `migrate({ dialect: "sqlite" })` |
| Claims | Prefer single-statement SQLite UPSERT + RETURNING (async D1 Binding API); multi-statement only via D1 `batch()` |
| Namespace / tables | `createSchemaNamespace` / `resolveTableName` only |
| Codecs / validation | Row codecs + max sanitized error length |
| Binding | Structural `D1DatabaseLike` on root — **no** static `cloudflare:workers` import |
| Honesty | Manifest `coordinationScope: "multi-host"` for shared D1; session-dependent RAW; **not** local SQLite, **not** Turso, **not** Durable Objects |

Docs: [adapter overview](../../../packages/store-d1/docs/overview.md) · [claims](../../../packages/store-d1/docs/claims.md) · [sessions-and-replication](../../../packages/store-d1/docs/sessions-and-replication.md).

### Phase 17: `adapter-cloudflare-do` (present; multi-host partitioned SQLite-backed DO)

`@paykernel/store-durable-objects` is a production **multi-host partitioned** consumer of this foundation (dialect **`sqlite`**) via SQLite-backed Durable Objects (`new_sqlite_classes`):

| Responsibility | How DO adapter uses sql-store |
| -------------- | ----------------------------- |
| Schema / migrate | `migrateDoAdapter` / `ensureDoSchema` → foundation `migrate({ dialect: "sqlite" })` |
| Claims | Prefer single-statement SQLite UPSERT + RETURNING via sync `sql.exec`; multi-statement only via `transactionSync` (sync callback; no await external I/O) |
| Namespace / tables | `createSchemaNamespace` / `resolveTableName` only |
| Codecs / validation | Row codecs + max sanitized error length |
| Binding | Structural `DoStorageLike` / `SqlStorageLike` / `DoNamespaceLike` — **no** static `cloudflare:workers` on package root |
| Honesty | Manifest `coordinationScope: "multi-host"` with strong claims/RAW **within a partition**; deterministic sharding (`key` \| `hash` \| `tenant`); **never** one global DO; **not** shared D1, **not** local SQLite, **not** Turso |

Docs: [adapter overview](../../../packages/store-durable-objects/docs/overview.md) · [sharding](../../../packages/store-durable-objects/docs/sharding.md) · [claims](../../../packages/store-durable-objects/docs/claims.md) · [transactions](../../../packages/store-durable-objects/docs/transactions.md).

Recommended adapter responsibilities (all Phase 12+ relational adapters):

1. Depend on **`@paykernel/sql-foundation`** at runtime (publishable; not private `internal/*`). Optional workspace shim `@paykernel/sql-foundation` is a thin re-export only — adapters must not list it as a published runtime dependency.
2. Implement `IdempotencyStore` / `WebhookInboxStore` / `ReconciliationStore` from **`@paykernel/store-contracts`** (testkit re-exports for BC + conformance; webhooks dual-owns `WebhookInboxStore` assignability where relevant).
3. Use `createSchemaNamespace` + claim templates + row codecs.
4. Expose **explicit** migrate/verify entry points (CLI or documented setup); never on import.
5. Declare an honest `StorageAdapterManifest` (coordination scope, durability, strong claims only with engine-level ops).
6. Keep optional drivers (`pg`, `postgres`, `drizzle-orm`, `bun:sql`, `bun:sqlite`, `node:sqlite`, `better-sqlite3`, `@libsql/client`, `@tursodatabase/serverless`, `cloudflare:workers`, …) off the package root entry (boundary rule for adapters).

**Dependency matrix:**

| Package                                | May depend on `@paykernel/sql-foundation`?                                        |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core`                        | **No**                                                                            |
| `packages/webhooks`                    | **No** (storage injected)                                                         |
| `packages/testkit`                     | Optional types only if ever needed; not required for Phase 11 foundation          |
| `packages/store-postgres` (Phase 12) | **Yes** (present)                                                                 |
| `packages/store-redis` (Phase 13)    | **No** (Lua scripts; not relational)                                              |
| `packages/store-sqlite` (Phase 14)   | **Yes** (present; single-host)                                                    |
| `packages/store-turso` (Phase 15)    | **Yes** (present; multi-host remote)                                              |
| `packages/store-d1` (16)  | **Yes** (present; multi-host D1)                                                  |
| `packages/store-durable-objects` (17)  | **Yes** (present; multi-host partitioned DO)                                      |
| Other `packages/adapter-*` (later)     | **Yes** if relational                                                             |
| `internal/sql-store`                   | Must **not** depend on core or webhooks engine; zero runtime workspace deps today |

---

## 8. Crash / claim boundaries for relational claims

Align with webhooks [crash-boundaries.md](../../../packages/webhooks/docs/crash-boundaries.md) and testkit store contracts.

| Scenario                                          | Expected store behavior                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash after acquire/claim, before complete        | Row stays leased until `lease_expires_at`; another worker **reclaims** with new `lease_token` and higher `generation`; stale token → lease lost |
| Crash after external side effect, before complete | Prefer indeterminate (idempotency) or re-run with idempotent handlers (webhooks); **never** invent terminal failure for uncertain outcomes      |
| Concurrent multi-connection claim                 | Exactly one winner for a given key at a time; others observe `in_progress` / non-acquire outcome                                                |
| Stale complete after reclaim/renew                | Must fail (lease lost / zero rows updated under token predicate)                                                                                |
| Migration mid-deploy                              | Operators run explicit migrate; adapters may fail fast via `verifySchema` / `invalid_schema`                                                    |

Relational claims **do not** couple arbitrary provider HTTP with the claim row unless both share one transaction. At-least-once handler execution after reclaim is expected.

---

## 9. Prepared statements only; no unvalidated table name interpolation

| Rule                       | Practice                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- |
| User values                | Bound parameters (`$1..$n` or `?`) — never string-concatenated into SQL      |
| Table / schema identifiers | Only via `resolveTableName` / `quoteIdentifier` after validation             |
| Logical tables             | Closed allowlist (`LOGICAL_TABLES`); unknown names rejected                  |
| Secrets                    | Never in `last_error_*`, logs, or error messages from this package’s helpers |

`SqlExecutor` is intentionally narrow (`execute` / optional `query`) — not a full ORM. Adapters map it onto prepared statements of their driver.

---

## Related

- [migrations.md](./migrations.md)
- [atomic-claims.md](./atomic-claims.md)
- [store-contracts.md](../../../packages/testkit/docs/store-contracts.md)
- Phase 12 adapter: [adapter-postgres README](../../../packages/store-postgres/README.md)
- Phase 14 adapter (single-host): [adapter-sqlite README](../../../packages/store-sqlite/README.md)
- Phase 15 adapter (multi-host remote): [adapter-turso README](../../../packages/store-turso/README.md)
- Phase 16 adapter (multi-host Workers D1): [adapter-cloudflare-d1 README](../../../packages/store-d1/README.md)
- Phase 17 adapter (multi-host partitioned DO): [adapter-cloudflare-do README](../../../packages/store-durable-objects/README.md)
- [workspace-boundaries.md](../../../docs/workspace-boundaries.md)
- [monorepo.md](../../../docs/monorepo.md)
