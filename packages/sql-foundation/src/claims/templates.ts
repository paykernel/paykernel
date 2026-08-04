/**
 * Portable claim intent + dialect-tagged SQL templates.
 *
 * Placeholders use positional `$1..$n` style (postgres) or `?` (sqlite).
 * Callers bind parameters — NEVER interpolate user values into SQL strings.
 *
 * Table name must come from {@link resolveTableName} (validated identifiers only).
 *
 * ## Equivalence (postgres ↔ sqlite)
 *
 * Templates implement the **same logical transitions** as
 * {@link import("./algorithm.ts").evaluateClaim} / decide* helpers:
 * insert-if-absent, reclaim only when lease expired or status is retryable,
 * increment generation+attempts, issue a new lease token, reject active foreign
 * leases / terminal / indeterminate / payload-hash mismatch.
 *
 * Syntax differs by design (Postgres single-statement UPSERT + RETURNING vs
 * SQLite INSERT OR IGNORE + conditional UPDATE in one transaction). Phase 12
 * adapters must execute these as **prepared statements** and pass testkit
 * conformance suites — do not hide dialect differences in a leaky abstraction
 * that loses atomicity (never get-then-set across connections).
 */

import type { DialectId } from "./dialect";
import type { ResolvedSchemaNamespace } from "../schema/namespace";
import { resolveTableName } from "../schema/namespace";
import { LOGICAL_TABLES } from "../schema/tables";

export type SqlFragment = {
  /** Dialect this fragment targets. */
  dialect: DialectId;
  /** SQL with placeholders only (no interpolated user values). */
  sql: string;
  /**
   * Ordered parameter names matching placeholders.
   * Adapters map names → bound values.
   */
  params: readonly string[];
  /** Human intent (not executed). */
  intent: string;
};

export type ClaimTemplateSet = {
  /** Portable English description of the atomic claim. */
  intent: string;
  postgres: SqlFragment;
  sqlite: SqlFragment;
  /** Best-effort portable form (may be multi-statement notes). */
  generic: SqlFragment;
};

function emptyNamespace(): ResolvedSchemaNamespace {
  return {
    tablePrefix: "",
    sqlSchema: undefined,
    tenantColumnEnabled: false,
    tenantColumnName: undefined,
  };
}

function table(
  logical:
    | typeof LOGICAL_TABLES.idempotency
    | typeof LOGICAL_TABLES.webhookInbox
    | typeof LOGICAL_TABLES.reconciliationJobs,
  namespace?: ResolvedSchemaNamespace,
): string {
  return resolveTableName(logical, namespace ?? emptyNamespace());
}

/**
 * Atomic idempotency reserve templates.
 *
 * Intent:
 * 1) INSERT if absent (unique key) with generation=1, status=reserved.
 * 2) Else UPDATE reclaim when fingerprint matches AND status allows reclaim
 *    (expired lease or status expired) AND not completed/indeterminate;
 *    increment generation/attempts; set new lease token.
 *
 * Postgres uses INSERT ... ON CONFLICT DO UPDATE ... WHERE with RETURNING.
 * SQLite uses INSERT OR IGNORE + conditional UPDATE (adapter runs in a txn).
 */
