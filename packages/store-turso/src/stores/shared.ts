/**
 * Shared helpers for Turso / libSQL store implementations.
 */

import {
  createSchemaNamespace,
  type ResolvedSchemaNamespace,
  type IdempotencyRecordShape,
  type WebhookInboxRecordShape,
  type ReconciliationRecordShape,
  type IdempotencySqlRow,
  type WebhookInboxSqlRow,
  type ReconciliationSqlRow,
  idempotencyRowToRecord,
  webhookInboxRowToRecord,
  reconciliationRowToRecord,
} from "@paykernel/sql-foundation";
import type {
  IdempotencyRecord,
  WebhookInboxRecord,
  ReconciliationRecord,
} from "@paykernel/store-contracts";
import { StoreUnsupportedFeatureError } from "@paykernel/store-contracts";
import type { TursoExecutor } from "../executor";
import type { StoreClock } from "../clock";
import { createSystemClock } from "../clock";
import type { TursoStoreOptions } from "../types";

/** Unguessable opaque lease token (portable; not a 64-bit number). */
export function newLeaseToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return `lt_${hex}`;
}

export type ResolvedStoreContext = {
  namespace: ResolvedSchemaNamespace;
  clock: StoreClock;
  /** Mutable active executor (swapped inside transaction). */
  getExecutor: () => TursoExecutor;
  withStoreTransaction: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

export function resolveStoreContext(options: TursoStoreOptions): ResolvedStoreContext {
  const namespace = createSchemaNamespace(options.namespace ?? {});
  const clock = options.clock ?? createSystemClock();
  let active: TursoExecutor = options.executor;

  return {
    namespace,
    clock,
    getExecutor: () => active,
    withStoreTransaction: async <T>(fn: () => Promise<T> | T): Promise<T> => {
      const outer = active;
      if (typeof outer.transaction !== "function") {
        // Fail closed: never pretend multi-mutation atomicity without a real TX
        // (SHARED-1). Prefer single-statement UPSERT/RETURNING.
        throw new StoreUnsupportedFeatureError(
          "withTransaction: TursoExecutor.transaction is not available; refusing silent no-op. Prefer single-statement claims or an executor that supports interactive transactions.",
        );
      }
      return outer.transaction(async (tx) => {
        const prev = active;
        active = tx;
        try {
          return await fn();
        } finally {
          active = prev;
        }
      });
    },
  };
}

/**
 * Normalize driver row quirks (BigInt integers, missing nulls).
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") {
      if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) {
        out[k] = Number(v);
      } else {
        out[k] = v.toString();
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function mapIdempotencyRow(row: Record<string, unknown>): IdempotencyRecord {
  const shape = idempotencyRowToRecord(normalizeRow(row) as unknown as IdempotencySqlRow);
  return toIdempotencyContract(shape);
}

export function mapWebhookRow(row: Record<string, unknown>): WebhookInboxRecord {
  const shape = webhookInboxRowToRecord(normalizeRow(row) as unknown as WebhookInboxSqlRow);
  return toWebhookContract(shape);
}

export function mapReconciliationRow(row: Record<string, unknown>): ReconciliationRecord {
  const shape = reconciliationRowToRecord(
    normalizeRow(row) as unknown as ReconciliationSqlRow,
  );
  return toReconciliationContract(shape);
}

function toIdempotencyContract(shape: IdempotencyRecordShape): IdempotencyRecord {
  const rec: IdempotencyRecord = {
    key: shape.key,
    status: shape.status,
    fingerprint: shape.fingerprint,
    attempts: shape.attempts,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
    generation: shape.generation,
  };
  if (shape.leaseOwner !== undefined) rec.leaseOwner = shape.leaseOwner;
  if (shape.leaseToken !== undefined) rec.leaseToken = shape.leaseToken;
  if (shape.leaseExpiresAt !== undefined) rec.leaseExpiresAt = shape.leaseExpiresAt;
  if (shape.result !== undefined) rec.result = shape.result;
  return rec;
}

function toWebhookContract(shape: WebhookInboxRecordShape): WebhookInboxRecord {
  const rec: WebhookInboxRecord = {
    key: shape.key,
    status: shape.status,
    payloadHash: shape.payloadHash,
    attempts: shape.attempts,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
    availableAt: shape.availableAt,
    generation: shape.generation,
  };
  if (shape.payloadRef !== undefined) rec.payloadRef = shape.payloadRef;
  if (shape.leaseOwner !== undefined) rec.leaseOwner = shape.leaseOwner;
  if (shape.leaseToken !== undefined) rec.leaseToken = shape.leaseToken;
  if (shape.leaseExpiresAt !== undefined) rec.leaseExpiresAt = shape.leaseExpiresAt;
  if (shape.lastError !== undefined) rec.lastError = shape.lastError;
  return rec;
}

function toReconciliationContract(shape: ReconciliationRecordShape): ReconciliationRecord {
  const rec: ReconciliationRecord = {
    key: shape.key,
    status: shape.status,
    subjectId: shape.subjectId,
    reason: shape.reason,
    attempts: shape.attempts,
    dueAt: shape.dueAt,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
    generation: shape.generation,
  };
  if (shape.leaseOwner !== undefined) rec.leaseOwner = shape.leaseOwner;
  if (shape.leaseToken !== undefined) rec.leaseToken = shape.leaseToken;
  if (shape.leaseExpiresAt !== undefined) rec.leaseExpiresAt = shape.leaseExpiresAt;
  if (shape.lastError !== undefined) rec.lastError = shape.lastError;
  return rec;
}

export function serializeResultJson(result: unknown): string {
  return JSON.stringify(result);
}

/** Idempotency SELECT column list. */
export const IDEMPOTENCY_SELECT_COLS = `key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
              attempts, generation, created_at, updated_at, result_json,
              completed_at, indeterminate_at, error_sanitized, tenant_id`;

/** Webhook inbox SELECT column list. */
export const WEBHOOK_SELECT_COLS = `key, status, payload_hash, payload_ref, gateway, provider_event_id,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              available_at, first_received_at, last_received_at, completed_at,
              last_error_sanitized, tenant_id, created_at, updated_at`;

/** Reconciliation SELECT column list. */
export const RECON_SELECT_COLS = `key, status, subject_id, reason, due_at,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              last_error_sanitized, tenant_id, created_at, updated_at, completed_at`;
