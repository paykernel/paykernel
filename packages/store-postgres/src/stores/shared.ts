/**
 * Shared helpers for PostgreSQL store implementations.
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
} from "@paykernel/internal-sql-store";
import type {
  IdempotencyRecord,
  WebhookInboxRecord,
  ReconciliationRecord,
} from "@paykernel/testkit";
import type { PostgresExecutor } from "../executor";
import type { StoreClock } from "../clock";
import { createSystemClock } from "../clock";
import type { PostgresStoreOptions } from "../types";

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
  /** Mutable active executor (swapped inside withTransaction). */
  getExecutor: () => PostgresExecutor;
  withStoreTransaction: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

export function resolveStoreContext(options: PostgresStoreOptions): ResolvedStoreContext {
  const namespace = createSchemaNamespace(options.namespace ?? {});
  const clock = options.clock ?? createSystemClock();
  let active: PostgresExecutor = options.executor;

  return {
    namespace,
    clock,
    getExecutor: () => active,
    withStoreTransaction: async <T>(fn: () => Promise<T> | T): Promise<T> => {
      const outer = active;
      if (typeof outer.withTransaction !== "function") {
        return await fn();
      }
      return outer.withTransaction(async (tx) => {
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

export function mapIdempotencyRow(row: Record<string, unknown>): IdempotencyRecord {
  const shape = idempotencyRowToRecord(row as unknown as IdempotencySqlRow);
  return toIdempotencyContract(shape);
}

export function mapWebhookRow(row: Record<string, unknown>): WebhookInboxRecord {
  const shape = webhookInboxRowToRecord(row as unknown as WebhookInboxSqlRow);
  return toWebhookContract(shape);
}

export function mapReconciliationRow(row: Record<string, unknown>): ReconciliationRecord {
  const shape = reconciliationRowToRecord(row as unknown as ReconciliationSqlRow);
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
