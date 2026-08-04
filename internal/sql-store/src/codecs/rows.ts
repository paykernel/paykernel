/**
 * Normalized row codecs: SQL snake_case rows ↔ contract-shaped records.
 *
 * Aligns with Phase 9 testkit field names by convention (no testkit import).
 * Timestamps remain ISO-8601 strings; result_json is JSON text.
 */

import type {
  IdempotencyStatusSql,
  ReconciliationStatusSql,
  WebhookInboxStatusSql,
} from "../schema/tables";
import {
  enforceMaxSanitizedError,
  requireNonEmptyString,
  validateIdempotencyStatus,
  validateIsoTimestamp,
  validateNonNegativeInt,
  validateOptionalIsoTimestamp,
  validatePayloadHash,
  validateReconciliationStatus,
  validateWebhookInboxStatus,
} from "./validation";

export type { IdempotencyStatusSql, ReconciliationStatusSql, WebhookInboxStatusSql };

// ─── Contract-shaped records (mirror Phase 9; local definitions) ─────────────

export type IdempotencyRecordShape = {
  key: string;
  status: IdempotencyStatusSql;
  fingerprint: string;
  leaseOwner?: string | undefined;
  leaseToken?: string | undefined;
  leaseExpiresAt?: string | undefined;
  result?: unknown;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  generation: number;
  tenantId?: string | undefined;
  completedAt?: string | undefined;
  indeterminateAt?: string | undefined;
  errorSanitized?: string | undefined;
};

export type WebhookInboxRecordShape = {
  key: string;
  status: WebhookInboxStatusSql;
  payloadHash: string;
  gateway?: string | undefined;
  providerEventId?: string | undefined;
  payloadRef?: string | undefined;
  leaseOwner?: string | undefined;
  leaseToken?: string | undefined;
  leaseExpiresAt?: string | undefined;
  attempts: number;
  lastError?: string | undefined;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  generation: number;
  firstReceivedAt?: string | undefined;
  lastReceivedAt?: string | undefined;
  completedAt?: string | undefined;
  tenantId?: string | undefined;
};

export type ReconciliationRecordShape = {
  key: string;
  status: ReconciliationStatusSql;
  subjectId: string;
  reason: string;
  leaseOwner?: string | undefined;
  leaseToken?: string | undefined;
  leaseExpiresAt?: string | undefined;
  attempts: number;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string | undefined;
  generation: number;
  tenantId?: string | undefined;
  completedAt?: string | undefined;
};

export type MigrationRecordShape = {
  version: number;
  name: string;
  appliedAt: string;
  checksum?: string | undefined;
};

// ─── SQL row shapes (snake_case; nullable driver values) ─────────────────────

export type IdempotencySqlRow = {
  key: string;
  status: string;
  fingerprint: string | null;
  result_json: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number | string | bigint;
  generation: number | string | bigint;
  created_at: string;
  updated_at: string;
  tenant_id?: string | null;
  completed_at?: string | null;
  indeterminate_at?: string | null;
  error_sanitized?: string | null;
};

