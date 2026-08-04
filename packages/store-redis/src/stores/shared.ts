/**
 * Shared helpers for Redis store implementations.
 */

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

export function serializeResultJson(result: unknown): string {
  const s = JSON.stringify(result);
  if (s.length > MAX_RESULT_JSON_BYTES) {
    // Truncate safely — prefer marker over secrets
    return JSON.stringify({
      _truncated: true,
      preview: s.slice(0, Math.min(256, MAX_RESULT_JSON_BYTES - 64)),
    });
  }
  return s;
}

export function msFromIso(iso: string): string {
  const n = Date.parse(iso);
  if (!Number.isFinite(n)) return "0";
  return String(n);
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


