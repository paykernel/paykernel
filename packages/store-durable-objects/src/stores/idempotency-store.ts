/**
 * Cloudflare DO IdempotencyStore (Phase 9 lease-aware contract).
 *
 * Atomic reserve via single-statement SQLite UPSERT + RETURNING
 * (storage.sql.exec sync; cursor fully consumed before return).
 * Mutators use conditional UPDATE WHERE lease_token = ? RETURNING.
 *
 * Pattern for runtime callers:
 *   1) claim atomically  2) commit (leave txn)  3) external work  4) complete with lease token
 * NEVER await provider I/O inside transactionSync.
 */

import {
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
} from "@paykernel/internal-sql-store";
import type {
  CleanupInput,
  CleanupResult,
  CompleteIdempotencyInput,
  IdempotencyKey,
  IdempotencyRecord,
  IdempotencyReservation,
  IdempotencyStore,
  MarkIndeterminateInput,
  RenewIdempotencyReservationInput,
  RenewReservationResult,
  ReserveIdempotencyInput,
} from "@paykernel/testkit";
import { StoreLeaseLostError, StoreUnavailableError } from "@paykernel/testkit";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { DoStoreOptions } from "../types";
import {
  IDEMPOTENCY_SELECT_COLS,
  mapIdempotencyRow,
  newLeaseToken,
  resolveStoreContext,
  serializeResultJson,
} from "./shared";

/**
 * Single-statement atomic reserve (SQLite ON CONFLICT DO UPDATE WHERE + RETURNING).
 * params: key, fingerprint, owner, leaseToken, leaseExpiresAt, now, now
 */
function reserveSql(table: string): string {
  return `
INSERT INTO ${table} (
  key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
  attempts, generation, created_at, updated_at
) VALUES (
  ?, 'reserved', ?, ?, ?, ?, 1, 1, ?, ?
)
ON CONFLICT (key) DO UPDATE SET
  status = 'reserved',
  lease_owner = excluded.lease_owner,
  lease_token = excluded.lease_token,
  lease_expires_at = excluded.lease_expires_at,
  attempts = ${table}.attempts + 1,
  generation = ${table}.generation + 1,
  updated_at = excluded.updated_at
WHERE ${table}.fingerprint = excluded.fingerprint
  AND ${table}.status NOT IN ('completed', 'indeterminate')
  AND (
    ${table}.status = 'expired'
    OR ${table}.lease_expires_at IS NULL
    OR ${table}.lease_expires_at <= excluded.updated_at
  )
RETURNING ${IDEMPOTENCY_SELECT_COLS}
`.trim();
}

export function createDoIdempotencyStore(
  options: DoStoreOptions,
): IdempotencyStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.idempotency, ctx.namespace);
  const claimSql = reserveSql(table);

  function selectByKey(key: string): IdempotencyRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${IDEMPOTENCY_SELECT_COLS}
       FROM ${table}
       WHERE key = ?`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapIdempotencyRow(row);
  }

  const store: IdempotencyStore = {
    async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
      return withMappedErrors(() => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);

        // Atomic single-statement claim (engine-level UPSERT + RETURNING).
        const claimed = ctx.getExecutor().query<Record<string, unknown>>(
          claimSql,
          [
            input.key,
            input.fingerprint,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
          ],
        );

        if (claimed.length > 0) {
          const record = mapIdempotencyRow(claimed[0]!);
          return {
            kind: "acquired" as const,
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        // No row returned: classify without claiming (read-only path).
        const existing = selectByKey(input.key);
        if (!existing) {
          throw new StoreUnavailableError(
            "idempotency reserve: no row after claim attempt",
          );
        }
        if (existing.fingerprint !== input.fingerprint) {
          return { kind: "fingerprint_conflict" as const, record: existing };
        }
        if (existing.status === "completed") {
          return { kind: "already_completed" as const, record: existing };
        }
        if (existing.status === "indeterminate") {
          return { kind: "indeterminate" as const, record: existing };
        }
        return { kind: "in_progress" as const, record: existing };
      });
    },

    async renew(
      input: RenewIdempotencyReservationInput,
    ): Promise<RenewReservationResult> {
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
             AND status = 'reserved'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?
           RETURNING ${IDEMPOTENCY_SELECT_COLS}`,
          [newToken, leaseExpiresAt, now, input.key, input.leaseToken, now],
        );

        if (rows.length > 0) {
          const record = mapIdempotencyRow(rows[0]!);
          return {
            ok: true as const,
            record,
            leaseToken: record.leaseToken ?? newToken,
          };
        }

        const existing = selectByKey(input.key);
        if (!existing) return { ok: false as const, reason: "not_found" as const };
        if (existing.status !== "reserved") {
          return { ok: false as const, reason: "wrong_status" as const };
        }
        return { ok: false as const, reason: "lease_lost" as const };
      });
    },

    async complete(input: CompleteIdempotencyInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const resultJson = serializeResultJson(input.result);
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'completed',
             result_json = ?,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             completed_at = ?,
             updated_at = ?
           WHERE key = ?
             AND lease_token = ?
             AND status = 'reserved'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > ?
           RETURNING key, status, generation`,
          [resultJson, now, now, input.key, input.leaseToken, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "complete: lease token rejected or key not found",
          );
        }
      });
    },

    async markIndeterminate(input: MarkIndeterminateInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const reason =
          input.reason !== undefined
            ? enforceMaxSanitizedError(input.reason)
            : undefined;
        const resultJson =
          reason !== undefined ? serializeResultJson({ reason }) : null;

        // Token + reserved status (parity with memory: no strict active-lease gate).
        const rows = ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'indeterminate',
             result_json = COALESCE(?, result_json),
             error_sanitized = ?,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             indeterminate_at = ?,
             updated_at = ?
           WHERE key = ?
             AND lease_token = ?
             AND status = 'reserved'
           RETURNING key, status, generation`,
          [resultJson, reason ?? null, now, now, input.key, input.leaseToken],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "markIndeterminate: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
      return withMappedErrors(() => selectByKey(key));
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(() => {
        const limit = input.limit;
        // A4: never delete indeterminate by default.
        if (limit !== undefined) {
          const rows = ctx.getExecutor().query<{ key: string }>(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'expired')
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
           WHERE status IN ('completed', 'expired')
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
