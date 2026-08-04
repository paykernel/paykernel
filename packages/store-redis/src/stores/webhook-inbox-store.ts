/**
 * Redis WebhookInboxStore — atomic Lua claim/renew/complete/fail.
 */

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
import { recordKey, webhookRetryIndexKey } from "../keys";
import { enforceMaxSanitizedError, MAX_PAYLOAD_REF_LENGTH, enforceMaxString } from "../limits";
import {
  parseTaggedResult,
  parseWebhookRecord,
  splitRecordAndToken,
  WEBHOOK_CLAIM_LUA,
  WEBHOOK_COMPLETE_LUA,
  WEBHOOK_DELETE_IF_EXPIRED_LUA,
  WEBHOOK_FAIL_LUA,
  WEBHOOK_GET_LUA,
  WEBHOOK_PACK_LEN,
  WEBHOOK_RENEW_LUA,
} from "../scripts";
import type { RedisStoreOptions } from "../types";
import {
  newLeaseToken,
  normalizeScan,
  resolveRedisStoreContext,
  scanMatchForStore,
} from "./shared";

export function createRedisWebhookInboxStore(
  options: RedisStoreOptions,
): WebhookInboxStore {
  const ctx = resolveRedisStoreContext(options);
  const indexKey = webhookRetryIndexKey(ctx.keys);

  function rk(key: string): string {
    return recordKey(ctx.keys, "whinbox", key);
  }

  async function runGet(key: string): Promise<WebhookInboxRecord | undefined> {
    const raw = await ctx.eval.eval(
      WEBHOOK_GET_LUA,
      [rk(key), indexKey],
      [clockNowMsString(ctx.clock), clockNowIso(ctx.clock)],
    );
    const tagged = parseTaggedResult(raw);
    if (tagged.tag === "missing") return undefined;
    if (tagged.tag !== "ok") {
      throw new StoreCorruptedRecordError(`get: unexpected tag ${tagged.tag}`);
    }
    return parseWebhookRecord(tagged.fields);
  }

  const store: WebhookInboxStore = {
    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      return withMappedErrors(async () => {
        const leaseToken = newLeaseToken();
        const payloadRef =
          enforceMaxString(input.payloadRef, MAX_PAYLOAD_REF_LENGTH) ?? "";
        const raw = await ctx.eval.eval(
          WEBHOOK_CLAIM_LUA,
          [rk(input.key), indexKey],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.payloadHash,
            input.owner,
            leaseToken,
            clockAddMsIso(ctx.clock, input.leaseMs),
            clockAddMsString(ctx.clock, input.leaseMs),
            payloadRef,
            input.key,
          ],
        );
        const tagged = parseTaggedResult(raw);

        if (tagged.tag === "acquired") {
          const { pack, token } = splitRecordAndToken(
            tagged.fields,
            WEBHOOK_PACK_LEN,
          );
          const record = parseWebhookRecord(pack);
          return {
            kind: "acquired",
            record,
            leaseToken: token ?? record.leaseToken ?? leaseToken,
          };
        }

        const record = parseWebhookRecord(tagged.fields);
        if (tagged.tag === "payload_hash_conflict") {
          return { kind: "payload_hash_conflict", record };
        }
        if (tagged.tag === "already_completed") {
          return { kind: "already_completed", record };
        }
        if (tagged.tag === "duplicate_failed") {
          return { kind: "duplicate_failed", record };
        }
        if (tagged.tag === "in_progress") {
          return { kind: "in_progress", record };
        }
        if (tagged.tag === "not_available") {
          return {
            kind: "not_available",
            record,
            availableAt: record.availableAt,
          };
        }
        throw new StoreCorruptedRecordError(
          `claim: unexpected script tag ${tagged.tag}`,
        );
      });
    },

    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
      return withMappedErrors(async () => {
        const newToken = newLeaseToken();
        const raw = await ctx.eval.eval(
          WEBHOOK_RENEW_LUA,
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
            WEBHOOK_PACK_LEN,
          );
          const record = parseWebhookRecord(pack);
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

    async complete(input: CompleteWebhookInput): Promise<void> {
      return withMappedErrors(async () => {
        const raw = await ctx.eval.eval(
          WEBHOOK_COMPLETE_LUA,
          [rk(input.key), indexKey],
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

    async fail(input: FailWebhookInput): Promise<void> {
      return withMappedErrors(async () => {
        const retryAfterMs = input.retryAfterMs ?? 0;
        const dead = input.deadLetter === true;
        const lastError = enforceMaxSanitizedError(input.error) ?? "";
        const raw = await ctx.eval.eval(
          WEBHOOK_FAIL_LUA,
          [rk(input.key), indexKey],
          [
            clockNowMsString(ctx.clock),
            clockNowIso(ctx.clock),
            input.leaseToken,
            lastError,
            dead ? "1" : "0",
            clockAddMsIso(ctx.clock, retryAfterMs),
            clockAddMsString(ctx.clock, retryAfterMs),
            input.key,
            String(ctx.retentionTtlSec),
            input.restoreAttempt === true ? "1" : "0",
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

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      return withMappedErrors(async () => runGet(key));
    },

    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      return withMappedErrors(async () => {
        const nowMs =
          input.now !== undefined
            ? String(Date.parse(input.now))
            : clockNowMsString(ctx.clock);
        const limit = input.limit ?? 100;
        const members = await ctx.port.send("ZRANGEBYSCORE", [
          indexKey,
          "-inf",
          nowMs,
          "LIMIT",
          "0",
          String(limit),
        ]);
        const keys = Array.isArray(members)
          ? members.map((m) => String(m))
          : [];
        const out: WebhookInboxRecord[] = [];
        for (const k of keys) {
          const rec = await runGet(k);
          if (rec && rec.status === "pending") {
            out.push(rec);
          }
          if (out.length >= limit) break;
        }
        return out;
      });
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      return withMappedErrors(async () => {
        const match = scanMatchForStore(ctx.keys, "whinbox");
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
            // Skip the index key itself
            if (redisKey === indexKey || redisKey.endsWith(":retry")) continue;
            const logicalKey = redisKey.split(":").pop() ?? "";
            const raw = await ctx.eval.eval(
              WEBHOOK_DELETE_IF_EXPIRED_LUA,
              [redisKey, indexKey],
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
