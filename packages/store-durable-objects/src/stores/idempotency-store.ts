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
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  classifyIdempotencyReserveMiss,
  idempotencyTimestampRepairTemplates,
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

function reserveMissToResult(
  kind: Exclude<ReturnType<typeof classifyIdempotencyReserveMiss>, "claimable">,
  existing: IdempotencyRecord,
): IdempotencyReservation {
  return { kind, record: existing };
}

export function createDoIdempotencyStore(
  options: DoStoreOptions,
): IdempotencyStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.idempotency, ctx.namespace);
  const claimSql = reserveSql(table);
  const repairTpl = idempotencyTimestampRepairTemplates(ctx.namespace).sqlite;

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
        ctx.getExecutor().run(repairTpl.sql, [
          leaseZ,
          input.key,
          now,
          existing.leaseExpiresAt ?? null,
        ]);

        const retried = ctx.getExecutor().query<Record<string, unknown>>(
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
        if (retried.length > 0) {
          const record = mapIdempotencyRow(retried[0]!);
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
        // P11-DEL-1: TEXT lexical updated_at compares require canonical Z before.
        const before = canonicalizeIsoTimestamp(input.before, "before");
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
            [before, limit],
          );
          return { deleted: rows.length };
        }
        const rows = ctx.getExecutor().query<{ key: string }>(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'expired')
             AND updated_at <= ?
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