export type WebhookInboxSqlRow = {
  key: string;
  status: string;
  payload_hash: string;
  gateway?: string | null;
  provider_event_id?: string | null;
  payload_ref?: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number | string | bigint;
  generation: number | string | bigint;
  available_at: string | null;
  first_received_at?: string | null;
  last_received_at?: string | null;
  completed_at?: string | null;
  last_error_sanitized?: string | null;
  tenant_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ReconciliationSqlRow = {
  key: string;
  status: string;
  subject_id: string | null;
  reason: string | null;
  due_at: string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number | string | bigint;
  generation: number | string | bigint;
  last_error_sanitized?: string | null;
  tenant_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type MigrationSqlRow = {
  version: number | string | bigint;
  name: string;
  applied_at: string;
  checksum?: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function optString(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

function parseResultJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Preserve as opaque string if not valid JSON (adapter bug surface).
    return raw;
  }
}

function serializeResultJson(result: unknown): string | null {
  if (result === undefined) return null;
  return JSON.stringify(result);
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

export function idempotencyRowToRecord(row: IdempotencySqlRow): IdempotencyRecordShape {
  const record: IdempotencyRecordShape = {
    key: requireNonEmptyString(row.key, "key"),
    status: validateIdempotencyStatus(row.status),
    fingerprint: requireNonEmptyString(row.fingerprint ?? "", "fingerprint"),
    attempts: validateNonNegativeInt(row.attempts, "attempts"),
    createdAt: validateIsoTimestamp(row.created_at, "createdAt"),
    updatedAt: validateIsoTimestamp(row.updated_at, "updatedAt"),
    generation: validateNonNegativeInt(row.generation, "generation"),
  };

  const leaseOwner = optString(row.lease_owner);
  if (leaseOwner !== undefined) record.leaseOwner = leaseOwner;
  const leaseToken = optString(row.lease_token);
  if (leaseToken !== undefined) record.leaseToken = leaseToken;
  const leaseExpiresAt = validateOptionalIsoTimestamp(row.lease_expires_at, "leaseExpiresAt");
  if (leaseExpiresAt !== undefined) record.leaseExpiresAt = leaseExpiresAt;

  const result = parseResultJson(row.result_json);
  if (result !== undefined) record.result = result;

  const tenantId = optString(row.tenant_id);
  if (tenantId !== undefined) record.tenantId = tenantId;
  const completedAt = validateOptionalIsoTimestamp(row.completed_at, "completedAt");
  if (completedAt !== undefined) record.completedAt = completedAt;
  const indeterminateAt = validateOptionalIsoTimestamp(row.indeterminate_at, "indeterminateAt");
  if (indeterminateAt !== undefined) record.indeterminateAt = indeterminateAt;
  const errorSanitized = enforceMaxSanitizedError(row.error_sanitized);
  if (errorSanitized !== undefined) record.errorSanitized = errorSanitized;

  return record;
}

export function idempotencyRecordToRow(record: IdempotencyRecordShape): IdempotencySqlRow {
  const row: IdempotencySqlRow = {
    key: requireNonEmptyString(record.key, "key"),
    status: validateIdempotencyStatus(record.status),
    fingerprint: requireNonEmptyString(record.fingerprint, "fingerprint"),
    result_json: serializeResultJson(record.result),
    lease_owner: record.leaseOwner ?? null,
    lease_token: record.leaseToken ?? null,
    lease_expires_at: record.leaseExpiresAt ?? null,
    attempts: validateNonNegativeInt(record.attempts, "attempts"),
    generation: validateNonNegativeInt(record.generation, "generation"),
    created_at: validateIsoTimestamp(record.createdAt, "createdAt"),
    updated_at: validateIsoTimestamp(record.updatedAt, "updatedAt"),
    tenant_id: record.tenantId ?? null,
    completed_at: record.completedAt ?? null,
    indeterminate_at: record.indeterminateAt ?? null,
    error_sanitized: enforceMaxSanitizedError(record.errorSanitized) ?? null,
  };
  return row;
}

// ─── Webhook inbox ───────────────────────────────────────────────────────────

export function webhookInboxRowToRecord(row: WebhookInboxSqlRow): WebhookInboxRecordShape {
  const createdAt = validateIsoTimestamp(row.created_at, "createdAt");
  const availableAt = validateOptionalIsoTimestamp(row.available_at, "availableAt") ?? createdAt;

  const record: WebhookInboxRecordShape = {
    key: requireNonEmptyString(row.key, "key"),
    status: validateWebhookInboxStatus(row.status),
    payloadHash: validatePayloadHash(row.payload_hash),
    attempts: validateNonNegativeInt(row.attempts, "attempts"),
    createdAt,
    updatedAt: validateIsoTimestamp(row.updated_at, "updatedAt"),
    availableAt,
    generation: validateNonNegativeInt(row.generation, "generation"),
  };

  const gateway = optString(row.gateway);
  if (gateway !== undefined) record.gateway = gateway;
  const providerEventId = optString(row.provider_event_id);
  if (providerEventId !== undefined) record.providerEventId = providerEventId;
  const payloadRef = optString(row.payload_ref);
  if (payloadRef !== undefined) record.payloadRef = payloadRef;
  const leaseOwner = optString(row.lease_owner);
  if (leaseOwner !== undefined) record.leaseOwner = leaseOwner;
  const leaseToken = optString(row.lease_token);
  if (leaseToken !== undefined) record.leaseToken = leaseToken;
  const leaseExpiresAt = validateOptionalIsoTimestamp(row.lease_expires_at, "leaseExpiresAt");
  if (leaseExpiresAt !== undefined) record.leaseExpiresAt = leaseExpiresAt;
  const lastError = enforceMaxSanitizedError(row.last_error_sanitized);
  if (lastError !== undefined) record.lastError = lastError;
  const firstReceivedAt = validateOptionalIsoTimestamp(row.first_received_at, "firstReceivedAt");
  if (firstReceivedAt !== undefined) record.firstReceivedAt = firstReceivedAt;
  const lastReceivedAt = validateOptionalIsoTimestamp(row.last_received_at, "lastReceivedAt");
  if (lastReceivedAt !== undefined) record.lastReceivedAt = lastReceivedAt;
  const completedAt = validateOptionalIsoTimestamp(row.completed_at, "completedAt");
  if (completedAt !== undefined) record.completedAt = completedAt;
  const tenantId = optString(row.tenant_id);
  if (tenantId !== undefined) record.tenantId = tenantId;

  return record;
}

export function webhookInboxRecordToRow(record: WebhookInboxRecordShape): WebhookInboxSqlRow {
  return {
    key: requireNonEmptyString(record.key, "key"),
    status: validateWebhookInboxStatus(record.status),
    payload_hash: validatePayloadHash(record.payloadHash),
    gateway: record.gateway ?? null,
    provider_event_id: record.providerEventId ?? null,
    payload_ref: record.payloadRef ?? null,
    lease_owner: record.leaseOwner ?? null,
    lease_token: record.leaseToken ?? null,
    lease_expires_at: record.leaseExpiresAt ?? null,
    attempts: validateNonNegativeInt(record.attempts, "attempts"),
    generation: validateNonNegativeInt(record.generation, "generation"),
    available_at: validateIsoTimestamp(record.availableAt, "availableAt"),
    first_received_at: record.firstReceivedAt ?? null,
    last_received_at: record.lastReceivedAt ?? null,
    completed_at: record.completedAt ?? null,
    last_error_sanitized: enforceMaxSanitizedError(record.lastError) ?? null,
    tenant_id: record.tenantId ?? null,
    created_at: validateIsoTimestamp(record.createdAt, "createdAt"),
    updated_at: validateIsoTimestamp(record.updatedAt, "updatedAt"),
  };
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

export function reconciliationRowToRecord(row: ReconciliationSqlRow): ReconciliationRecordShape {
  const record: ReconciliationRecordShape = {
    key: requireNonEmptyString(row.key, "key"),
    status: validateReconciliationStatus(row.status),
    subjectId: requireNonEmptyString(row.subject_id ?? "", "subjectId"),
    reason: row.reason ?? "",
    attempts: validateNonNegativeInt(row.attempts, "attempts"),
    dueAt: validateIsoTimestamp(row.due_at, "dueAt"),
    createdAt: validateIsoTimestamp(row.created_at, "createdAt"),
    updatedAt: validateIsoTimestamp(row.updated_at, "updatedAt"),
    generation: validateNonNegativeInt(row.generation, "generation"),
  };

  const leaseOwner = optString(row.lease_owner);
  if (leaseOwner !== undefined) record.leaseOwner = leaseOwner;
  const leaseToken = optString(row.lease_token);
  if (leaseToken !== undefined) record.leaseToken = leaseToken;
  const leaseExpiresAt = validateOptionalIsoTimestamp(row.lease_expires_at, "leaseExpiresAt");
  if (leaseExpiresAt !== undefined) record.leaseExpiresAt = leaseExpiresAt;
  const lastError = enforceMaxSanitizedError(row.last_error_sanitized);
  if (lastError !== undefined) record.lastError = lastError;
  const tenantId = optString(row.tenant_id);
  if (tenantId !== undefined) record.tenantId = tenantId;
  const completedAt = validateOptionalIsoTimestamp(row.completed_at, "completedAt");
  if (completedAt !== undefined) record.completedAt = completedAt;

  return record;
}

export function reconciliationRecordToRow(record: ReconciliationRecordShape): ReconciliationSqlRow {
  return {
    key: requireNonEmptyString(record.key, "key"),
    status: validateReconciliationStatus(record.status),
    subject_id: requireNonEmptyString(record.subjectId, "subjectId"),
    reason: record.reason,
    due_at: validateIsoTimestamp(record.dueAt, "dueAt"),
    lease_owner: record.leaseOwner ?? null,
    lease_token: record.leaseToken ?? null,
    lease_expires_at: record.leaseExpiresAt ?? null,
    attempts: validateNonNegativeInt(record.attempts, "attempts"),
    generation: validateNonNegativeInt(record.generation, "generation"),
    last_error_sanitized: enforceMaxSanitizedError(record.lastError) ?? null,
    tenant_id: record.tenantId ?? null,
    created_at: validateIsoTimestamp(record.createdAt, "createdAt"),
    updated_at: validateIsoTimestamp(record.updatedAt, "updatedAt"),
    completed_at: record.completedAt ?? null,
  };
}

// ─── Migrations ──────────────────────────────────────────────────────────────

export function migrationRowToRecord(row: MigrationSqlRow): MigrationRecordShape {
  const record: MigrationRecordShape = {
    version: validateNonNegativeInt(row.version, "version"),
    name: requireNonEmptyString(row.name, "name"),
    appliedAt: validateIsoTimestamp(row.applied_at, "appliedAt"),
  };
  const checksum = optString(row.checksum);
  if (checksum !== undefined) record.checksum = checksum;
  return record;
}

export function migrationRecordToRow(record: MigrationRecordShape): MigrationSqlRow {
  return {
    version: validateNonNegativeInt(record.version, "version"),
    name: requireNonEmptyString(record.name, "name"),
    applied_at: validateIsoTimestamp(record.appliedAt, "appliedAt"),
    checksum: record.checksum ?? null,
  };
}
