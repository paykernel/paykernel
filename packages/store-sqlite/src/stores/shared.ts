/**
 * Shared helpers for SQLite store implementations.
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
import type { SqliteExecutor } from "../executor";
import type { StoreClock } from "../clock";
import { createSystemClock } from "../clock";
import type { SqliteStoreOptions } from "../types";

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
  /** Connection executor (nestable IMMEDIATE transactions on this connection). */
  getExecutor: () => SqliteExecutor;
  /**
   * Outer unit of work for optional `withTransaction`.
   * Prefer `runInTransaction` when present so async store methods can join
   * and roll back together with nested IMMEDIATE claim transactions.
   */
  withStoreTransaction: <T>(fn: () => Promise<T> | T) => Promise<T>;
};

export function resolveStoreContext(options: SqliteStoreOptions): ResolvedStoreContext {
  const namespace = createSchemaNamespace(options.namespace ?? {});
  const clock = options.clock ?? createSystemClock();
  const executor = options.executor;

  return {
    namespace,
    clock,
    getExecutor: () => executor,
    withStoreTransaction: async <T>(fn: () => Promise<T> | T): Promise<T> => {
      if (typeof executor.runInTransaction === "function") {
        return executor.runInTransaction(() => fn(), { mode: "immediate" });
      }
      // Sync-only fallback: nested transaction() joins via driver depth counter.
      return executor.transaction(() => {
        const outcome = fn();
        if (
          outcome !== null &&
          typeof outcome === "object" &&
          typeof (outcome as Promise<T>).then === "function"
        ) {
          throw new Error(
            "withTransaction: async callbacks require executor.runInTransaction",
          );
        }
        return outcome as T;
      }, { mode: "immediate" });
    },
  };
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

/**
 * Normalize driver row quirks (BigInt integers, missing nulls).
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") {
      // Prefer number when safe; otherwise string to avoid precision loss.
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

/** Extract SQL statements from multi-step template comments. */
export function extractSqliteSteps(templateSql: string): string[] {
  // Strip leading comment lines; split on `-- step` markers if present.
  const parts = templateSql.split(/\n-- step\d+[^\n]*\n/);
  const steps: string[] = [];
  for (const part of parts) {
    const trimmed = part
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (trimmed) steps.push(trimmed);
  }
  return steps;
}
