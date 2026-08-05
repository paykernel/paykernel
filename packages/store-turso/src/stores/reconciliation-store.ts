/**
 * Turso / libSQL ReconciliationStore (Phase 9 lease-aware contract).
 *
 * Claim: single conditional UPDATE … RETURNING (row must exist via schedule).
 */

import {
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyReconciliationClaimMiss,
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
import type { TursoStoreOptions } from "../types";
import {
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

export function createTursoReconciliationStore(
  options: TursoStoreOptions,
): ReconciliationStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.reconciliationJobs, ctx.namespace);
  const claimTpl = claimSql(table);
  const repairTpl = reconciliationTimestampRepairTemplates(ctx.namespace).sqlite;

  async function selectByKey(
    key: string,
  ): Promise<ReconciliationRecord | undefined> {
    const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const dueAt = canonicalizeIsoTimestamp(input.dueAt, "dueAt");
        // Insert-if-absent; RETURNING only on insert.
        const inserted = await ctx.getExecutor().query<Record<string, unknown>>(
          `INSERT INTO ${table} (
             key, status, subject_id, reason, due_at,
             attempts, generation, created_at, updated_at
           ) VALUES (
             ?, 'scheduled', ?, ?, ?,
             0, 0, ?, ?
           )
           ON CONFLICT (key) DO NOTHING
           RETURNING ${RECON_SELECT_COLS}`,
          [input.key, input.subjectId, input.reason, dueAt, now, now],
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
        const exec = ctx.getExecutor();

        const claimed = await exec.query<Record<string, unknown>>(
          claimTpl,
          [input.owner, leaseToken, leaseExpiresAt, now, input.key, now, now],
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
        await exec.execute(repairTpl.sql, [dueAtZ, leaseZ, input.key, now]);

        const retried = await exec.query<Record<string, unknown>>(
          claimTpl,
          [input.owner, leaseToken, leaseExpiresAt, now, input.key, now, now],
        );
        if (retried.length > 0) {
          const record = mapReconciliationRow(retried[0]!);
          return {
            kind: "acquired",
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const after = await selectByKey(input.key);
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
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const newToken = newLeaseToken();

        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        if (input.retryAt !== undefined) {
          const retryAt = canonicalizeIsoTimestamp(input.retryAt, "retryAt");
          const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
            [retryAt, lastError, now, input.key, input.leaseToken, now],
          );
          if (rows.length === 0) {
            throw new StoreLeaseLostError(
              "fail: lease token rejected or key not found",
            );
          }
          return;
        }

        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const note =
          input.note !== undefined
            ? enforceMaxSanitizedError(input.note) ?? null
            : null;

        // Active-lease fence (parity with complete/fail).
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
             AND lease_expires_at > ?
           RETURNING key, status, generation`,
          [note, now, input.key, input.leaseToken, now],
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
        // SQL-2: TEXT lexical due_at/lease compares require canonical Z now.
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Soft-release abandoned expired claims so processDue/claimDue can
        // rediscover them after worker crash. STORES-1: restore unfinished claim
        // attempt (floor 0) so crash/deploy thrash does not burn maxAttempts.
        await ctx.getExecutor().execute(
          `UPDATE ${table} SET
             status = 'scheduled',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             updated_at = ?
           WHERE status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`,
          [now, now],
        );
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
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
      return withMappedErrors(async () => {
        const limit = input.limit;
        if (limit !== undefined) {
          const rows = await ctx.getExecutor().query<{ key: string }>(
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
        const rows = await ctx.getExecutor().query<{ key: string }>(
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
