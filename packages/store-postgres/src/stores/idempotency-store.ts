/**
 * PostgreSQL IdempotencyStore (Phase 9 lease-aware contract).
 *
 * Atomic reserve via sql-store postgres templates (INSERT ON CONFLICT … RETURNING).
 * Mutators use conditional UPDATE WHERE lease_token = $n.
 */

import {
  idempotencyCompleteTemplates,
  idempotencyReserveTemplates,
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
import type { PostgresStoreOptions } from "../types";
import {
  mapIdempotencyRow,
  newLeaseToken,
  resolveStoreContext,
  serializeResultJson,
} from "./shared";

export function createPostgresIdempotencyStore(
  options: PostgresStoreOptions,
): IdempotencyStore {
  const ctx = resolveStoreContext(options);
  const table = resolveTableName(LOGICAL_TABLES.idempotency, ctx.namespace);
  const reserveTpl = idempotencyReserveTemplates(ctx.namespace).postgres;
  const completeTpl = idempotencyCompleteTemplates(ctx.namespace).postgres;

  async function selectByKey(key: string): Promise<IdempotencyRecord | undefined> {
    const rows = await ctx.getExecutor().query<Record<string, unknown>>(
      `SELECT key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
              attempts, generation, created_at, updated_at, result_json,
              completed_at, indeterminate_at, error_sanitized, tenant_id
       FROM ${table}
       WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return mapIdempotencyRow(row);
  }

  const store: IdempotencyStore = {
    async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const now = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);

        // Atomic single-statement claim (sql-store postgres template).
        // params: key, fingerprint, owner, leaseToken, leaseExpiresAt, now
        const claimed = await ctx.getExecutor().query<Record<string, unknown>>(
          reserveTpl.sql,
          [
            input.key,
            input.fingerprint,
            input.owner,
            leaseToken,
            leaseExpiresAt,
            now,
          ],
        );

        if (claimed.length > 0) {
          const record = mapIdempotencyRow(claimed[0]!);
          return {
            kind: "acquired",
            record,
            leaseToken: record.leaseToken ?? leaseToken,
          };
        }

        // No row returned: classify without claiming (read-only path).
        const existing = await selectByKey(input.key);
        if (!existing) {
          // Unexpected: claim mutated nothing and key is absent (not a lease fence).
          throw new StoreUnavailableError(
            "idempotency reserve: no row after claim attempt",
          );
        }
        if (existing.fingerprint !== input.fingerprint) {
          return { kind: "fingerprint_conflict", record: existing };
        }
        if (existing.status === "completed") {
          return { kind: "already_completed", record: existing };
        }
        if (existing.status === "indeterminate") {
          return { kind: "indeterminate", record: existing };
        }
        return { kind: "in_progress", record: existing };
      });
    },

    async renew(
      input: RenewIdempotencyReservationInput,
    ): Promise<RenewReservationResult> {
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
             AND status = 'reserved'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > $4
           RETURNING key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
                     attempts, generation, created_at, updated_at, result_json,
                     completed_at, indeterminate_at, error_sanitized, tenant_id`,
          [input.key, newToken, leaseExpiresAt, now, input.leaseToken],
        );

        if (rows.length > 0) {
          const record = mapIdempotencyRow(rows[0]!);
          return {
            ok: true,
            record,
            leaseToken: record.leaseToken ?? newToken,
          };
        }

        const existing = await selectByKey(input.key);
        if (!existing) return { ok: false, reason: "not_found" };
        if (existing.status !== "reserved") {
          return { ok: false, reason: "wrong_status" };
        }
        return { ok: false, reason: "lease_lost" };
      });
    },

    async complete(input: CompleteIdempotencyInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const resultJson = serializeResultJson(input.result);
        // params: key, leaseToken, resultJson, now
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          completeTpl.sql,
          [input.key, input.leaseToken, resultJson, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError("complete: lease token rejected or key not found");
        }
      });
    },

    async markIndeterminate(input: MarkIndeterminateInput): Promise<void> {
      return withMappedErrors(async () => {
        const now = clockNowIso(ctx.clock);
        const reason =
          input.reason !== undefined
            ? enforceMaxSanitizedError(input.reason)
            : undefined;
        const resultJson =
          reason !== undefined ? serializeResultJson({ reason }) : null;

        // Token + reserved status (parity with memory: no strict active-lease
        // gate so a worker can still park indeterminate near expiry).
        const rows = await ctx.getExecutor().query<Record<string, unknown>>(
          `UPDATE ${table} SET
             status = 'indeterminate',
             result_json = COALESCE($3, result_json),
             error_sanitized = $4,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             indeterminate_at = $5,
             updated_at = $5
           WHERE key = $1
             AND lease_token = $2
             AND status = 'reserved'
           RETURNING key, status, generation`,
          [input.key, input.leaseToken, resultJson, reason ?? null, now],
        );
        if (rows.length === 0) {
          throw new StoreLeaseLostError(
            "markIndeterminate: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
      return withMappedErrors(async () => selectByKey(key));
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        const limit = input.limit;
        // A4: never delete indeterminate by default.
        // Delete completed/expired rows with updated_at <= before.
        if (limit !== undefined) {
          const rows = await ctx.getExecutor().query<{ key: string }>(
            `DELETE FROM ${table}
             WHERE key IN (
               SELECT key FROM ${table}
               WHERE status IN ('completed', 'expired')
                 AND updated_at <= $1
               ORDER BY updated_at ASC
               LIMIT $2
             )
             RETURNING key`,
            [input.before, limit],
          );
          return { deleted: rows.length };
        }
        const rows = await ctx.getExecutor().query<{ key: string }>(
          `DELETE FROM ${table}
           WHERE status IN ('completed', 'expired')
             AND updated_at <= $1
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
