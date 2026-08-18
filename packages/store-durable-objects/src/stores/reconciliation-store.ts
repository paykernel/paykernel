/**
 * Cloudflare DO ReconciliationStore (Phase 9 lease-aware contract).
 *
 * Claim: single conditional UPDATE … RETURNING (row must exist via schedule).
 */

import {
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyReconciliationClaimMiss,
  reconciliationFailTemplates,
  reconciliationMarkManualReviewTemplates,
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
import type { ShardOccupancyHint } from "../occupancy";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { DoStoreOptions } from "../types";
import {
  DEFAULT_DELETE_EXPIRED_LIMIT,
  RECON_SELECT_COLS,
  mapReconciliationRow,
  newLeaseToken,
  resolveStoreContext,
} from "./shared";

function claimMissToResult(
  kind: Exclude<ReturnType<typeof classifyReconciliationClaimMiss>, "claimable">,
  existing: ReconciliationRecord | undefined,
): ClaimResult {
  if (kind === "not_found" || existing === undefined) {
    return { kind: "not_found" };
  }
  return { kind, record: existing };
}

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
  -- STORES-1: scheduled burns an attempt; expired claimed reclaim does not
  attempts = CASE
    WHEN status = 'claimed' THEN attempts
    ELSE attempts + 1
  END,
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

type DoReconciliationStore = ReconciliationStore & {
  /**
   * PERF-5: cheap occupancy probe. Occupied when this shard has scheduled-due
   * work **or** expired claimed rows (listDue will soft-release those).
   * `earliest` is MIN(due_at) of those rows. Read-only — does not mutate leases.
   */
  peekDue(input: ListDueInput): Promise<ShardOccupancyHint>;
};

export function createDoReconciliationStore(
  options: DoStoreOptions,
): DoReconciliationStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.reconciliationJobs, ctx.namespace);
  const claimTpl = claimSql(table);
  const failTpl = reconciliationFailTemplates(ctx.namespace).sqlite;
  const reviewTpl = reconciliationMarkManualReviewTemplates(ctx.namespace).sqlite;
  const repairTpl = reconciliationTimestampRepairTemplates(ctx.namespace).sqlite;

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

  const store: DoReconciliationStore = {
    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const dueAt = canonicalizeIsoTimestamp(input.dueAt, "dueAt");
        const inserted = ctx.getExecutor().query<Record<string, unknown>>(
          `INSERT INTO ${table} (
             key, status, subject_id, reason, due_at,
             attempts, generation, created_at, updated_at
           ) VALUES (
             ?, 'scheduled', ?, ?, ?,
             0, 0, ?, ?
           )
           ON CONFLICT (key) DO UPDATE SET
             status = 'scheduled',
             subject_id = excluded.subject_id,
             reason = excluded.reason,
             due_at = excluded.due_at,
             attempts = 0,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error_sanitized = NULL,
             completed_at = NULL,
             updated_at = excluded.updated_at
           WHERE status IN ('completed', 'failed', 'manual_review')
           RETURNING ${RECON_SELECT_COLS}`,
          [input.key, input.subjectId, input.reason, dueAt, now, now],
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
        const exec = ctx.getExecutor();

        const claimed = exec.query<Record<string, unknown>>(
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
        const miss = classifyReconciliationClaimMiss(existing, ctx.clock.nowMs());
        if (miss !== "claimable") {
          return claimMissToResult(miss, existing);
        }

        // SQL-1/SQL-2: free due work; repair non-canonical TEXT timestamps and
        // retry once. Free-lease fence so concurrent winners' active
        // lease_expires_at cannot be wiped by a stale SELECT snapshot.
        const dueAtZ = canonicalizeIsoTimestamp(existing!.dueAt, "dueAt");
        const leaseZ =
          canonicalizeOptionalIsoTimestamp(existing!.leaseExpiresAt, "leaseExpiresAt") ??
          null;
        // params: dueAt, leaseExpiresAt, key, now
        exec.run(repairTpl.sql, [dueAtZ, leaseZ, input.key, now]);

        const retried = exec.query<Record<string, unknown>>(
          claimTpl,
          [input.owner, leaseToken, leaseExpiresAt, now, input.key, now, now],
        );
        if (retried.length > 0) {
          const record = mapReconciliationRow(retried[0]!);
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
        // RECON-LEASE-1: matching token on claimed is enough (accept after lease expiry).
        const statusTarget = input.retryAt !== undefined ? "scheduled" : "failed";
        const dueAt =
          input.retryAt !== undefined
            ? canonicalizeIsoTimestamp(input.retryAt, "retryAt")
            : now;
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `${failTpl.sql}
RETURNING key, status, generation`,
          [
            statusTarget,
            statusTarget,
            dueAt,
            lastError,
            now,
            input.key,
            input.leaseToken,
          ],
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

        // RECON-LEASE-1: matching token on claimed (allowed after expiry).
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `${reviewTpl.sql}
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
        // STORES-3 / SQL-2: TEXT lexical due_at/lease compares require canonical Z now.
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Soft-release abandoned expired claims so processDue/claimDue can
        // rediscover them after worker crash. STORES-1: restore unfinished claim
        // attempt (floor 0) so crash/deploy thrash does not burn maxAttempts.
        // SQL-UPD-1 / WH-LIST-FAIL: re-check status='claimed' in the outer WHERE
        // so concurrent pollers cannot double-decrement attempts.
        ctx.getExecutor().run(
          `UPDATE ${table} SET
             status = 'scheduled',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             updated_at = ?
           WHERE status = 'claimed'
             AND key IN (
             SELECT key FROM (
               SELECT key FROM ${table}
               WHERE status = 'claimed'
                 AND lease_expires_at IS NOT NULL
                 AND lease_expires_at <= ?
               ORDER BY lease_expires_at ASC
               LIMIT ?
             )
           )`,
          [now, now, limit],
        );
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

    async peekDue(input: ListDueInput) {
      return withMappedErrors(() => {
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const rows = ctx.getExecutor().query<{ earliest: string | null }>(
          `SELECT MIN(due_at) AS earliest
           FROM ${table}
           WHERE (status = 'scheduled' AND due_at <= ?)
              OR (
                status = 'claimed'
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at <= ?
              )`,
          [now, now],
        );
        const earliest = rows[0]?.earliest;
        if (typeof earliest !== "string" || earliest.length === 0) {
          return { occupied: false };
        }
        return { occupied: true, earliest };
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() => {
        const before = canonicalizeIsoTimestamp(input.before, "before");
        // NEW-PERF-8: omit limit must not unbounded-DELETE (Redis default 1000).
        const limit = input.limit ?? DEFAULT_DELETE_EXPIRED_LIMIT;
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
          [before, limit],
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
