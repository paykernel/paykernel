/**
 * SQLite IdempotencyStore (Phase 9 lease-aware contract).
 *
 * Atomic reserve: BEGIN IMMEDIATE + INSERT OR IGNORE + conditional UPDATE
 * (sql-store sqlite templates) inside one synchronous transaction.
 * Mutators use conditional UPDATE WHERE lease_token = ?.
 */

import {
  idempotencyCompleteTemplates,
  idempotencyReserveTemplates,
  resolveTableName,
  LOGICAL_TABLES,
  enforceMaxSanitizedError,
} from "@paykernel/sql-foundation";
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
} from "@paykernel/store-contracts";
import { StoreLeaseLostError, StoreUnavailableError } from "@paykernel/store-contracts";
import { clockAddMsIso, clockNowIso } from "../clock";
import { withMappedErrors, withMappedTransaction } from "../errors";
import type { SqliteStoreOptions } from "../types";
import {
  extractSqliteSteps,
  mapIdempotencyRow,
  newLeaseToken,
  resolveStoreContext,
  serializeResultJson,
} from "./shared";

const SELECT_COLS = `key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
              attempts, generation, created_at, updated_at, result_json,
              completed_at, indeterminate_at, error_sanitized, tenant_id`;

export function createSqliteIdempotencyStore(
  options: SqliteStoreOptions,
): IdempotencyStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.idempotency, ctx.namespace);
  const reserveTpl = idempotencyReserveTemplates(ctx.namespace).sqlite;
  const completeTpl = idempotencyCompleteTemplates(ctx.namespace).sqlite;
  const reserveSteps = extractSqliteSteps(reserveTpl.sql);
  const insertSql = reserveSteps[0]!;
  const updateSql = reserveSteps[1]!;

  function selectByKey(key: string): IdempotencyRecord | undefined {
    const rows = ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT ${SELECT_COLS}
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
        const exec = ctx.getExecutor();

        return exec.transaction(() => {
          // step1: INSERT OR IGNORE
          // bind: key, fingerprint, owner, leaseToken, leaseExpiresAt, now, now
          const inserted = exec.run(insertSql, [
            input.key,
            input.fingerprint,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            now,
          ]);

          if (inserted.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "idempotency reserve: insert succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          // step2: conditional reclaim UPDATE
          // bind: owner, leaseToken, leaseExpiresAt, now, key, fingerprint, now
          const reclaimed = exec.run(updateSql, [
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            input.key,
            input.fingerprint,
            now,
          ]);

          if (reclaimed.changes === 1) {
            const record = selectByKey(input.key);
            if (!record) {
              throw new StoreUnavailableError(
                "idempotency reserve: update succeeded but row missing",
              );
            }
            return {
              kind: "acquired" as const,
              record,
              leaseToken: record.leaseToken ?? leaseToken,
            };
          }

          // Classify without claiming (still inside IMMEDIATE txn for consistency).
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
        }, { mode: "immediate" });
      });
    },

    async renew(
      input: RenewIdempotencyReservationInput,
    ): Promise<RenewReservationResult> {
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
               AND status = 'reserved'
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
          if (existing.status !== "reserved") {
            return { ok: false as const, reason: "wrong_status" as const };
          }
          return { ok: false as const, reason: "lease_lost" as const };
        }, { mode: "immediate" });
      });
    },

    async complete(input: CompleteIdempotencyInput): Promise<void> {
      return withMappedErrors(() => {
        const now = clockNowIso(ctx.clock);
        const resultJson = serializeResultJson(input.result);
        // params: resultJson, now, now, key, leaseToken, now
        const result = ctx.getExecutor().run(completeTpl.sql, [
          resultJson,
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
        const result = ctx.getExecutor().run(
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
             AND status = 'reserved'`,
          [resultJson, reason ?? null, now, now, input.key, input.leaseToken],
        );
        if (result.changes === 0) {
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
        const exec = ctx.getExecutor();
        // A4: never delete indeterminate by default.
        if (limit !== undefined) {
          const result = exec.run(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'expired')
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
           WHERE status IN ('completed', 'expired')
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
