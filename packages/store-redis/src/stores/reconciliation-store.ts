/**
 * Redis ReconciliationStore — atomic Lua schedule/claim/renew/complete/fail.
 */

import type {
  ClaimReconciliationInput,
  ClaimResult,
  CleanupInput,
  CleanupResult,
  CompleteReconciliationInput,
  FailReconciliationInput,
  ListDueInput,
  MarkManualReviewInput,
  ReconciliationKey,
  ReconciliationRecord,
  ReconciliationStore,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  ScheduleReconciliationInput,
  ScheduleResult,
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
import { recordKey, reconciliationDueIndexKey } from "../keys";
import { enforceMaxSanitizedError } from "../limits";
import {
  parseReconciliationRecord,
  parseTaggedResult,
  RECON_CLAIM_LUA,
  RECON_COMPLETE_LUA,
  RECON_DELETE_IF_EXPIRED_LUA,
  RECON_FAIL_LUA,
  RECON_GET_LUA,
  RECON_MARK_MANUAL_REVIEW_LUA,
  RECON_PACK_LEN,
  RECON_RENEW_LUA,
  RECON_SCHEDULE_LUA,
  splitRecordAndToken,
} from "../scripts";
import type { RedisStoreOptions } from "../types";
import {
  msFromIso,
  newLeaseToken,
  normalizeScan,
  resolveRedisStoreContext,
  scanMatchForStore,
  softReleaseExpiredClaimedViaScan,
} from "./shared";

export function createRedisReconciliationStore(
  options: RedisStoreOptions,
): ReconciliationStore {
  const ctx = resolveRedisStoreContext(options);
  const dueIndex = reconciliationDueIndexKey(ctx.keys);

  function rk(key: string): string {
    return recordKey(ctx.keys, "recon", key);
  }

  async function runGet(
    key: string,
  ): Promise<ReconciliationRecord | undefined> {
    const raw = await ctx.eval.eval(
      RECON_GET_LUA,
      [rk(key), dueIndex],
      [clockNowMsString(ctx.clock), clockNowIso(ctx.clock)],
    );
    const tagged = parseTaggedResult(raw);
    if (tagged.tag === "missing") return undefined;
    if (tagged.tag !== "ok") {
      throw new StoreCorruptedRecordError(`get: unexpected tag ${tagged.tag}`);
    }
    return parseReconciliationRecord(tagged.fields);
  }

  const store: ReconciliationStore = {
    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      return withMappedErrors(async () => {
        const raw = await ctx.eval.eval(
          RECON_SCHEDULE_LUA,
          [rk(input.key), dueIndex],
          [
            clockNowIso(ctx.clock),
            input.subjectId,
            input.reason,
            input.dueAt,
            msFromIso(input.dueAt),
            input.key,
          ],
        );
        const tagged = parseTaggedResult(raw);
        const record = parseReconciliationRecord(tagged.fields);
        if (tagged.tag === "scheduled") {
          return { kind: "scheduled", record };
        }
        if (tagged.tag === "already_exists") {
          return { kind: "already_exists", record };
        }
        throw new StoreCorruptedRecordError(
          `schedule: unexpected script tag ${tagged.tag}`,
        );
      });
    },

    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const raw = await ctx.eval.eval(
          RECON_CLAIM_LUA,
          [rk(input.key), dueIndex],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.owner,
            leaseToken,
            clockAddMsIso(ctx.clock, input.leaseMs),
            clockAddMsString(ctx.clock, input.leaseMs),
            input.key,
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag === "not_found") return { kind: "not_found" };
        if (tagged.tag === "acquired") {
          const { pack, token } = splitRecordAndToken(
            tagged.fields,
            RECON_PACK_LEN,
          );
          const record = parseReconciliationRecord(pack);
          return {
            kind: "acquired",
            record,
            leaseToken: token ?? record.leaseToken ?? leaseToken,
          };
        }
        const record = parseReconciliationRecord(tagged.fields);
        if (tagged.tag === "already_terminal") {
          return { kind: "already_terminal", record };
        }
        if (tagged.tag === "not_due") {
          return { kind: "not_due", record };
        }
        if (tagged.tag === "in_progress") {
          return { kind: "in_progress", record };
        }
        throw new StoreCorruptedRecordError(
          `claim: unexpected script tag ${tagged.tag}`,
        );
      });
    },

    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      return withMappedErrors(async () => {
        const newToken = newLeaseToken();
        const raw = await ctx.eval.eval(
          RECON_RENEW_LUA,
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
            RECON_PACK_LEN,
          );
          const record = parseReconciliationRecord(pack);
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

    async complete(input: CompleteReconciliationInput): Promise<void> {
      return withMappedErrors(async () => {
        const raw = await ctx.eval.eval(
          RECON_COMPLETE_LUA,
          [rk(input.key), dueIndex],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            input.key,
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

    async fail(input: FailReconciliationInput): Promise<void> {
      return withMappedErrors(async () => {
        const lastError = enforceMaxSanitizedError(input.error) ?? "";
        const mode = input.retryAt !== undefined ? "retry" : "terminal";
        const retryAt = input.retryAt ?? "";
        const retryMs =
          input.retryAt !== undefined ? msFromIso(input.retryAt) : "0";
        const raw = await ctx.eval.eval(
          RECON_FAIL_LUA,
          [rk(input.key), dueIndex],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            lastError,
            mode,
            retryAt,
            retryMs,
            input.key,
            String(ctx.retentionTtlSec),
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag !== "ok") {
          throw new StoreLeaseLostError(
            "fail: lease token rejected or key not found",
          );
        }
      });
    },

    async markManualReview(input: MarkManualReviewInput): Promise<void> {
      return withMappedErrors(async () => {
        const note =
          input.note !== undefined
            ? enforceMaxSanitizedError(input.note) ?? ""
            : "";
        const raw = await ctx.eval.eval(
          RECON_MARK_MANUAL_REVIEW_LUA,
          [rk(input.key), dueIndex],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            note,
            input.key,
            String(ctx.retentionTtlSec),
          ],
        );
        const tagged = parseTaggedResult(raw);
        if (tagged.tag !== "ok") {
          throw new StoreLeaseLostError(
            "markManualReview: lease token rejected or key not found",
          );
        }
      });
    },

    async get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined> {
      return withMappedErrors(async () => runGet(key));
    },

    async listDue(input: ListDueInput): Promise<ReconciliationRecord[]> {
      return withMappedErrors(async () => {
        const nowMs =
          input.now !== undefined
            ? String(Date.parse(input.now))
            : clockNowMsString(ctx.clock);
        const nowIso =
          input.now !== undefined ? input.now : clockNowIso(ctx.clock);
        const limit = input.limit ?? 100;
        // Claim ZREMs the due index; SCAN soft-release re-indexes expired claimed
        // so claimDue/processDue rediscover work after crash (SQL/memory parity).
        await softReleaseExpiredClaimedViaScan({
          port: ctx.port,
          eval: ctx.eval,
          match: scanMatchForStore(ctx.keys, "recon"),
          indexKey: dueIndex,
          getLua: RECON_GET_LUA,
          nowMs,
          nowIso,
          indexName: "due",
        });
        const members = await ctx.port.send("ZRANGEBYSCORE", [
          dueIndex,
          "-inf",
          nowMs,
          "LIMIT",
          "0",
          String(limit),
        ]);
        const keys = Array.isArray(members)
          ? members.map((m) => String(m))
          : [];
        const out: ReconciliationRecord[] = [];
        for (const k of keys) {
          const rec = await runGet(k);
          if (rec && rec.status === "scheduled") {
            out.push(rec);
          }
          if (out.length >= limit) break;
        }
        return out;
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        const match = scanMatchForStore(ctx.keys, "recon");
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
            if (redisKey === dueIndex || redisKey.endsWith(":due")) continue;
            const logicalKey = redisKey.split(":").pop() ?? "";
            const raw = await ctx.eval.eval(
              RECON_DELETE_IF_EXPIRED_LUA,
              [redisKey, dueIndex],
              [input.before, logicalKey],
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
