/**
 * Turso / libSQL WebhookInboxStore (Phase 9 lease-aware contract).
 *
 * Atomic claim via single-statement SQLite UPSERT + RETURNING.
 */

import {
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
} from "@paykernel/sql-foundation";
import type {
  ClaimWebhookInput,
  ClaimWebhookResult,
  CleanupInput,
  CleanupResult,
  CompleteWebhookInput,
  FailWebhookInput,
  ListRetryableInput,
  RenewWebhookLeaseInput,
  RenewWebhookLeaseResult,
  WebhookEventKey,
  WebhookInboxRecord,
  WebhookInboxStore,
} from "@paykernel/store-contracts";
import { StoreLeaseLostError, StoreUnavailableError } from "@paykernel/store-contracts";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { TursoStoreOptions } from "../types";
import {
  WEBHOOK_SELECT_COLS,
  mapWebhookRow,
  newLeaseToken,
  resolveStoreContext,
} from "./shared";

/**
 * Single-statement atomic claim.
 * params: key, payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now, now, now
 */
function claimSql(table: string): string {
  return `
INSERT INTO ${table} (
  key, status, payload_hash, payload_ref, lease_owner, lease_token, lease_expires_at,
  attempts, generation, available_at, created_at, updated_at
) VALUES (
  ?, 'claimed', ?, ?, ?, ?, ?, 1, 1, ?, ?, ?
)
ON CONFLICT (key) DO UPDATE SET
  status = 'claimed',
  payload_ref = COALESCE(excluded.payload_ref, ${table}.payload_ref),
  lease_owner = excluded.lease_owner,
  lease_token = excluded.lease_token,
  lease_expires_at = excluded.lease_expires_at,
  attempts = ${table}.attempts + 1,
  generation = ${table}.generation + 1,
  available_at = excluded.available_at,
  updated_at = excluded.updated_at
WHERE ${table}.payload_hash = excluded.payload_hash
  AND ${table}.status NOT IN ('completed', 'failed', 'dead_letter')
  AND (
    (
      ${table}.status = 'pending'
      AND (${table}.available_at IS NULL OR ${table}.available_at <= excluded.updated_at)
    )
    OR (
      ${table}.status = 'claimed'
      AND (
        ${table}.lease_expires_at IS NULL
        OR ${table}.lease_expires_at <= excluded.updated_at
      )
    )
  )
RETURNING ${WEBHOOK_SELECT_COLS}
`.trim();
}

export function createTursoWebhookInboxStore(
  options: TursoStoreOptions,
): WebhookInboxStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.webhookInbox, ctx.namespace);
  const claimTpl = claimSql(table);

  async function selectByKey(key: string): Promise<WebhookInboxRecord | undefined> {
    const rows = await ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${WEBHOOK_SELECT_COLS}
       FROM ${table}
       WHERE key = ?`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapWebhookRow(row);
  }

  const store: WebhookInboxStore = {
    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const payloadRef = input.payloadRef ?? null;

        const claimed = await ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl,
          [
            input.key,
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
            now,
          ],
        );

        if (claimed.length > 0) {
          const record = mapWebhookRow(claimed[0]!);
          return {
            kind: "acquired",
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const existing = await selectByKey(input.key);
        if (!existing) {
          throw new StoreUnavailableError("webhook claim: no row after claim attempt");
        }
        if (existing.payloadHash !== input.payloadHash) {
          return { kind: "payload_hash_conflict", record: existing };
        }
        if (existing.status === "completed") {
          return { kind: "already_completed", record: existing };
        }
        if (existing.status === "failed" || existing.status === "dead_letter") {
          return { kind: "duplicate_failed", record: existing };
        }
        // pending + failed claim SQL = available_at gate (do not burn attempts)
        if (existing.status === "pending") {
          return {
            kind: "not_available",
            record: existing,
            availableAt: existing.availableAt,
          };
        }
        return { kind: "in_progress", record: existing };
      });
    },

    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
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
           RETURNING ${WEBHOOK_SELECT_COLS}`,
          [newToken, leaseExpiresAt, now, input.key, input.leaseToken, now],
        );

        if (rows.length > 0) {
          const record = mapWebhookRow(rows[0]!);
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

    async complete(input: CompleteWebhookInput): Promise<void> {
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

    async fail(input: FailWebhookInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const retryAfterMs = input.retryAfterMs ?? 0;
        const availableAt = clockAddMsIso(ctx.clock, retryAfterMs);
        const dead = input.deadLetter === true;
        const statusTarget = dead ? "dead_letter" : "pending";
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        const restoreAttemptFlag = input.restoreAttempt === true ? 1 : 0;
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = ?,
             last_error_sanitized = ?,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             available_at = ?,
             updated_at = ?,
             attempts = CASE WHEN ? = 1 AND attempts > 0 THEN attempts - 1 ELSE attempts END
           WHERE key = ?
             AND lease_token = ?
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?
           RETURNING key, status, generation`,
          [
            statusTarget,
            lastError,
            availableAt,
            now,
            restoreAttemptFlag,
            input.key,
            input.leaseToken,
            now,
          ],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "fail: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        await ctx.getExecutor().execute(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             available_at = ?,
             updated_at = ?
           WHERE key = ?
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`,
          [now, now, key, now],
        );
        return selectByKey(key);
      });
    },

    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      return withMappedErrors(async () => {
        const now = input.now ?? clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Soft-release abandoned expired claims so processRetryable can drain them.
        await ctx.getExecutor().execute(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             available_at = ?,
             updated_at = ?
           WHERE status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?`,
          [now, now, now],
        );
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT ${WEBHOOK_SELECT_COLS}
           FROM ${table}
           WHERE status = 'pending'
             AND available_at <= ?
           ORDER BY available_at ASC
           LIMIT ?`,
          [now, limit],
        );
        return rows.map(mapWebhookRow);
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
               WHERE status IN ('completed', 'dead_letter')
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
           WHERE status IN ('completed', 'dead_letter')
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
