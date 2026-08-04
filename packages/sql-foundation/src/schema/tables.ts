/**
 * Canonical logical table and column definitions for payment storage.
 *
 * Logical names are used before prefix/schema qualification via
 * {@link import("./namespace.ts").resolveTableName}.
 *
 * Field names map by convention to Phase 9 lease-aware store contracts
 * (`IdempotencyRecord`, `WebhookInboxRecord`, `ReconciliationRecord`) in
 * `@paykernel/testkit`. This package does not import testkit.
 *
 * ## Storage policy (portable)
 *
 * - **Timestamps:** ISO-8601 text (`TEXT`) in portable templates. PostgreSQL
 *   adapters may map columns to `TIMESTAMPTZ` at the dialect boundary.
 * - **payload_hash:** always `TEXT` (hex/base64 digest string), never binary
 *   by default — consistent across dialects.
 * - **IDs / lease tokens:** opaque strings; no JS number for 64-bit DB IDs.
 * - **last_error / error_sanitized:** sanitized caller text only; max length
 *   enforced in codecs/validation (see `MAX_SANITIZED_ERROR_LENGTH`).
 * - **Raw provider payloads/signatures:** not stored by default.
 */

/** Logical table names (before namespace prefix). */
export const LOGICAL_TABLES = {
  idempotency: "payment_idempotency",
  webhookInbox: "payment_webhook_inbox",
  reconciliationJobs: "payment_reconciliation_jobs",
  storageMigrations: "payment_storage_migrations",
} as const;

export type LogicalTableName = (typeof LOGICAL_TABLES)[keyof typeof LOGICAL_TABLES];

export const ALL_LOGICAL_TABLES: readonly LogicalTableName[] = [
  LOGICAL_TABLES.idempotency,
  LOGICAL_TABLES.webhookInbox,
  LOGICAL_TABLES.reconciliationJobs,
  LOGICAL_TABLES.storageMigrations,
] as const;

// ─── Status enums (CHECK constraint values) ──────────────────────────────────

export const IDEMPOTENCY_STATUSES = ["reserved", "completed", "indeterminate", "expired"] as const;
export type IdempotencyStatusSql = (typeof IDEMPOTENCY_STATUSES)[number];

export const WEBHOOK_INBOX_STATUSES = [
  "pending",
  "claimed",
  "completed",
  "failed",
  "dead_letter",
] as const;
export type WebhookInboxStatusSql = (typeof WEBHOOK_INBOX_STATUSES)[number];

export const RECONCILIATION_STATUSES = [
  "scheduled",
  "claimed",
  "completed",
  "failed",
  "manual_review",
] as const;
export type ReconciliationStatusSql = (typeof RECONCILIATION_STATUSES)[number];

// ─── Column maps (snake_case SQL ↔ contract fields) ──────────────────────────

/**
 * `payment_idempotency` columns.
 * Maps to lease-aware idempotency records (fingerprint + optional result_json).
 */
export const IDEMPOTENCY_COLUMNS = {
  key: "key",
  status: "status",
  fingerprint: "fingerprint",
  resultJson: "result_json",
  leaseOwner: "lease_owner",
  leaseToken: "lease_token",
  leaseExpiresAt: "lease_expires_at",
  attempts: "attempts",
  generation: "generation",
  createdAt: "created_at",
  updatedAt: "updated_at",
  tenantId: "tenant_id",
  completedAt: "completed_at",
  indeterminateAt: "indeterminate_at",
  errorSanitized: "error_sanitized",
} as const;

/**
 * `payment_webhook_inbox` columns.
 * payload_hash is TEXT; optional gateway / provider_event_id for indexing.
 */
export const WEBHOOK_INBOX_COLUMNS = {
  key: "key",
  status: "status",
  payloadHash: "payload_hash",
  gateway: "gateway",
  providerEventId: "provider_event_id",
  payloadRef: "payload_ref",
  leaseOwner: "lease_owner",
  leaseToken: "lease_token",
  leaseExpiresAt: "lease_expires_at",
  attempts: "attempts",
  generation: "generation",
  availableAt: "available_at",
  firstReceivedAt: "first_received_at",
  lastReceivedAt: "last_received_at",
  completedAt: "completed_at",
  lastErrorSanitized: "last_error_sanitized",
  tenantId: "tenant_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const;

/**
 * `payment_reconciliation_jobs` columns.
 */
export const RECONCILIATION_COLUMNS = {
  key: "key",
  status: "status",
  subjectId: "subject_id",
  reason: "reason",
  dueAt: "due_at",
  leaseOwner: "lease_owner",
  leaseToken: "lease_token",
  leaseExpiresAt: "lease_expires_at",
  attempts: "attempts",
  generation: "generation",
  lastErrorSanitized: "last_error_sanitized",
  tenantId: "tenant_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
} as const;

/**
 * `payment_storage_migrations` version tracking.
 */
export const MIGRATIONS_COLUMNS = {
  version: "version",
  name: "name",
  appliedAt: "applied_at",
  checksum: "checksum",
} as const;

// ─── Index intent (documented; created in migrations) ────────────────────────

/**
 * Recommended indexes (logical). Prefix/schema applied at migration time.
 *
 * - lease_expires_at: reclaim expired leases / cleanup
 * - available_at / due_at: due retries
 * - (tenant_id, key) when tenant column enabled (tenant_id alone for scans)
 * - status partial indexes where dialect supports them (adapter-level optional)
 */
export const TABLE_INDEX_INTENTS = {
  [LOGICAL_TABLES.idempotency]: ["lease_expires_at", "status", "tenant_id"] as const,
  [LOGICAL_TABLES.webhookInbox]: [
    "lease_expires_at",
    "available_at",
    "status",
    "tenant_id",
    "payload_hash",
  ] as const,
  [LOGICAL_TABLES.reconciliationJobs]: [
    "lease_expires_at",
    "due_at",
    "status",
    "tenant_id",
  ] as const,
} as const;

/** Primary key column for each logical table. */
export const TABLE_PRIMARY_KEYS: Record<LogicalTableName, string> = {
  [LOGICAL_TABLES.idempotency]: IDEMPOTENCY_COLUMNS.key,
  [LOGICAL_TABLES.webhookInbox]: WEBHOOK_INBOX_COLUMNS.key,
  [LOGICAL_TABLES.reconciliationJobs]: RECONCILIATION_COLUMNS.key,
  [LOGICAL_TABLES.storageMigrations]: MIGRATIONS_COLUMNS.version,
};
