/**
 * PostgreSQL ReconciliationStore (Phase 9 lease-aware contract).
 */

import {
  reconciliationClaimTemplates,
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
} from "@paykernel/sql-foundation";
import type {
  ClaimReconciliationInput,
  ClaimResult,
  CleanupInput,
  CleanupResult,
  CompleteReconciliationInput,
  FailReconciliationInput,
  ListDueInput,
  MarkManualReviewInput,
  ReconciliationKey,
  ReconciliationRecord,
  ReconciliationStore,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  ScheduleReconciliationInput,
  ScheduleResult,
} from "@paykernel/store-contracts";
import { StoreLeaseLostError, StoreUnavailableError } from "@paykernel/store-contracts";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { PostgresStoreOptions } from "../types";
import { mapReconciliationRow, newLeaseToken, resolveStoreContext } from "./shared";

export function createPostgresReconciliationStore(
  options: PostgresStoreOptions,
): ReconciliationStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.reconciliationJobs, ctx.namespace);
  const claimTpl = reconciliationClaimTemplates(ctx.namespace).postgres;

  async function selectByKey(
    key: string,
  ): Promise<ReconciliationRecord | undefined> {
    const rows = await ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT key, status, subject_id, reason, due_at,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              last_error_sanitized, tenant_id, created_at, updated_at, completed_at
       FROM ${table}
       WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapReconciliationRow(row);
  }

  const store: ReconciliationStore = {
    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        // Insert-if-absent; RETURNING only on insert.
        const inserted = await ctx.getExecutor().query<Record<string, unknown>>(
          `INSERT INTO ${table} (
             key, status, subject_id, reason, due_at,
             attempts, generation, created_at, updated_at
           ) VALUES (
             $1, 'scheduled', $2, $3, $4,
             0, 0, $5, $5
           )
           ON CONFLICT (key) DO NOTHING
           RETURNING key, status, subject_id, reason, due_at,
                     lease_owner, lease_token, lease_expires_at, attempts, generation,
                     last_error_sanitized, tenant_id, created_at, updated_at, completed_at`,
          [input.key, input.subjectId, input.reason, input.dueAt, now],
        );

        if (inserted.length > 0) {
          return {
            kind: "scheduled",
            record: mapReconciliationRow(inserted[0]!),
          };
        }

        const existing = await selectByKey(input.key);
        if (!existing) {
          throw new StoreUnavailableError("schedule: conflict without existing row");
        }
        return { kind: "already_exists", record: existing };
      });
    },

    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);

        // params: key, owner, leaseToken, leaseExpiresAt, now
        const claimed = await ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl.sql,
          [input.key, input.owner, leaseToken, leaseExpiresAt, now],
        );

        if (claimed.length > 0) {
          const record = mapReconciliationRow(claimed[0]!);
          return {
            kind: "acquired",
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const existing = await selectByKey(input.key);
        if (!existing) return { kind: "not_found" };
        if (
          existing.status === "completed" ||
          existing.status === "failed" ||
          existing.status === "manual_review"
        ) {
          return { kind: "already_terminal", record: existing };
        }
        if (
          existing.status === "claimed" &&
          existing.leaseExpiresAt !== undefined &&
          Date.parse(existing.leaseExpiresAt) > ctx.clock.nowMs()
        ) {
          return { kind: "in_progress", record: existing };
        }
        if (Date.parse(existing.dueAt) > ctx.clock.nowMs()) {
          return { kind: "not_due", record: existing };
        }
        // Lease expired but claim WHERE failed for another reason → in_progress-ish
        return { kind: "in_progress", record: existing };
      });
    },

    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const newToken = newLeaseToken();

        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             lease_token = $2,
             lease_expires_at = $3,
             generation = generation + 1,
             updated_at = $4
           WHERE key = $1
             AND lease_token = $5
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > $4
           RETURNING key, status, subject_id, reason, due_at,
                     lease_owner, lease_token, lease_expires_at, attempts, generation,
                     last_error_sanitized, tenant_id, created_at, updated_at, completed_at`,
          [input.key, newToken, leaseExpiresAt, now, input.leaseToken],
        );

        if (rows.length > 0) {
          const record = mapReconciliationRow(rows[0]!);
          return {
            ok: true,
            record,
            leaseToken: record.leaseToken ?? newToken,
          };
        }

        const existing = await selectByKey(input.key);
        if (!existing) return { ok: false, reason: "not_found" };
        if (existing.status !== "claimed") {
          return { ok: false, reason: "wrong_status" };
        }
        return { ok: false, reason: "lease_lost" };
      });
    },

    async complete(input: CompleteReconciliationInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
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
           RETURNING key, status, generation`,
          [input.key, input.leaseToken, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError("complete: lease token rejected or key not found");
        }
      });
    },

    async fail(input: FailReconciliationInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        if (input.retryAt !== undefined) {
          const rows = await ctx.getExecutor().query<Record<string, unknown>>(
            `UPDATE ${table} SET
               status = 'scheduled',
               due_at = $3,
               last_error_sanitized = $4,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               updated_at = $5
             WHERE key = $1
               AND lease_token = $2
               AND status = 'claimed'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at > $5
             RETURNING key, status, generation`,
            [input.key, input.leaseToken, input.retryAt, lastError, now],
          );
          if (rows.length === 0) {
            throw new StoreLeaseLostError("fail: lease token rejected or key not found");
          }
          return;
        }

        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'failed',
             last_error_sanitized = $3,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = $4
           WHERE key = $1
             AND lease_token = $2
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > $4
           RETURNING key, status, generation`,
          [input.key, input.leaseToken, lastError, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError("fail: lease token rejected or key not found");
        }
      });
    },

    async markManualReview(input: MarkManualReviewInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const note =
          input.note !== undefined
            ? enforceMaxSanitizedError(input.note) ?? null
            : null;

        // Token + claimed status (memory parity: no strict active-lease gate).
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'manual_review',
             last_error_sanitized = $3,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = $4
           WHERE key = $1
             AND lease_token = $2
             AND status = 'claimed'
           RETURNING key, status, generation`,
          [input.key, input.leaseToken, note, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "markManualReview: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined> {
      return withMappedErrors(async () => selectByKey(key));
    },

    async listDue(input: ListDueInput): Promise<ReconciliationRecord[]> {
      return withMappedErrors(async () => {
        const now = input.now ?? clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // SKIP LOCKED is for multi-worker fairness on durable rows only.
        // listDue is a non-mutating scan; FOR UPDATE SKIP LOCKED is optional
        // when selecting candidates inside a transaction. Default path is a
        // plain durable SELECT (no advisory locks as sole work record).
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT key, status, subject_id, reason, due_at,
                  lease_owner, lease_token, lease_expires_at, attempts, generation,
                  last_error_sanitized, tenant_id, created_at, updated_at, completed_at
           FROM ${table}
           WHERE status = 'scheduled'
             AND due_at <= $1
           ORDER BY due_at ASC
           LIMIT $2`,
          [now, limit],
        );
        return rows.map(mapReconciliationRow);
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        const limit = input.limit;
        if (limit !== undefined) {
          const rows = await ctx.getExecutor().query<{ key: string }>(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'failed', 'manual_review')
                 AND updated_at <= $1
               ORDER BY updated_at ASC
               LIMIT $2
             )
             RETURNING key`,
            [input.before, limit],
          );
          return { deleted: rows.length };
        }
        const rows = await ctx.getExecutor().query<{ key: string }>(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'failed', 'manual_review')
             AND updated_at <= $1
           RETURNING key`,
          [input.before],
        );
        return { deleted: rows.length };
      });
    },

    withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
      return withMappedTransaction(() => ctx.withStoreTransaction(fn));
    },
  };

  return store;
}
