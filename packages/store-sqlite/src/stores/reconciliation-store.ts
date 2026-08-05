/**
 * SQLite ReconciliationStore (Phase 9 lease-aware contract).
 *
 * Claim: single conditional UPDATE (sql-store sqlite template) preferably
 * inside BEGIN IMMEDIATE.
 */

import {
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyReconciliationClaimMiss,
  reconciliationClaimTemplates,
  reconciliationTimestampRepairTemplates,
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
import type { SqliteStoreOptions } from "../types";
import { mapReconciliationRow, newLeaseToken, resolveStoreContext } from "./shared";

function claimMissToResult(
  kind: Exclude<ReturnType<typeof classifyReconciliationClaimMiss>, "claimable">,
  existing: ReconciliationRecord | undefined,
): ClaimResult {
  if (kind === "not_found" || existing === undefined) {
    return { kind: "not_found" };
  }
  return { kind, record: existing };
}

const SELECT_COLS = `key, status, subject_id, reason, due_at,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              last_error_sanitized, tenant_id, created_at, updated_at, completed_at`;

export function createSqliteReconciliationStore(
  options: SqliteStoreOptions,
): ReconciliationStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.reconciliationJobs, ctx.namespace);
  const claimTpl = reconciliationClaimTemplates(ctx.namespace).sqlite;
  const repairTpl = reconciliationTimestampRepairTemplates(ctx.namespace).sqlite;

  function selectByKey(key: string): ReconciliationRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${SELECT_COLS}
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
        const dueAt = canonicalizeIsoTimestamp(input.dueAt, "dueAt");
        const exec = ctx.getExecutor();

        return exec.transaction(() => {
          const inserted = exec.run(
            `INSERT OR IGNORE INTO ${table} (
               key, status, subject_id, reason, due_at,
               attempts, generation, created_at, updated_at
             ) VALUES (
               ?, 'scheduled', ?, ?, ?,
               0, 0, ?, ?
             )`,
            [input.key, input.subjectId, input.reason, dueAt, now, now],
          );

          if (inserted.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "schedule: insert succeeded but row missing",
              );
            }
            return { kind: "scheduled" as const, record };
          }

          const existing = selectByKey(input.key);
          if (!existing) {
            throw new StoreUnavailableError(
              "schedule: conflict without existing row",
            );
          }
          return { kind: "already_exists" as const, record: existing };
        }, { mode: "immediate" });
      });
    },

    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      return withMappedErrors(() => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const exec = ctx.getExecutor();

        return exec.transaction(() => {
          // params: owner, leaseToken, leaseExpiresAt, now, key, now, now
          const claimed = exec.run(claimTpl.sql, [
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            input.key,
            now,
            now,
          ]);

          if (claimed.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "reconciliation claim: update succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          const existing = selectByKey(input.key);
          const miss = classifyReconciliationClaimMiss(existing, ctx.clock.nowMs());
          if (miss !== "claimable") {
            return claimMissToResult(miss, existing);
          }

          // SQL-1/SQL-2: free due work; repair non-canonical TEXT timestamps and
          // retry once. Free-lease fence (plus BEGIN IMMEDIATE) so repair never
          // overwrites an active winner lease_expires_at from a stale snapshot.
          const dueAtZ = canonicalizeIsoTimestamp(existing!.dueAt, "dueAt");
          const leaseZ =
            canonicalizeOptionalIsoTimestamp(existing!.leaseExpiresAt, "leaseExpiresAt") ??
            null;
          // params: dueAt, leaseExpiresAt, key, now
          exec.run(repairTpl.sql, [dueAtZ, leaseZ, input.key, now]);

          const retried = exec.run(claimTpl.sql, [
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            input.key,
            now,
            now,
          ]);
          if (retried.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "reconciliation claim: update succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          const after = selectByKey(input.key);
          const miss2 = classifyReconciliationClaimMiss(after, ctx.clock.nowMs());
          if (miss2 === "claimable") {
            throw new StoreUnavailableError(
              "reconciliation claim: free due work failed after timestamp canonicalize; retry",
            );
          }
          return claimMissToResult(miss2, after);
        }, { mode: "immediate" });
      });
    },

    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const newToken = newLeaseToken();
        const exec = ctx.getExecutor();

        return exec.transaction(() => {
          const result = exec.run(
            `UPDATE ${table} SET
               lease_token = ?,
               lease_expires_at = ?,
               generation = generation + 1,
               updated_at = ?
             WHERE key = ?
               AND lease_token = ?
               AND status = 'claimed'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at > ?`,
            [newToken, leaseExpiresAt, now, input.key, input.leaseToken, now],
          );

          if (result.changes > 0) {
            const record = selectByKey(input.key);
            if (!record) return { ok: false as const, reason: "not_found" as const };
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
        }, { mode: "immediate" });
      });
    },

    async complete(input: CompleteReconciliationInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const result = ctx.getExecutor().run(
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
             AND lease_expires_at > ?`,
          [now, now, input.key, input.leaseToken, now],
        );
        if (result.changes === 0) {
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
        const exec = ctx.getExecutor();

        if (input.retryAt !== undefined) {
          const retryAt = canonicalizeIsoTimestamp(input.retryAt, "retryAt");
          const result = exec.run(
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
               AND lease_expires_at > ?`,
            [retryAt, lastError, now, input.key, input.leaseToken, now],
          );
          if (result.changes === 0) {
            throw new StoreLeaseLostError(
              "fail: lease token rejected or key not found",
            );
          }
          return;
        }

        const result = exec.run(
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
             AND lease_expires_at > ?`,
          [lastError, now, input.key, input.leaseToken, now],
        );
        if (result.changes === 0) {
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

        // Active-lease fence (parity with complete/fail).
        const result = ctx.getExecutor().run(
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
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?`,
          [note, now, input.key, input.leaseToken, now],
        );
        if (result.changes === 0) {
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
        // Soft-release abandoned expired claims so processDue/claimDue can
        // rediscover them after worker crash (attempts kept; lease cleared).
        // Matches memory listDue releaseExpiredLease + webhook listRetryable.
        ctx.getExecutor().run(
          `UPDATE ${table} SET
             status = 'scheduled',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = ?
           WHERE status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`,
          [now, now],
        );
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT ${SELECT_COLS}
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
        const exec = ctx.getExecutor();
        if (limit !== undefined) {
          const result = exec.run(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'failed', 'manual_review')
                 AND updated_at <= ?
               ORDER BY updated_at ASC
               LIMIT ?
             )`,
            [input.before, limit],
          );
          return { deleted: result.changes };
        }
        const result = exec.run(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'failed', 'manual_review')
             AND updated_at <= ?`,
          [input.before],
        );
        return { deleted: result.changes };
      });
    },

    withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
      return withMappedTransaction(() => ctx.withStoreTransaction(fn));
    },
  };

  return store;
}
