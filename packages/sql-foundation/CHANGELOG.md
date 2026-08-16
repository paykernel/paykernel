# @paykernel/sql-foundation

## Unreleased

### Patch

- **PERF-3 honesty:** `buildListIndexMigrationSql(qualify)` no longer takes an unused dialect argument (Postgres and SQLite emit the same `CREATE INDEX IF NOT EXISTS` bodies).
- **WEBHOOKS-1:** Soft-release of expired `claimed` restores one attempt (floor 0); direct reclaim of expired claimed keeps `attempts` unchanged so crash/deploy reclaim does not burn handler `maxAttempts`.
- **N8:** `validateTablePrefix` samples **every** foundation logical table (longest: `payment_reconciliation_jobs`, 27 chars). Prefixes that previously passed validation then failed `resolveUnqualifiedTableName` for recon now fail closed at validate (`MAX_SAFE_TABLE_PREFIX_LENGTH` = 36). Exports: `LONGEST_LOGICAL_TABLE_NAME_LENGTH`, `MAX_SAFE_TABLE_PREFIX_LENGTH`.
- **N9:** `indexLabel` truncates from the **end** of the cleaned table name so long shared prefixes do not collapse `_lease_expires` / `_status` / `_tenant` indexes across tables; `CREATE INDEX` name collisions fail closed at SQL build. Exports: `indexLabel`, `INDEX_LABEL_MAX`.
- **N10 docs:** `migrate()` has no portable cross-dialect advisory lock — ops must serialize multi-host migrate; v1 `IF NOT EXISTS` is usually safe; future non-idempotent DDL inherits the race window (`docs/migrations.md`, `migrate()` JSDoc).
- **N4 docs:** atomic-claims.md documents `markIndeterminate` near-expiry parking (token + reserved, no active-lease clock) vs complete/fail/renew.

## 0.1.0-next.0


### Patch

- Webhook fail templates: optional `restoreAttemptFlag` decrements attempts (parking claim parity).
- Webhook claim: `decideWebhookClaim` / SQL templates gate `pending` on `available_at <= now` (`not_available`); expired lease reclaim still allowed for recovery.
- Document injectable clock vs multi-host NTP for ISO TEXT lease comparisons.

### Major Changes

- Initial public packaging of the shared relational foundation previously only
  available as private `@paykernel/internal-sql-store` (ship-blocker B8 option B:
  publishable `sql-foundation`; adapters depend on this package at runtime).
