/**
 * Redis key layout: prefix, schema version, optional tenant, store segment, hash tags.
 *
 * Default: `psdk:v1[:t:{tenant}]:{store}:{logicalKey}`
 * With clusterKeys: hash-tag co-location `{tenant}` or `{_}` so record + index share a slot.
 */

import {
  MAX_KEY_SEGMENT_LENGTH,
  MAX_REDIS_KEY_LENGTH,
} from "./limits";

export const DEFAULT_KEY_PREFIX = "psdk";
export const DEFAULT_SCHEMA_VERSION = "v1";

export type StoreSegment = "idemp" | "whinbox" | "recon";

export type KeyOptions = {
  /** Key prefix (default `psdk`). */
  prefix?: string;
  /** Schema version segment (default `v1`). */
  version?: string;
  /** Optional tenant / namespace id. */
  tenantId?: string;
  /**
   * When true, wrap the tenant (or `_`) in `{}` hash tags for Redis Cluster
   * co-location of record + index keys. Bun binding must reject this.
   */
  clusterKeys?: boolean;
};

export type ResolvedKeyDesign = {
  prefix: string;
  version: string;
  tenantId: string | undefined;
  clusterKeys: boolean;
  /** Shared hash-tag body (without braces), when clusterKeys. */
  hashTagBody: string | undefined;
};

export class RedisKeyDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisKeyDesignError";
  }
}

const SEGMENT_RE = /^[A-Za-z0-9_.:@+=\-/]+$/;

function assertSegment(field: string, value: string): void {
  if (value.length === 0) {
    throw new RedisKeyDesignError(`${field} must be non-empty`);
  }
  if (value.length > MAX_KEY_SEGMENT_LENGTH) {
    throw new RedisKeyDesignError(
      `${field} exceeds max length ${MAX_KEY_SEGMENT_LENGTH}`,
    );
  }
  if (/\s/.test(value) || value.includes("\n") || value.includes("\r")) {
    throw new RedisKeyDesignError(`${field} must not contain whitespace or newlines`);
  }
  if (value.includes("{") || value.includes("}")) {
    throw new RedisKeyDesignError(`${field} must not contain hash-tag braces`);
  }
  if (!SEGMENT_RE.test(value)) {
    throw new RedisKeyDesignError(
      `${field} contains invalid characters (allowed: alnum _ . : @ + = - /)`,
    );
  }
}

export function resolveKeyDesign(options: KeyOptions = {}): ResolvedKeyDesign {
  const prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  const version = options.version ?? DEFAULT_SCHEMA_VERSION;
  assertSegment("prefix", prefix);
  assertSegment("version", version);

  let tenantId: string | undefined;
  if (options.tenantId !== undefined) {
    assertSegment("tenantId", options.tenantId);
    tenantId = options.tenantId;
  }

  const clusterKeys = options.clusterKeys === true;
  const hashTagBody = clusterKeys ? (tenantId ?? "_") : undefined;

  return { prefix, version, tenantId, clusterKeys, hashTagBody };
}

function baseParts(design: ResolvedKeyDesign): string[] {
  const parts = [design.prefix, design.version];
  if (design.clusterKeys && design.hashTagBody !== undefined) {
    // Hash tag co-location for cluster-capable bindings.
    parts.push(`{${design.hashTagBody}}`);
  } else if (design.tenantId !== undefined) {
    parts.push("t", design.tenantId);
  }
  return parts;
}

function joinKey(parts: string[]): string {
  const key = parts.join(":");
  if (key.length > MAX_REDIS_KEY_LENGTH) {
    throw new RedisKeyDesignError(
      `Redis key exceeds max length ${MAX_REDIS_KEY_LENGTH}`,
    );
  }
  return key;
}

function assertLogicalKey(logicalKey: string): void {
  if (logicalKey.length === 0) {
    throw new RedisKeyDesignError("logical key must be non-empty");
  }
  if (logicalKey.length > MAX_KEY_SEGMENT_LENGTH * 2) {
    throw new RedisKeyDesignError("logical key too long");
  }
  if (/\s/.test(logicalKey) || logicalKey.includes("\n")) {
    throw new RedisKeyDesignError("logical key must not contain whitespace or newlines");
  }
}

/**
 * Record HASH key for a store row.
 * Shape: `prefix:ver[:{tag}|:t:tenant]:store:logicalKey`
 */
export function recordKey(
  design: ResolvedKeyDesign,
  store: StoreSegment,
  logicalKey: string,
): string {
  assertLogicalKey(logicalKey);
  return joinKey([...baseParts(design), store, logicalKey]);
}

/** ZSET of webhook keys scored by available_ms (retry/pending index). */
export function webhookRetryIndexKey(design: ResolvedKeyDesign): string {
  return joinKey([...baseParts(design), "whinbox", "retry"]);
}

/** ZSET of reconciliation keys scored by due_ms. */
export function reconciliationDueIndexKey(design: ResolvedKeyDesign): string {
  return joinKey([...baseParts(design), "recon", "due"]);
}

/** SET / ZSET of terminal keys eligible for retention cleanup (optional). */
export function retentionIndexKey(
  design: ResolvedKeyDesign,
  store: StoreSegment,
): string {
  return joinKey([...baseParts(design), store, "retain"]);
}

/**
 * Format helper for tests/docs: show hash-tag segment when cluster mode.
 */
export function formatHashTag(body: string): string {
  assertSegment("hashTag", body);
  return `{${body}}`;
}
