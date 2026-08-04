/**
 * Redis IdempotencyStore — atomic Lua reserve/renew/complete/markIndeterminate.
 */

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
import {
  StoreCorruptedRecordError,
  StoreLeaseLostError,
} from "@paykernel/store-contracts";
import {
  clockAddMsIso,
  clockAddMsString,
  clockNowIso,
  clockNowMsString,
} from "../clock";
import { withMappedErrors } from "../errors";
import { recordKey } from "../keys";
import {
  IDEMPOTENCY_COMPLETE_LUA,
  IDEMPOTENCY_DELETE_IF_EXPIRED_LUA,
  IDEMPOTENCY_GET_LUA,
  IDEMPOTENCY_MARK_INDETERMINATE_LUA,
  IDEMPOTENCY_PACK_LEN,
  IDEMPOTENCY_RENEW_LUA,
  IDEMPOTENCY_RESERVE_LUA,
  parseIdempotencyRecord,
  parseTaggedResult,
  splitRecordAndToken,
} from "../scripts";
import type { RedisStoreOptions } from "../types";
import { enforceMaxSanitizedError } from "../limits";
import {
  newLeaseToken,
  normalizeScan,
  resolveRedisStoreContext,
  scanMatchForStore,
  serializeResultJson,
} from "./shared";

export function createRedisIdempotencyStore(
  options: RedisStoreOptions,
): IdempotencyStore {
  const ctx = resolveRedisStoreContext(options);

  function rk(key: string): string {
    return recordKey(ctx.keys, "idemp", key);
  }

  async function runGet(key: string): Promise<IdempotencyRecord | undefined> {
    const raw = await ctx.eval.eval(
      IDEMPOTENCY_GET_LUA,
      [rk(key)],
      [clockNowMsString(ctx.clock), clockNowIso(ctx.clock)],
    );
    const tagged = parseTaggedResult(raw);
    if (tagged.tag === "missing") return undefined;
    if (tagged.tag !== "ok") {
      throw new StoreCorruptedRecordError(`get: unexpected tag ${tagged.tag}`);
    }
    return parseIdempotencyRecord(tagged.fields);
  }

  const store: IdempotencyStore = {
    async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const nowMs = clockNowMsString(ctx.clock);
        const nowIso = clockNowIso(ctx.clock);
        const leaseExpiresAt = clockAddMsIso(ctx.clock, input.leaseMs);
        const leaseExpiresMs = clockAddMsString(ctx.clock, input.leaseMs);

        const raw = await ctx.eval.eval(
          IDEMPOTENCY_RESERVE_LUA,
          [rk(input.key)],
          [
            nowMs,
            nowIso,
            input.fingerprint,
            input.owner,
            leaseToken,
            String(input.leaseMs),
            leaseExpiresAt,
            leaseExpiresMs,
            input.key,
          ],
        );
        const tagged = parseTaggedResult(raw);

        if (tagged.tag === "acquired") {
          const { pack, token } = splitRecordAndToken(
            tagged.fields,
            IDEMPOTENCY_PACK_LEN,
          );
          const record = parseIdempotencyRecord(pack);
          return {
            kind: "acquired",
            record,
            leaseToken: token ?? record.leaseToken ?? leaseToken,
          };
        }

        const record = parseIdempotencyRecord(tagged.fields);
        if (tagged.tag === "fingerprint_conflict") {
          return { kind: "fingerprint_conflict", record };
        }
        if (tagged.tag === "already_completed") {
          return { kind: "already_completed", record };
        }
        if (tagged.tag === "indeterminate") {
          return { kind: "indeterminate", record };
        }
        if (tagged.tag === "in_progress") {
          return { kind: "in_progress", record };
        }
        throw new StoreCorruptedRecordError(
          `reserve: unexpected script tag ${tagged.tag}`,
        );
      });
    },

    async renew(
      input: RenewIdempotencyReservationInput,
    ): Promise<RenewReservationResult> {
      return withMappedErrors(async () => {
        const newToken = newLeaseToken();
        const raw = await ctx.eval.eval(
          IDEMPOTENCY_RENEW_LUA,
          [rk(input.key)],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            newToken,
            clockAddMsIso(ctx.clock, input.leaseMs),
            clockAddMsString(ctx.clock, input.leaseMs),
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag === "ok") {
          const { pack, token } = splitRecordAndToken(
            tagged.fields,
            IDEMPOTENCY_PACK_LEN,
          );
          const record = parseIdempotencyRecord(pack);
          return {
            ok: true,
            record,
            leaseToken: token ?? record.leaseToken ?? newToken,
          };
        }
        if (tagged.tag === "not_found") return { ok: false, reason: "not_found" };
        if (tagged.tag === "wrong_status") {
          return { ok: false, reason: "wrong_status" };
        }
        return { ok: false, reason: "lease_lost" };
      });
    },

    async complete(input: CompleteIdempotencyInput): Promise<void> {
      return withMappedErrors(async () => {
        const resultJson = serializeResultJson(input.result);
        const raw = await ctx.eval.eval(
          IDEMPOTENCY_COMPLETE_LUA,
          [rk(input.key)],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            resultJson,
            String(ctx.retentionTtlSec),
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag !== "ok") {
          throw new StoreLeaseLostError(
            "complete: lease token rejected or key not found",
          );
        }
      });
    },

    async markIndeterminate(input: MarkIndeterminateInput): Promise<void> {
      return withMappedErrors(async () => {
        const reason =
          input.reason !== undefined
            ? enforceMaxSanitizedError(input.reason)
            : undefined;
        const resultJson =
          reason !== undefined
            ? serializeResultJson({ reason })
            : "";
        const raw = await ctx.eval.eval(
          IDEMPOTENCY_MARK_INDETERMINATE_LUA,
          [rk(input.key)],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            resultJson,
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag !== "ok") {
          throw new StoreLeaseLostError(
            "markIndeterminate: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
      return withMappedErrors(async () => runGet(key));
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        // Without a global registry of keys, SCAN for our prefix + idemp segment.
        const match = scanMatchForStore(ctx.keys, "idemp");
        const limit = input.limit ?? Number.POSITIVE_INFINITY;
        let deleted = 0;
        let cursor = "0";
        do {
          if (deleted >= limit) break;
          const scanRaw = await ctx.port.send("SCAN", [
            cursor,
            "MATCH",
            match,
            "COUNT",
            "50",
          ]);
          const scan = normalizeScan(scanRaw);
          cursor = scan.cursor;
          for (const redisKey of scan.keys) {
            if (deleted >= limit) break;
            const raw = await ctx.eval.eval(
              IDEMPOTENCY_DELETE_IF_EXPIRED_LUA,
              [redisKey],
              [input.before],
            );
            const tagged = parseTaggedResult(raw);
            if (tagged.tag === "deleted") deleted++;
          }
        } while (cursor !== "0");
        return { deleted };
      });
    },
  };

  return store;
}
