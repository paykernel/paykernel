/**
 * Raw migration SQL bodies (dialect variants).
 *
 * Timestamps: TEXT ISO-8601 in portable/SQLite/Postgres foundation v1
 * (adapters may map to TIMESTAMPTZ later). payload_hash: TEXT consistently.
 */

import { MAX_IDENTIFIER_LENGTH } from "../schema/namespace";

/**
 * Max chars from a qualified table name embedded in index identifiers.
 * Full index name is `idx_{label}_{suffix}`; longest suffix today is
 * `lease_expires` (14) → `idx_` + 40 + `_` + 14 = 59 ≤ 63.
 */
export const INDEX_LABEL_MAX = 40;

/**
 * Build a stable, collision-resistant fragment for index names from a
 * qualified table reference.
 *
 * When the cleaned name exceeds {@link INDEX_LABEL_MAX}, the **end** is kept
 * (not the start). Long shared prefixes otherwise collapsed distinct tables
 * (`payment_idempotency` vs `payment_reconciliation_jobs`) into the same
 * label, and `CREATE INDEX IF NOT EXISTS` silently skipped later indexes.
 */
export function indexLabel(qualified: string): string {
  const cleaned = qualified
    .replace(/"/g, "")
    .replace(/\./g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_");
  if (cleaned.length <= INDEX_LABEL_MAX) {
    return cleaned;
  }
  return cleaned.slice(-INDEX_LABEL_MAX);
}

function pushCreateIndex(
  statements: string[],
  usedIndexNames: Set<string>,
  qualifiedTable: string,
  suffix: string,
  columns: string,
): void {
  const label = indexLabel(qualifiedTable);
  const name = `idx_${label}_${suffix}`;
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `index name exceeds max identifier length ${MAX_IDENTIFIER_LENGTH}: ${name}`,
    );
  }
  if (usedIndexNames.has(name)) {
    throw new Error(
      `index name collision: ${name} for table ${qualifiedTable} ` +
        `(distinct tables collapsed under long prefix/schema; shorten tablePrefix)`,
    );
  }
  usedIndexNames.add(name);
  statements.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${qualifiedTable} (${columns})`);
}

/**
 * Build CREATE TABLE + indexes for the four logical tables.
 * `q` qualifies a logical table name (validated identifiers only).
 */
export function buildFoundationMigrationSql(
  dialect: "postgres" | "sqlite",
  qualify: (logical: string) => string,
): string {
  const q = qualify;
  const idem = q("payment_idempotency");
  const inbox = q("payment_webhook_inbox");
  const recon = q("payment_reconciliation_jobs");
  const mig = q("payment_storage_migrations");

  const statements: string[] = [];
  const usedIndexNames = new Set<string>();

  statements.push(
    `
CREATE TABLE IF NOT EXISTS ${idem} (
  key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tenant_id TEXT,
  completed_at TEXT,
  indeterminate_at TEXT,
  error_sanitized TEXT,
  CHECK (status IN ('reserved', 'completed', 'indeterminate', 'expired')),
  CHECK (attempts >= 0),
  CHECK (generation >= 0)
)`.trim(),
  );

  pushCreateIndex(statements, usedIndexNames, idem, "lease_expires", "lease_expires_at");
  pushCreateIndex(statements, usedIndexNames, idem, "status", "status");
  pushCreateIndex(statements, usedIndexNames, idem, "tenant", "tenant_id");

  statements.push(
    `
CREATE TABLE IF NOT EXISTS ${inbox} (
  key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  gateway TEXT,
  provider_event_id TEXT,
  payload_ref TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  available_at TEXT,
  first_received_at TEXT,
  last_received_at TEXT,
  completed_at TEXT,
  last_error_sanitized TEXT,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'dead_letter')),
  CHECK (attempts >= 0),
  CHECK (generation >= 0)
)`.trim(),
  );

  pushCreateIndex(statements, usedIndexNames, inbox, "lease_expires", "lease_expires_at");
  pushCreateIndex(statements, usedIndexNames, inbox, "available", "available_at");
  pushCreateIndex(statements, usedIndexNames, inbox, "status", "status");
  pushCreateIndex(statements, usedIndexNames, inbox, "tenant", "tenant_id");
  pushCreateIndex(statements, usedIndexNames, inbox, "payload_hash", "payload_hash");

  statements.push(
    `
CREATE TABLE IF NOT EXISTS ${recon} (
  key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  subject_id TEXT,
  reason TEXT,
  due_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  last_error_sanitized TEXT,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (status IN ('scheduled', 'claimed', 'completed', 'failed', 'manual_review')),
  CHECK (attempts >= 0),
  CHECK (generation >= 0)
)`.trim(),
  );

  pushCreateIndex(statements, usedIndexNames, recon, "lease_expires", "lease_expires_at");
  pushCreateIndex(statements, usedIndexNames, recon, "due", "due_at");
  pushCreateIndex(statements, usedIndexNames, recon, "status", "status");
  pushCreateIndex(statements, usedIndexNames, recon, "tenant", "tenant_id");

  statements.push(
    `
CREATE TABLE IF NOT EXISTS ${mig} (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT
)`.trim(),
  );

  if (dialect === "postgres") {
    statements.push(
      `-- payments-storage v1 postgres: TEXT timestamps (TIMESTAMPTZ optional at adapter layer)`,
    );
  } else {
    statements.push(`-- payments-storage v1 sqlite: TEXT timestamps + CHECK`);
  }

  return statements.join(";\n") + ";";
}

function defaultQualify(logical: string): string {
  return `"${logical}"`;
}

/** Default unqualified migration bodies (logical names, no prefix). */
export const FOUNDATION_SQL_POSTGRES = buildFoundationMigrationSql("postgres", defaultQualify);

export const FOUNDATION_SQL_SQLITE = buildFoundationMigrationSql("sqlite", defaultQualify);

export const FOUNDATION_SQL_PORTABLE =
  "Create payment_idempotency, payment_webhook_inbox, payment_reconciliation_jobs, payment_storage_migrations with PKs, status CHECKs, lease/due indexes; ISO TEXT timestamps; payload_hash TEXT.";
