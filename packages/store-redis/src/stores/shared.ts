/**
 * Shared helpers for Redis store implementations.
 */

import {
  StoreInvalidSchemaError,
  StoreSerializationFailureError,
} from "@paykernel/store-contracts";
import type { RedisCommandPort } from "../port";
import { createEvalHelper, type EvalHelper } from "../port";
import type { StoreClock } from "../clock";
import { createSystemClock } from "../clock";
import type { ResolvedKeyDesign, StoreSegment } from "../keys";
import { resolveKeyDesign } from "../keys";
import type { RedisStoreOptions } from "../types";
import { MAX_RESULT_JSON_BYTES } from "../limits";

/** Unguessable opaque lease token (portable; not a 64-bit number). */
export function newLeaseToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return `lt_${hex}`;
}

export type ResolvedRedisStoreContext = {
  port: RedisCommandPort;
  eval: EvalHelper;
  keys: ResolvedKeyDesign;
  clock: StoreClock;
  retentionTtlSec: number;
};

export function resolveRedisStoreContext(
  options: RedisStoreOptions,
): ResolvedRedisStoreContext {
  const keys: ResolvedKeyDesign = resolveKeyDesign(options.keys ?? {});
  const clock = options.clock ?? createSystemClock();
  // retentionTtlSec is accepted for call-site parity; terminal scripts PERSIST
  // (P1315-REDIS-3 / STORES-5) and ignore EXPIRE. Cleanup via deleteExpired.
  const retentionTtlMs = options.retentionTtlMs;
  const retentionTtlSec =
    retentionTtlMs !== undefined && retentionTtlMs > 0
      ? Math.max(1, Math.floor(retentionTtlMs / 1000))
      : 0;

  return {
    port: options.port,
    eval: createEvalHelper(options.port),
    keys,
    clock,
    retentionTtlSec,
  };
}

/**
 * Serialize an idempotency cached result for Redis storage.
 *
 * Fail closed when the JSON exceeds {@link MAX_RESULT_JSON_BYTES}: never store a
 * truncation marker as an authoritative money outcome (REDIS-1 / audit).
 */
export function serializeResultJson(result: unknown): string {
  const s = JSON.stringify(result);
  if (s.length > MAX_RESULT_JSON_BYTES) {
    throw new StoreSerializationFailureError(
      `idempotency result JSON exceeds MAX_RESULT_JSON_BYTES (${MAX_RESULT_JSON_BYTES}); refusing to store truncated money outcome`,
    );
  }
  return s;
}

/**
 * Parse an ISO-8601 timestamp to epoch milliseconds as a decimal string for Lua scores.
 *
 * Invalid / non-finite values fail closed — never map to `0` (epoch), which would
 * make work immediately claimable (REDIS-2 / audit).
 */
export function msFromIso(iso: string): string {
  if (typeof iso !== "string" || iso.length === 0) {
    throw new StoreInvalidSchemaError(
      "invalid ISO timestamp for due/retry scheduling: empty",
    );
  }
  const n = Date.parse(iso);
  if (!Number.isFinite(n)) {
    throw new StoreInvalidSchemaError(
      "invalid ISO timestamp for due/retry scheduling",
    );
  }
  return String(n);
}

/**
 * Canonical millisecond UTC ISO (`Date#toISOString`) for Lua lexical compares.
 * Fail closed on invalid input — never pass offset / garbage to ARGV (P1315-REDIS-5).
 */
export function canonicalizeIsoZ(iso: string): string {
  return new Date(Number(msFromIso(iso))).toISOString();
}

/** SCAN MATCH pattern for record keys of one store segment (excludes index keys). */
export function scanMatchForStore(
  design: ResolvedKeyDesign,
  store: StoreSegment,
): string {
  const parts = [design.prefix, design.version];
  if (design.clusterKeys && design.hashTagBody !== undefined) {
    parts.push(`{${design.hashTagBody}}`);
  } else if (design.tenantId !== undefined) {
    parts.push("t", design.tenantId);
  }
  parts.push(store);
  return `${parts.join(":")}:*`;
}

/** Normalize Redis SCAN reply `[cursor, keys[]]`. */
export function normalizeScan(raw: unknown): { cursor: string; keys: string[] } {
  if (!Array.isArray(raw) || raw.length < 2) {
    return { cursor: "0", keys: [] };
  }
  const cursor = String(raw[0]);
  const keysRaw = raw[1];
  const keys = Array.isArray(keysRaw) ? keysRaw.map((k) => String(k)) : [];
  return { cursor, keys };
}

/**
 * SCAN store record keys and run GET_LUA on each so expired `claimed` rows
 * soft-release + re-index into the due/retry ZSET.
 *
 * Extra / standalone-only: claim already ZADDs the due/retry index at
 * `lease_expires_ms` so ZRANGEBYSCORE(-inf, now) rediscovers abandoned
 * claimed keys with keyed ZSET ops (P1315-REDIS-2, Cluster-safe). SCAN must
 * not be the only recovery path.
 */
export async function softReleaseExpiredClaimedViaScan(options: {
  port: RedisCommandPort;
  eval: EvalHelper;
  match: string;
  indexKey: string;
  getLua: string;
  nowMs: string;
  nowIso: string;
  /** Skip keys ending with this segment (e.g. "due", "retry"). */
  indexName: string;
}): Promise<void> {
  const { port, eval: evalHelper, match, indexKey, getLua, nowMs, nowIso, indexName } =
    options;
  let cursor = "0";
  do {
    const scanRaw = await port.send("SCAN", [
      cursor,
      "MATCH",
      match,
      "COUNT",
      "50",
    ]);
    const scan = normalizeScan(scanRaw);
    cursor = scan.cursor;
    for (const redisKey of scan.keys) {
      if (redisKey === indexKey || redisKey.endsWith(`:${indexName}`)) continue;
      await evalHelper.eval(getLua, [redisKey, indexKey], [nowMs, nowIso]);
    }
  } while (cursor !== "0");
}

