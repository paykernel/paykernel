-- PERF-3: composite list/cleanup indexes for already-applied v1 databases.
-- Do not rewrite 0001_foundation.sql. CREATE INDEX IF NOT EXISTS is a no-op
-- when migrate() / current v1 DDL already created these names.
-- Applied via migrateD1Adapter (sql-foundation v2) or Wrangler `d1 migrations`.
-- DO NOT wrap statements in BEGIN/COMMIT.

CREATE INDEX IF NOT EXISTS idx_payment_webhook_inbox_st_avail ON "payment_webhook_inbox" (status, available_at);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_inbox_st_lexp ON "payment_webhook_inbox" (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_jobs_st_due ON "payment_reconciliation_jobs" (status, due_at);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_jobs_st_lexp ON "payment_reconciliation_jobs" (status, lease_expires_at);