export function idempotencyReserveTemplates(namespace?: ResolvedSchemaNamespace): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.idempotency, namespace);
  const intent =
    "Atomic reserve: insert-if-absent or reclaim expired/retryable only; " +
    "increment generation/attempts; return lease+state. No get-then-set.";

  const postgresSql = `
INSERT INTO ${t} (
  key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
  attempts, generation, created_at, updated_at
) VALUES (
  $1, 'reserved', $2, $3, $4, $5, 1, 1, $6, $6
)
ON CONFLICT (key) DO UPDATE SET
  status = 'reserved',
  lease_owner = EXCLUDED.lease_owner,
  lease_token = EXCLUDED.lease_token,
  lease_expires_at = EXCLUDED.lease_expires_at,
  attempts = ${t}.attempts + 1,
  generation = ${t}.generation + 1,
  updated_at = EXCLUDED.updated_at
WHERE ${t}.fingerprint = EXCLUDED.fingerprint
  AND ${t}.status NOT IN ('completed', 'indeterminate')
  AND (
    ${t}.status = 'expired'
    OR ${t}.lease_expires_at IS NULL
    OR ${t}.lease_expires_at <= $6
  )
RETURNING
  key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
  attempts, generation, created_at, updated_at, result_json,
  (xmax = 0) AS inserted
`.trim();

  // SQLite: adapters should run insert-or-ignore then conditional update in one txn.
  // Single-statement reclaim UPDATE for expired/retryable rows:
  const sqliteUpdateSql = `
UPDATE ${t} SET
  status = 'reserved',
  lease_owner = ?,
  lease_token = ?,
  lease_expires_at = ?,
  attempts = attempts + 1,
  generation = generation + 1,
  updated_at = ?
WHERE key = ?
  AND fingerprint = ?
  AND status NOT IN ('completed', 'indeterminate')
  AND (
    status = 'expired'
    OR lease_expires_at IS NULL
    OR lease_expires_at <= ?
  )
`.trim();

  const sqliteInsertSql = `
INSERT OR IGNORE INTO ${t} (
  key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
  attempts, generation, created_at, updated_at
) VALUES (?, 'reserved', ?, ?, ?, ?, 1, 1, ?, ?)
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: ["key", "fingerprint", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      // Multi-step in one transaction. Adapters bind each step separately —
      // do not treat `params` as a single flat bind list for the whole string.
      sql: `-- step1 insert-or-ignore (bind: key, fingerprint, owner, leaseToken, leaseExpiresAt, now, now):\n${sqliteInsertSql}\n-- step2 conditional reclaim (bind: owner, leaseToken, leaseExpiresAt, now, key, fingerprint, now):\n${sqliteUpdateSql}`,
      params: [
        "step1:key",
        "step1:fingerprint",
        "step1:owner",
        "step1:leaseToken",
        "step1:leaseExpiresAt",
        "step1:now",
        "step1:now",
        "step2:owner",
        "step2:leaseToken",
        "step2:leaseExpiresAt",
        "step2:now",
        "step2:key",
        "step2:fingerprint",
        "step2:now",
      ],
      intent: intent + " SQLite: INSERT OR IGNORE then conditional UPDATE in one txn.",
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable intent only. Implement as single conditional engine write per dialect.\n-- INSERT if absent; UPDATE reclaim if fingerprint matches and lease expired/retryable.`,
      params: ["key", "fingerprint", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
  };
}

/**
 * Atomic webhook inbox claim templates.
 */
export function webhookClaimTemplates(namespace?: ResolvedSchemaNamespace): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.webhookInbox, namespace);
  const intent =
    "Atomic claim: insert-if-absent or reclaim pending-when-due/expired lease only; " +
    "pending requires available_at <= now; expired claimed lease may reclaim for recovery " +
    "even if available_at is future; payload_hash must match; increment generation/attempts.";

  const postgresSql = `
INSERT INTO ${t} (
  key, status, payload_hash, payload_ref, lease_owner, lease_token, lease_expires_at,
  attempts, generation, available_at, created_at, updated_at
) VALUES (
  $1, 'claimed', $2, $3, $4, $5, $6, 1, 1, $7, $7, $7
)
ON CONFLICT (key) DO UPDATE SET
  status = 'claimed',
  payload_ref = COALESCE(EXCLUDED.payload_ref, ${t}.payload_ref),
  lease_owner = EXCLUDED.lease_owner,
  lease_token = EXCLUDED.lease_token,
  lease_expires_at = EXCLUDED.lease_expires_at,
  attempts = ${t}.attempts + 1,
  generation = ${t}.generation + 1,
  available_at = EXCLUDED.available_at,
  updated_at = EXCLUDED.updated_at
WHERE ${t}.payload_hash = EXCLUDED.payload_hash
  AND ${t}.status NOT IN ('completed', 'failed', 'dead_letter')
  AND (
    (
      ${t}.status = 'pending'
      AND (${t}.available_at IS NULL OR ${t}.available_at <= $7)
    )
    OR (
      ${t}.status = 'claimed'
      AND (
        ${t}.lease_expires_at IS NULL
        OR ${t}.lease_expires_at <= $7
      )
    )
  )
RETURNING *
`.trim();

  const sqliteInsert = `
INSERT OR IGNORE INTO ${t} (
  key, status, payload_hash, payload_ref, lease_owner, lease_token, lease_expires_at,
  attempts, generation, available_at, created_at, updated_at
) VALUES (?, 'claimed', ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
`.trim();

  const sqliteUpdate = `
UPDATE ${t} SET
  status = 'claimed',
  payload_ref = COALESCE(?, payload_ref),
  lease_owner = ?,
  lease_token = ?,
  lease_expires_at = ?,
  attempts = attempts + 1,
  generation = generation + 1,
  available_at = ?,
  updated_at = ?
WHERE key = ?
  AND payload_hash = ?
  AND status NOT IN ('completed', 'failed', 'dead_letter')
  AND (
    (
      status = 'pending'
      AND (available_at IS NULL OR available_at <= ?)
    )
    OR (
      status = 'claimed'
      AND (
        lease_expires_at IS NULL
        OR lease_expires_at <= ?
      )
    )
  )
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: ["key", "payloadHash", "payloadRef", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      // Multi-step in one transaction; bind each step separately (see sql comments).
      sql: `-- step1 insert-or-ignore (bind: key, payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now, now, now):\n${sqliteInsert}\n-- step2 conditional reclaim (bind: payloadRef, owner, leaseToken, leaseExpiresAt, now, now, key, payloadHash, now, now):\n${sqliteUpdate}`,
      params: [
        "step1:key",
        "step1:payloadHash",
        "step1:payloadRef",
        "step1:owner",
        "step1:leaseToken",
        "step1:leaseExpiresAt",
        "step1:now",
        "step1:now",
        "step1:now",
        "step2:payloadRef",
        "step2:owner",
        "step2:leaseToken",
        "step2:leaseExpiresAt",
        "step2:now",
        "step2:now",
        "step2:key",
        "step2:payloadHash",
        "step2:now",
        "step2:now",
      ],
      intent: intent + " SQLite multi-step txn; bind each step separately.",
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable claim intent for webhook inbox (see decideWebhookClaim).`,
      params: ["key", "payloadHash", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
  };
}

