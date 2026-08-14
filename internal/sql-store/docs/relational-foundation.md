# Relational foundation (Phase 11)

**Package:** `@paykernel/internal-sql-store` (private thin re-export of `@paykernel/sql-foundation`)

Canonical document: [`packages/sql-foundation/docs/relational-foundation.md`](../../../packages/sql-foundation/docs/relational-foundation.md)

v1 `tenantColumn` is a nullable `tenant_id` column + index only — it does **not** isolate tenants. Production adapters depend on `@paykernel/sql-foundation` directly.
