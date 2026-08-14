# Migrations (Phase 11)

**Package:** `@paykernel/internal-sql-store` (private thin re-export)

Canonical document: [`packages/sql-foundation/docs/migrations.md`](../../../packages/sql-foundation/docs/migrations.md)

`migrate()` is explicit only. When `sqlSchema` is set (Postgres), it issues `CREATE SCHEMA IF NOT EXISTS`. Version ledger inserts are conflict-safe (`ON CONFLICT DO NOTHING` / `INSERT OR IGNORE`). There is no portable advisory lock.