/**
 * Atomic reconciliation claim templates (row must already exist via schedule).
 */
export function reconciliationClaimTemplates(
  namespace?: ResolvedSchemaNamespace,
): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.reconciliationJobs, namespace);
  const intent =
    "Atomic claim when due: conditional UPDATE only; reclaim expired lease; " +
    "increment generation/attempts; no insert on claim.";

  const postgresSql = `
UPDATE ${t} SET
  status = 'claimed',
  lease_owner = $2,
  lease_token = $3,
  lease_expires_at = $4,
  attempts = attempts + 1,
  generation = generation + 1,
  updated_at = $5
WHERE key = $1
  AND status NOT IN ('completed', 'failed', 'manual_review')
  AND due_at <= $5
  AND (
    status = 'scheduled'
    OR lease_expires_at IS NULL
    OR lease_expires_at <= $5
  )
RETURNING *
`.trim();

  const sqliteSql = `
UPDATE ${t} SET
  status = 'claimed',
  lease_owner = ?,
  lease_token = ?,
  lease_expires_at = ?,
  attempts = attempts + 1,
  generation = generation + 1,
  updated_at = ?
WHERE key = ?
  AND status NOT IN ('completed', 'failed', 'manual_review')
  AND due_at <= ?
  AND (
    status = 'scheduled'
    OR lease_expires_at IS NULL
    OR lease_expires_at <= ?
  )
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: ["key", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      sql: sqliteSql,
      params: ["owner", "leaseToken", "leaseExpiresAt", "now", "key", "now", "now"],
      intent,
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable reconciliation claim: single conditional UPDATE (see decideReconciliationClaim).`,
      params: ["key", "owner", "leaseToken", "leaseExpiresAt", "now"],
      intent,
    },
  };
}

/** Select template fragment for a dialect. */
export function pickClaimTemplate(set: ClaimTemplateSet, dialect: DialectId): SqlFragment {
  if (dialect === "postgres") return set.postgres;
  if (dialect === "sqlite") return set.sqlite;
  return set.generic;
}

/**
 * Lease-gated complete templates (idempotency example).
 * Atomic: WHERE key + lease_token + active lease + expected status.
 * Stale token → 0 rows updated → adapter throws lease_lost.
 */
