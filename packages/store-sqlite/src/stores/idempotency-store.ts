/**
 * SQLite IdempotencyStore (Phase 9 lease-aware contract).
 *
 * Atomic reserve: BEGIN IMMEDIATE + INSERT OR IGNORE + conditional UPDATE
 * (sql-store sqlite templates) inside one synchronous transaction.
 * Mutators use conditional UPDATE WHERE lease_token = ?.
 */

import {
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyIdempotencyReserveMiss,
  idempotencyCompleteTemplates,
  idempotencyReserveTemplates,
  idempotencyTimestampRepairTemplates,
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
  DEFAULT_DELETE_EXPIRED_LIMIT,
  extractSqliteSteps,
  mapIdempotencyRow,
  newLeaseToken,
  resolveStoreContext,
  serializeResultJson,
} from "./shared";

const SELECT_COLS = `key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
              attempts, generation, created_at, updated_at, result_json,
              completed_at, indeterminate_at, error_sanitized, tenant_id`;

function reserveMissToResult(
  kind: Exclude<ReturnType<typeof classifyIdempotencyReserveMiss>, "claimable">,
  existing: IdempotencyRecord,
): IdempotencyReservation {
  return { kind, record: existing };
}

export function createSqliteIdempotencyStore(
  options: SqliteStoreOptions,
): IdempotencyStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.idempotency, ctx.namespace);
  const reserveTpl = idempotencyReserveTemplates(ctx.namespace).sqlite;
  const completeTpl = idempotencyCompleteTemplates(ctx.namespace).sqlite;
  const repairTpl = idempotencyTimestampRepairTemplates(ctx.namespace).sqlite;
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
          // P11-IDEM-1: completed / indeterminate before fingerprint_conflict.
          const existing = selectByKey(input.key);
          if (!existing) {
            throw new StoreUnavailableError(
              "idempotency reserve: no row after claim attempt",
            );
          }
          const miss = classifyIdempotencyReserveMiss(
            {
              status: existing.status,
              fingerprint: existing.fingerprint,
              leaseExpiresAt: existing.leaseExpiresAt,
            },
            input.fingerprint,
            ctx.clock.nowMs(),
          );
          if (miss !== "claimable") {
            return reserveMissToResult(miss, existing);
          }

          // P11-IDEM-2: free expired reserved work; canonicalize lease and retry once.
          const leaseZ =
            canonicalizeOptionalIsoTimestamp(existing.leaseExpiresAt, "leaseExpiresAt") ??
            null;
          // params: leaseExpiresAt, key, now, oldLeaseExpiresAt (snapshot CAS)
          exec.run(repairTpl.sql, [
            leaseZ,
            input.key,
            now,
            existing.leaseExpiresAt ?? null,
          ]);

          const retried = exec.run(updateSql, [
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
            input.key,
            input.fingerprint,
            now,
          ]);
          if (retried.changes === 1) {
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

          const after = selectByKey(input.key);
          if (!after) {
            throw new StoreUnavailableError(
              "idempotency reserve: no row after timestamp repair",
            );
          }
          const miss2 = classifyIdempotencyReserveMiss(
            {
              status: after.status,
              fingerprint: after.fingerprint,
              leaseExpiresAt: after.leaseExpiresAt,
            },
            input.fingerprint,
            ctx.clock.nowMs(),
          );
          if (miss2 === "claimable") {
            throw new StoreUnavailableError(
              "idempotency reserve: free expired work failed after timestamp canonicalize; retry",
            );
          }
          return reserveMissToResult(miss2, after);
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
        // NEW-PERF-9: omit limit must not unbounded-DELETE (webhook/recon NEW-PERF-8).
        const limit = input.limit ?? DEFAULT_DELETE_EXPIRED_LIMIT;
        const exec = ctx.getExecutor();
        // P11-DEL-1: TEXT lexical updated_at compares require canonical Z before.
        const before = canonicalizeIsoTimestamp(input.before, "before");
        // A4: never delete indeterminate by default.
        const result = exec.run(
          `DELETE FROM ${table}
           WHERE key IN (
             SELECT key FROM ${table}
             WHERE status IN ('completed', 'expired')
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
