/**
 * Raw migration SQL bodies (dialect variants).
 *
 * Timestamps: TEXT ISO-8601 in portable/SQLite/Postgres foundation v1
 * (adapters may map to TIMESTAMPTZ later). payload_hash: TEXT consistently.
 */

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

  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(idem)}_lease_expires ON ${idem} (lease_expires_at)`,
  );
  statements.push(`CREATE INDEX IF NOT EXISTS idx_${indexLabel(idem)}_status ON ${idem} (status)`);
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(idem)}_tenant ON ${idem} (tenant_id)`,
  );

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

  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(inbox)}_lease_expires ON ${inbox} (lease_expires_at)`,
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(inbox)}_available ON ${inbox} (available_at)`,
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(inbox)}_status ON ${inbox} (status)`,
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(inbox)}_tenant ON ${inbox} (tenant_id)`,
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(inbox)}_payload_hash ON ${inbox} (payload_hash)`,
  );

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

  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(recon)}_lease_expires ON ${recon} (lease_expires_at)`,
  );
  statements.push(`CREATE INDEX IF NOT EXISTS idx_${indexLabel(recon)}_due ON ${recon} (due_at)`);
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(recon)}_status ON ${recon} (status)`,
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${indexLabel(recon)}_tenant ON ${recon} (tenant_id)`,
  );

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

function indexLabel(qualified: string): string {
  return qualified
    .replace(/"/g, "")
    .replace(/\./g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .slice(0, 40);
}

function defaultQualify(logical: string): string {
  return `"${logical}"`;
}

/** Default unqualified migration bodies (logical names, no prefix). */
export const FOUNDATION_SQL_POSTGRES = buildFoundationMigrationSql("postgres", defaultQualify);

export const FOUNDATION_SQL_SQLITE = buildFoundationMigrationSql("sqlite", defaultQualify);

export const FOUNDATION_SQL_PORTABLE =
  "Create payment_idempotency, payment_webhook_inbox, payment_reconciliation_jobs, payment_storage_migrations with PKs, status CHECKs, lease/due indexes; ISO TEXT timestamps; payload_hash TEXT.";
