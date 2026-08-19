/**
 * Cloudflare DO WebhookInboxStore (Phase 9 lease-aware contract).
 *
 * Atomic claim via single-statement SQLite UPSERT + RETURNING (sync sql.exec).
 */

import {
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyWebhookClaimMiss,
  webhookTimestampRepairTemplates,
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
import type { ShardOccupancyHint } from "../occupancy";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { DoStoreOptions } from "../types";
import {
  DEFAULT_DELETE_EXPIRED_LIMIT,
  WEBHOOK_SELECT_COLS,
  mapWebhookRow,
  newLeaseToken,
  resolveStoreContext,
} from "./shared";

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

/**
 * Single-statement atomic claim.
 * params: key, payloadHash, payloadRef, owner, leaseToken, leaseExpiresAt, now, now, now, ifMatch, ifMatch
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
  payload_hash = excluded.payload_hash,
  payload_ref = COALESCE(excluded.payload_ref, ${table}.payload_ref),
  lease_owner = excluded.lease_owner,
  lease_token = excluded.lease_token,
  lease_expires_at = excluded.lease_expires_at,
  -- WEBHOOKS-1: pending handler retry burns an attempt; expired claimed reclaim does not
  attempts = CASE
    WHEN ${table}.status = 'claimed' THEN ${table}.attempts
    ELSE ${table}.attempts + 1
  END,
  generation = ${table}.generation + 1,
  available_at = excluded.available_at,
  updated_at = excluded.updated_at
WHERE ${table}.status NOT IN ('completed', 'failed', 'dead_letter')
  AND (
    (
      ${table}.status = 'pending'
      AND (
        ${table}.available_at IS NULL
        OR ${table}.available_at <= excluded.updated_at
        OR ${table}.payload_hash != excluded.payload_hash
      )
    )
    OR (
      ${table}.status = 'claimed'
      AND (
        ${table}.lease_expires_at IS NULL
        OR ${table}.lease_expires_at <= excluded.updated_at
      )
    )
  )
  AND (? IS NULL OR ${table}.payload_hash = ?)
RETURNING ${WEBHOOK_SELECT_COLS}
`.trim();
}

type DoWebhookInboxStore = WebhookInboxStore & {
  /**
   * PERF-5: cheap occupancy probe. Occupied when this shard has pending-available
   * work **or** expired claimed rows (listRetryable will soft-release those).
   * `earliest` is MIN(available_at) of those rows. Read-only — does not mutate leases.
   */
  peekRetryable(input: ListRetryableInput): Promise<ShardOccupancyHint>;
};

export function createDoWebhookInboxStore(
  options: DoStoreOptions,
): DoWebhookInboxStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.webhookInbox, ctx.namespace);
  const claimTpl = claimSql(table);
  const repairTpl = webhookTimestampRepairTemplates(ctx.namespace).sqlite;

  function selectByKey(key: string): WebhookInboxRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${WEBHOOK_SELECT_COLS}
       FROM ${table}
       WHERE key = ?`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapWebhookRow(row);
  }

  const store: DoWebhookInboxStore = {
    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      return withMappedErrors(() => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const payloadRef = input.payloadRef ?? null;
        const ifMatch = input.ifMatchPayloadHash ?? null;
        const claimParams = [
          input.key,
          input.payloadHash,
          payloadRef,
          input.owner,
          leaseToken,
          leaseExpiresAt,
          now,
          now,
          now,
          ifMatch,
          ifMatch,
        ] as const;

        const claimed = ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl,
          [...claimParams],
        );

        if (claimed.length > 0) {
          const record = mapWebhookRow(claimed[0]!);
          return {
            kind: "acquired" as const,
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const existing = selectByKey(input.key);
        if (!existing) {
          throw new StoreUnavailableError("webhook claim: no row after claim attempt");
        }
        // STORES-4: never freeze free due work as permanent not_available.
        const miss = classifyWebhookClaimMiss(
          {
            status: existing.status,
            payloadHash: existing.payloadHash,
            leaseExpiresAt: existing.leaseExpiresAt,
            availableAt: existing.availableAt,
          },
          input.payloadHash,
          ctx.clock.nowMs(),
          input.ifMatchPayloadHash,
        );
        if (miss !== "claimable") {
          return webhookMissToResult(miss, existing);
        }

        const availableAtZ = canonicalizeIsoTimestamp(existing.availableAt, "availableAt");
        const leaseZ =
          canonicalizeOptionalIsoTimestamp(existing.leaseExpiresAt, "leaseExpiresAt") ??
          null;
        ctx.getExecutor().run(repairTpl.sql, [availableAtZ, leaseZ, input.key, now]);

        const retried = ctx.getExecutor().query<Record<string, unknown>>(
          claimTpl,
          [...claimParams],
        );
        if (retried.length > 0) {
          const record = mapWebhookRow(retried[0]!);
          return {
            kind: "acquired" as const,
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        const after = selectByKey(input.key);
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
          input.ifMatchPayloadHash,
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
           RETURNING ${WEBHOOK_SELECT_COLS}`,
          [newToken, leaseExpiresAt, now, input.key, input.leaseToken, now],
        );

        if (rows.length > 0) {
          const record = mapWebhookRow(rows[0]!);
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

    async complete(input: CompleteWebhookInput): Promise<void> {
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

    async fail(input: FailWebhookInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const retryAfterMs = input.retryAfterMs ?? 0;
        const availableAt = clockAddMsIso(ctx.clock, retryAfterMs);
        const dead = input.deadLetter === true;
        const statusTarget = dead ? "dead_letter" : "pending";
        const lastError = enforceMaxSanitizedError(input.error) ?? "";

        // WEBHOOKS-2: matching token on claimed is enough (accept after lease expiry).
        const restoreAttemptFlag = input.restoreAttempt === true ? 1 : 0;
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
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
           RETURNING key, status, generation`,
          [
            statusTarget,
            lastError,
            availableAt,
            now,
            restoreAttemptFlag,
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

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      // S19-CLOCK-LEASE: get is read-only. A host clock ahead of the issuer
      // must not UPDATE/clear lease_token. Soft-release on listRetryable/claim.
      return withMappedErrors(() => selectByKey(key));
    },

    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      return withMappedErrors(() => {
        // S20-LIST-NOW: wipe expired leases only with the isolate clock that
        // issued them. Worker-supplied now can be ahead and would steal a
        // still-valid isolate lease. Canonical caller now is the available_at
        // filter only (FakeClock).
        const storeNow = clockNowIso(ctx.clock);
        const listNow =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : storeNow;
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
          [storeNow, storeNow, storeNow, limit],
        );
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `SELECT ${WEBHOOK_SELECT_COLS}
           FROM ${table}
           WHERE status = 'pending'
             AND available_at <= ?
           ORDER BY available_at ASC
           LIMIT ?`,
          [listNow, limit],
        );
        return rows.map(mapWebhookRow);
      });
    },

    async peekRetryable(input: ListRetryableInput) {
      return withMappedErrors(() => {
        const now =
          input.now !== undefined
            ? canonicalizeIsoTimestamp(input.now, "now")
            : clockNowIso(ctx.clock);
        const rows = ctx.getExecutor().query<{ earliest: string | null }>(
          `SELECT MIN(available_at) AS earliest
           FROM ${table}
           WHERE (status = 'pending' AND available_at <= ?)
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
             WHERE status IN ('completed', 'dead_letter')
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
