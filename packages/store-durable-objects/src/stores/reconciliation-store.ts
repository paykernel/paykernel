/**
 * Cloudflare DO ReconciliationStore (Phase 9 lease-aware contract).
 *
 * Claim: single conditional UPDATE … RETURNING (row must exist via schedule).
 */

import {
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
} from "@paykernel/internal-sql-store";
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
} from "@paykernel/testkit";
import { StoreLeaseLostError, StoreUnavailableError } from "@paykernel/testkit";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { DoStoreOptions } from "../types";
import {
  RECON_SELECT_COLS,
  mapReconciliationRow,
  newLeaseToken,
  resolveStoreContext,
} from "./shared";

/**
 * Single-statement claim UPDATE + RETURNING.
 * params: owner, leaseToken, leaseExpiresAt, now, key, now, now
 */
function claimSql(table: string): string {
  return `
UPDATE ${table} SET
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
RETURNING ${RECON_SELECT_COLS}
`.trim();
}

export function createDoReconciliationStore(
  options: DoStoreOptions,
): ReconciliationStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.reconciliationJobs, ctx.namespace);
  const claimTpl = claimSql(table);

  function selectByKey(key: string): ReconciliationRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${RECON_SELECT_COLS}
       FROM ${table}
       WHERE key = ?`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapReconciliationRow(row);
  }

  const store: ReconciliationStore = {
    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const inserted = ctx.getExecutor().query<Record<string, unknown>>(
          `INSERT INTO ${table} (
             key, status, subject_id, reason, due_at,
             attempts, generation, created_at, updated_at
           ) VALUES (
             ?, 'scheduled', ?, ?, ?,
             0, 0, ?, ?
           )
           ON CONFLICT (key) DO NOTHING
           RETURNING ${RECON_SELECT_COLS}`,
          [input.key, input.subjectId, input.reason, input.dueAt, now, now],
        );

        if (inserted.length > 0) {
          return {
            kind: "scheduled" as const,
            record: mapReconciliationRow(inserted[0]!),
          };
        }

        const existing = selectByKey(input.key);
        if (!existing) {
          throw new StoreUnavailableError("schedule: conflict without existing row");
        }
        return { kind: "already_exists" as const, record: existing };
      });
    },

    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      return withMappedErrors(() => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);

        const claimed = ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl,
          [input.owner, leaseToken, leaseExpiresAt, now, input.key, now, now],
        );

        if (claimed.length > 0) {
          const record = mapReconciliationRow(claimed[0]!);
          return {
            kind: "acquired" as const,
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const existing = selectByKey(input.key);
        if (!existing) return { kind: "not_found" as const };
        if (
          existing.status === "completed" ||
          existing.status === "failed" ||
          existing.status === "manual_review"
        ) {
          return { kind: "already_terminal" as const, record: existing };
        }
        if (
          existing.status === "claimed" &&
          existing.leaseExpiresAt !== undefined &&
          Date.parse(existing.leaseExpiresAt) > ctx.clock.nowMs()
        ) {
          return { kind: "in_progress" as const, record: existing };
        }
        if (Date.parse(existing.dueAt) > ctx.clock.nowMs()) {
          return { kind: "not_due" as const, record: existing };
        }
        return { kind: "in_progress" as const, record: existing };
      });
    },

    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const newToken = newLeaseToken();

        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             lease_token = ?,
             lease_expires_at = ?,
             generation = generation + 1,
             updated_at = ?
           WHERE key = ?
             AND lease_token = ?
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?
           RETURNING ${RECON_SELECT_COLS}`,
          [newToken, leaseExpiresAt, now, input.key, input.leaseToken, now],
        );

        if (rows.length > 0) {
          const record = mapReconciliationRow(rows[0]!);
          return {
            ok: true as const,
            record,
            leaseToken: record.leaseToken ?? newToken,
          };
        }

        const existing = selectByKey(input.key);
        if (!existing) return { ok: false as const, reason: "not_found" as const };
        if (existing.status !== "claimed") {
          return { ok: false as const, reason: "wrong_status" as const };
        }
        return { ok: false as const, reason: "lease_lost" as const };
      });
    },

    async complete(input: CompleteReconciliationInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
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
           RETURNING key, status, generation`,
          [now, now, input.key, input.leaseToken, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "complete: lease token rejected or key not found",
          );
        }
      });
    },

    async fail(input: FailReconciliationInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        if (input.retryAt !== undefined) {
          const rows = ctx.getExecutor().query<Record<string, unknown>>(
            `UPDATE ${table} SET
               status = 'scheduled',
               due_at = ?,
               last_error_sanitized = ?,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               updated_at = ?
             WHERE key = ?
               AND lease_token = ?
               AND status = 'claimed'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at > ?
             RETURNING key, status, generation`,
            [input.retryAt, lastError, now, input.key, input.leaseToken, now],
          );
          if (rows.length === 0) {
            throw new StoreLeaseLostError(
              "fail: lease token rejected or key not found",
            );
          }
          return;
        }

        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'failed',
             last_error_sanitized = ?,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = ?
           WHERE key = ?
             AND lease_token = ?
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?
           RETURNING key, status, generation`,
          [lastError, now, input.key, input.leaseToken, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "fail: lease token rejected or key not found",
          );
        }
      });
    },

    async markManualReview(input: MarkManualReviewInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const note =
          input.note !== undefined
            ? enforceMaxSanitizedError(input.note) ?? null
            : null;

        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'manual_review',
             last_error_sanitized = ?,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = ?
           WHERE key = ?
             AND lease_token = ?
             AND status = 'claimed'
           RETURNING key, status, generation`,
          [note, now, input.key, input.leaseToken],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "markManualReview: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined> {
      return withMappedErrors(() => selectByKey(key));
    },

    async listDue(input: ListDueInput): Promise<ReconciliationRecord[]> {
      return withMappedErrors(() => {
        const now = input.now ?? clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT ${RECON_SELECT_COLS}
           FROM ${table}
           WHERE status = 'scheduled'
             AND due_at <= ?
           ORDER BY due_at ASC
           LIMIT ?`,
          [now, limit],
        );
        return rows.map(mapReconciliationRow);
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() => {
        const limit = input.limit;
        if (limit !== undefined) {
          const rows = ctx.getExecutor().query<{ key: string }>(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'failed', 'manual_review')
                 AND updated_at <= ?
               ORDER BY updated_at ASC
               LIMIT ?
             )
             RETURNING key`,
            [input.before, limit],
          );
          return { deleted: rows.length };
        }
        const rows = ctx.getExecutor().query<{ key: string }>(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'failed', 'manual_review')
             AND updated_at <= ?
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
