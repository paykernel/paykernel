/**
 * SQLite WebhookInboxStore (Phase 9 lease-aware contract).
 *
 * Atomic claim: BEGIN IMMEDIATE + INSERT OR IGNORE + conditional UPDATE
 * inside one synchronous transaction.
 */

import {
  webhookClaimTemplates,
  webhookCompleteTemplates,
  webhookFailTemplates,
  webhookTimestampRepairTemplates,
  classifyWebhookClaimMiss,
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
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
import type { SqliteStoreOptions } from "../types";
import {
  DEFAULT_DELETE_EXPIRED_LIMIT,
  extractSqliteSteps,
  mapWebhookRow,
  newLeaseToken,
  resolveStoreContext,
} from "./shared";

const SELECT_COLS = `key, status, payload_hash, payload_ref, gateway, provider_event_id,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              available_at, first_received_at, last_received_at, completed_at,
              last_error_sanitized, tenant_id, created_at, updated_at`;

function webhookMissToResult(
  kind: Exclude<ReturnType<typeof classifyWebhookClaimMiss>, "claimable">,
  existing: WebhookInboxRecord,
): ClaimWebhookResult {
  if (kind === "not_available") {
    return {
      kind: "not_available" as const,
      record: existing,
      availableAt: existing.availableAt,
    };
  }
  return { kind, record: existing };
}

export function createSqliteWebhookInboxStore(
  options: SqliteStoreOptions,
): WebhookInboxStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.webhookInbox, ctx.namespace);
  const claimTpl = webhookClaimTemplates(ctx.namespace).sqlite;
  const completeTpl = webhookCompleteTemplates(ctx.namespace).sqlite;
  const failTpl = webhookFailTemplates(ctx.namespace).sqlite;
  const repairTpl = webhookTimestampRepairTemplates(ctx.namespace).sqlite;
  const claimSteps = extractSqliteSteps(claimTpl.sql);
  const insertSql = claimSteps[0]!;
  const updateSql = claimSteps[1]!;

  function selectByKey(key: string): WebhookInboxRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${SELECT_COLS}
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
      return withMappedErrors(() => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const payloadRef = input.payloadRef ?? null;
        const exec = ctx.getExecutor();

        return exec.transaction(() => {
          // step1: INSERT OR IGNORE
          // bind: key, payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now, now, now
          const inserted = exec.run(insertSql, [
            input.key,
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
            now,
          ]);

          if (inserted.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "webhook claim: insert succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          // step2: conditional reclaim / hash supersede
          // bind: payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now, now, key, now, payloadHash, now
          const reclaimed = exec.run(updateSql, [
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
            input.key,
            now,
            input.payloadHash,
            now,
          ]);

          if (reclaimed.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "webhook claim: update succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          const existing = selectByKey(input.key);
          if (!existing) {
            throw new StoreUnavailableError(
              "webhook claim: no row after claim attempt",
            );
          }
          // STORES-4: Date.parse classification — never freeze free due work as
          // permanent not_available under lexical TEXT available_at mismatch.
          const miss = classifyWebhookClaimMiss(
            {
              status: existing.status,
              payloadHash: existing.payloadHash,
              leaseExpiresAt: existing.leaseExpiresAt,
              availableAt: existing.availableAt,
            },
            input.payloadHash,
            ctx.clock.nowMs(),
          );
          if (miss !== "claimable") {
            return webhookMissToResult(miss, existing);
          }

          const availableAtZ = canonicalizeIsoTimestamp(
            existing.availableAt,
            "availableAt",
          );
          const leaseZ =
            canonicalizeOptionalIsoTimestamp(existing.leaseExpiresAt, "leaseExpiresAt") ??
            null;
          // params: availableAt, leaseExpiresAt, key, now
          exec.run(repairTpl.sql, [availableAtZ, leaseZ, input.key, now]);

          const retried = exec.run(updateSql, [
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
            input.key,
            now,
            input.payloadHash,
            now,
          ]);
          if (retried.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "webhook claim: update succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          const after = selectByKey(input.key);
          if (!after) {
            throw new StoreUnavailableError(
              "webhook claim: no row after timestamp repair",
            );
          }
          const miss2 = classifyWebhookClaimMiss(
            {
              status: after.status,
              payloadHash: after.payloadHash,
              leaseExpiresAt: after.leaseExpiresAt,
              availableAt: after.availableAt,
            },
            input.payloadHash,
            ctx.clock.nowMs(),
          );
          if (miss2 === "claimable") {
            throw new StoreUnavailableError(
              "webhook claim: free due work failed after timestamp canonicalize; retry",
            );
          }
          return webhookMissToResult(miss2, after);
        }, { mode: "immediate" });
      });
    },

    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
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

    async complete(input: CompleteWebhookInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        // params: now, now, key, leaseToken, now
        const result = ctx.getExecutor().run(completeTpl.sql, [
          now,
          now,
          input.key,
          input.leaseToken,
          now,
        ]);
        if (result.changes === 0) {
          throw new StoreLeaseLostError(
            "complete: lease token rejected or key not found",
          );
        }
      });
    },

    async fail(input: FailWebhookInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const retryAfterMs = input.retryAfterMs ?? 0;
        const availableAt = clockAddMsIso(ctx.clock, retryAfterMs);
        const dead = input.deadLetter === true;
        const statusTarget = dead ? "dead_letter" : "pending";
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        // params: statusTarget, lastError, availableAt, now, restoreAttemptFlag, key, leaseToken
        // WEBHOOKS-2: template matches token on claimed (no lease_expires_at > now).
        const restoreAttemptFlag = input.restoreAttempt === true ? 1 : 0;
        const result = ctx.getExecutor().run(failTpl.sql, [
          statusTarget,
          lastError,
          availableAt,
          now,
          restoreAttemptFlag,
          input.key,
          input.leaseToken,
        ]);
        if (result.changes === 0) {
          throw new StoreLeaseLostError(
            "fail: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      return withMappedErrors(() => {
        // WEBHOOKS-1: restore unfinished claim attempt on expired-lease soft-release.
        const now = clockNowIso(ctx.clock);
        ctx.getExecutor().run(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
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
      return withMappedErrors(() => {
        // STORES-2 / SQL-2: TEXT lexical available_at compares require canonical Z now.
        // Non-Z input.now written into available_at on soft-release would break ordering.
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Soft-release abandoned expired claims so processRetryable can drain them.
        // WEBHOOKS-1: restore unfinished claim attempt (floor 0).
        // SQL-UPD-1 / WH-LIST-FAIL: re-check status='claimed' in the outer WHERE
        // so concurrent pollers cannot double-decrement attempts.
        ctx.getExecutor().run(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             available_at = ?,
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
          [now, now, now, limit],
        );
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT ${SELECT_COLS}
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
      return withMappedErrors(() => {
        const before = canonicalizeIsoTimestamp(input.before, "before");
        // NEW-PERF-8: omit limit must not unbounded-DELETE (Redis default 1000).
        const limit = input.limit ?? DEFAULT_DELETE_EXPIRED_LIMIT;
        const result = ctx.getExecutor().run(
          `DELETE FROM ${table}
           WHERE key IN (
             SELECT key FROM ${table}
             WHERE status IN ('completed', 'dead_letter')
               AND updated_at <= ?
             ORDER BY updated_at ASC
             LIMIT ?
           )`,
          [before, limit],
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