export function idempotencyCompleteTemplates(
  namespace?: ResolvedSchemaNamespace,
): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.idempotency, namespace);
  const intent =
    "Atomic complete: status→completed only when lease_token matches and lease active; " +
    "clear lease fields; never get-then-set.";

  const postgresSql = `
UPDATE ${t} SET
  status = 'completed',
  result_json = $3,
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  completed_at = $4,
  updated_at = $4
WHERE key = $1
  AND lease_token = $2
  AND status = 'reserved'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > $4
RETURNING key, status, generation
`.trim();

  const sqliteSql = `
UPDATE ${t} SET
  status = 'completed',
  result_json = ?,
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  completed_at = ?,
  updated_at = ?
WHERE key = ?
  AND lease_token = ?
  AND status = 'reserved'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > ?
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: ["key", "leaseToken", "resultJson", "now"],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      sql: sqliteSql,
      params: ["resultJson", "now", "now", "key", "leaseToken", "now"],
      intent,
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable complete: single conditional UPDATE by lease_token (see decideLeaseMutation).`,
      params: ["key", "leaseToken", "resultJson", "now"],
      intent,
    },
  };
}

/**
 * Lease-gated webhook complete templates.
 */
export function webhookCompleteTemplates(namespace?: ResolvedSchemaNamespace): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.webhookInbox, namespace);
  const intent = "Atomic webhook complete: requires matching active lease_token; status→completed.";

  const postgresSql = `
UPDATE ${t} SET
  status = 'completed',
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  completed_at = $3,
  updated_at = $3
WHERE key = $1
  AND lease_token = $2
  AND status = 'claimed'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > $3
RETURNING key, status, generation
`.trim();

  const sqliteSql = `
UPDATE ${t} SET
  status = 'completed',
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  completed_at = ?,
  updated_at = ?
WHERE key = ?
  AND lease_token = ?
  AND status = 'claimed'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > ?
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: ["key", "leaseToken", "now"],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      sql: sqliteSql,
      params: ["now", "now", "key", "leaseToken", "now"],
      intent,
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable webhook complete: conditional UPDATE by lease_token.`,
      params: ["key", "leaseToken", "now"],
      intent,
    },
  };
}

/**
 * Lease-gated webhook fail / dead-letter templates.
 */
export function webhookFailTemplates(namespace?: ResolvedSchemaNamespace): ClaimTemplateSet {
  const t = table(LOGICAL_TABLES.webhookInbox, namespace);
  const intent =
    "Atomic webhook fail: requires active lease; set pending/dead_letter + sanitized last_error only; " +
    "optional restoreAttempt (0|1) decrements attempts for non-handler parking releases.";

  // statusTarget bound as param ($3 / ?) must be 'pending' or 'dead_letter' (adapter-validated).
  // restoreAttemptFlag ($7 / ?) is 0|1 — when 1, attempts = max(attempts-1, 0).
  // Column must match foundation DDL: last_error_sanitized (never raw last_error).
  const postgresSql = `
UPDATE ${t} SET
  status = $3,
  last_error_sanitized = $4,
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  available_at = $5,
  updated_at = $6,
  attempts = CASE WHEN $7 = 1 AND ${t}.attempts > 0 THEN ${t}.attempts - 1 ELSE ${t}.attempts END
WHERE key = $1
  AND lease_token = $2
  AND status = 'claimed'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > $6
RETURNING key, status, generation
`.trim();

  const sqliteSql = `
UPDATE ${t} SET
  status = ?,
  last_error_sanitized = ?,
  lease_owner = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  available_at = ?,
  updated_at = ?,
  attempts = CASE WHEN ? = 1 AND attempts > 0 THEN attempts - 1 ELSE attempts END
WHERE key = ?
  AND lease_token = ?
  AND status = 'claimed'
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > ?
`.trim();

  return {
    intent,
    postgres: {
      dialect: "postgres",
      sql: postgresSql,
      params: [
        "key",
        "leaseToken",
        "statusTarget",
        "lastError",
        "availableAt",
        "now",
        "restoreAttemptFlag",
      ],
      intent,
    },
    sqlite: {
      dialect: "sqlite",
      sql: sqliteSql,
      params: [
        "statusTarget",
        "lastError",
        "availableAt",
        "now",
        "restoreAttemptFlag",
        "key",
        "leaseToken",
        "now",
      ],
      intent,
    },
    generic: {
      dialect: "generic",
      sql: `-- Portable webhook fail: conditional UPDATE by lease_token + sanitized error + optional restoreAttempt.`,
      params: [
        "key",
        "leaseToken",
        "statusTarget",
        "lastError",
        "availableAt",
        "now",
        "restoreAttemptFlag",
      ],
      intent,
    },
  };
}
