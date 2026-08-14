/**
 * PostgreSQL WebhookInboxStore (Phase 9 lease-aware contract).
 */

import {
  webhookClaimTemplates,
  webhookCompleteTemplates,
  webhookFailTemplates,
  webhookTimestampRepairTemplates,
  classifyWebhookClaimMiss,
  canonicalizeOptionalIsoTimestamp,
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
  canonicalizeIsoTimestamp,
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
import type { PostgresStoreOptions } from "../types";
import { mapWebhookRow, newLeaseToken, resolveStoreContext } from "./shared";

function webhookMissToResult(
  kind: Exclude<ReturnType<typeof classifyWebhookClaimMiss>, "claimable">,
  existing: WebhookInboxRecord,
): ClaimWebhookResult {
  if (kind === "not_available") {
    return {
      kind: "not_available",
      record: existing,
      availableAt: existing.availableAt,
    };
  }
  return { kind, record: existing };
}

export function createPostgresWebhookInboxStore(
  options: PostgresStoreOptions,
): WebhookInboxStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.webhookInbox, ctx.namespace);
  const claimTpl = webhookClaimTemplates(ctx.namespace).postgres;
  const completeTpl = webhookCompleteTemplates(ctx.namespace).postgres;
  const failTpl = webhookFailTemplates(ctx.namespace).postgres;
  const repairTpl = webhookTimestampRepairTemplates(ctx.namespace).postgres;

  async function selectByKey(key: string): Promise<WebhookInboxRecord | undefined> {
    const rows = await ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT key, status, payload_hash, payload_ref, gateway, provider_event_id,
              lease_owner, lease_token, lease_expires_at, attempts, generation,
              available_at, first_received_at, last_received_at, completed_at,
              last_error_sanitized, tenant_id, created_at, updated_at
       FROM ${table}
       WHERE key = $1`,
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

        // params: key, payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now
        // Template gates pending on available_at <= now; expired claimed leases may reclaim.
        const claimed = await ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl.sql,
          [
            input.key,
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
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

        // Free due / reclaimable work; canonicalize timestamps and retry once.
        const availableAtZ = canonicalizeIsoTimestamp(existing.availableAt, "availableAt");
        const leaseZ =
          canonicalizeOptionalIsoTimestamp(existing.leaseExpiresAt, "leaseExpiresAt") ??
          null;
        // params: key, availableAt, leaseExpiresAt, now
        await ctx.getExecutor().execute(repairTpl.sql, [
          input.key,
          availableAtZ,
          leaseZ,
          now,
        ]);

        const retried = await ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl.sql,
          [
            input.key,
            input.payloadHash,
            payloadRef,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
          ],
        );
        if (retried.length > 0) {
          const record = mapWebhookRow(retried[0]!);
          return {
            kind: "acquired",
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const after = await selectByKey(input.key);
        if (!after) {
          throw new StoreUnavailableError("webhook claim: no row after timestamp repair");
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
      });
    },

    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
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
           RETURNING key, status, payload_hash, payload_ref, gateway, provider_event_id,
                     lease_owner, lease_token, lease_expires_at, attempts, generation,
                     available_at, first_received_at, last_received_at, completed_at,
                     last_error_sanitized, tenant_id, created_at, updated_at`,
          [input.key, newToken, leaseExpiresAt, now, input.leaseToken],
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
        // params: key, leaseToken, now
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          completeTpl.sql,
          [input.key, input.leaseToken, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError("complete: lease token rejected or key not found");
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

        // params: key, leaseToken, statusTarget, lastError, availableAt, now, restoreAttemptFlag
        const restoreAttemptFlag = input.restoreAttempt === true ? 1 : 0;
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          failTpl.sql,
          [
            input.key,
            input.leaseToken,
            statusTarget,
            lastError,
            availableAt,
            now,
            restoreAttemptFlag,
          ],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError("fail: lease token rejected or key not found");
        }
      });
    },

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      return withMappedErrors(async () => {
        // Soft-release abandoned expired claims so get reclaims expired leases for this key
        // (parity with memory get soft-release and Redis WEBHOOK_GET_LUA).
        // WEBHOOKS-1: restore unfinished claim attempt so crash reclaim does not burn maxAttempts.
        const now = clockNowIso(ctx.clock);
        await ctx.getExecutor().execute(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             available_at = $1,
             updated_at = $1
           WHERE key = $2
             AND status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= $1`,
          [now, key],
        );
        return selectByKey(key);
      });
    },

    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      return withMappedErrors(async () => {
        // STORES-2 / SQL-2: TEXT lexical available_at compares require canonical Z now.
        // Non-Z input.now written into available_at on soft-release would break ordering.
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Soft-release abandoned expired claims so processRetryable can drain them.
        // WEBHOOKS-1: restore unfinished claim attempt (floor 0); next claim of pending
        // re-increments so crash reclaim is net-zero vs maxAttempts handler budget.
        await ctx.getExecutor().execute(
          `UPDATE ${table} SET
             status = 'pending',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             available_at = $1,
             updated_at = $1
           WHERE status = 'claimed'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= $1`,
          [now],
        );
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT key, status, payload_hash, payload_ref, gateway, provider_event_id,
                  lease_owner, lease_token, lease_expires_at, attempts, generation,
                  available_at, first_received_at, last_received_at, completed_at,
                  last_error_sanitized, tenant_id, created_at, updated_at
           FROM ${table}
           WHERE status = 'pending'
             AND available_at <= $1
           ORDER BY available_at ASC
           LIMIT $2`,
          [now, limit],
        );
        return rows.map(mapWebhookRow);
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        const limit = input.limit;
        // P11-DEL-1: TEXT lexical updated_at compares require canonical Z before.
        const before = canonicalizeIsoTimestamp(input.before, "before");
        if (limit !== undefined) {
          const rows = await ctx.getExecutor().query<{ key: string }>(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'dead_letter')
                 AND updated_at <= $1
               ORDER BY updated_at ASC
               LIMIT $2
             )
             RETURNING key`,
            [before, limit],
          );
          return { deleted: rows.length };
        }
        const rows = await ctx.getExecutor().query<{ key: string }>(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'dead_letter')
             AND updated_at <= $1
           RETURNING key`,
          [before],
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
