/**
 * Parse tagged Lua script results into typed store outcomes.
 *
 * Wire format: Redis array whose first element is a string tag
 * (e.g. "acquired", "lease_lost", "fingerprint_conflict").
 */

import type {
  IdempotencyRecord,
  IdempotencyRecordStatus,
  ReconciliationRecord,
  ReconciliationStatus,
  WebhookInboxRecord,
  WebhookInboxStatus,
} from "@paykernel/store-contracts";
import { StoreCorruptedRecordError } from "@paykernel/store-contracts";

export type TaggedResult = {
  tag: string;
  fields: string[];
};

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    return v.toString("utf8");
  }
  // Bun / node-redis may return Buffer-like
  if (
    typeof v === "object" &&
    v !== null &&
    "toString" in v &&
    typeof (v as { toString: unknown }).toString === "function"
  ) {
    return (v as { toString: (enc?: string) => string }).toString("utf8");
  }
  return String(v);
}

/**
 * Normalize EVAL return value to a tagged result.
 * Accepts: string[] | unknown[] | nested structures from various drivers.
 */
export function parseTaggedResult(raw: unknown): TaggedResult {
  if (raw === null || raw === undefined) {
    throw new StoreCorruptedRecordError("empty script result");
  }

  // Some clients JSON-decode accidentally; support { tag, ... }
  if (typeof raw === "object" && !Array.isArray(raw) && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (typeof o.tag === "string") {
      return { tag: o.tag, fields: [] };
    }
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    // Single string tag
    if (typeof raw === "string") {
      return { tag: raw, fields: [] };
    }
    throw new StoreCorruptedRecordError(
      `unexpected script result type: ${typeof raw}`,
    );
  }

  const tag = asString(raw[0]);
  const fields = raw.slice(1).map(asString);
  return { tag, fields };
}

function emptyToUndefined(s: string): string | undefined {
  return s === "" ? undefined : s;
}

function parseIntField(s: string, fallback = 0): number {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseResultJson(s: string): unknown | undefined {
  if (s === "") return undefined;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
}

/**
 * Idempotency pack layout (11 fields):
 * key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
 * attempts, generation, created_at, updated_at, result_json
 * Optional trailing leaseToken for acquired/ok renew.
 */
export function parseIdempotencyRecord(fields: string[]): IdempotencyRecord {
  if (fields.length < 11) {
    throw new StoreCorruptedRecordError(
      `idempotency record fields incomplete: ${fields.length}`,
    );
  }
  const status = fields[1] as IdempotencyRecordStatus;
  const rec: IdempotencyRecord = {
    key: fields[0]!,
    status,
    fingerprint: fields[2]!,
    attempts: parseIntField(fields[6]!),
    generation: parseIntField(fields[7]!),
    createdAt: fields[8]!,
    updatedAt: fields[9]!,
  };
  const owner = emptyToUndefined(fields[3]!);
  const token = emptyToUndefined(fields[4]!);
  const exp = emptyToUndefined(fields[5]!);
  if (owner !== undefined) rec.leaseOwner = owner;
  if (token !== undefined) rec.leaseToken = token;
  if (exp !== undefined) rec.leaseExpiresAt = exp;
  const result = parseResultJson(fields[10]!);
  if (result !== undefined) rec.result = result;
  return rec;
}

/**
 * Webhook pack (13 fields):
 * key, status, payload_hash, payload_ref, lease_owner, lease_token, lease_expires_at,
 * attempts, generation, created_at, updated_at, available_at, last_error
 */
export function parseWebhookRecord(fields: string[]): WebhookInboxRecord {
  if (fields.length < 13) {
    throw new StoreCorruptedRecordError(
      `webhook record fields incomplete: ${fields.length}`,
    );
  }
  const rec: WebhookInboxRecord = {
    key: fields[0]!,
    status: fields[1] as WebhookInboxStatus,
    payloadHash: fields[2]!,
    attempts: parseIntField(fields[7]!),
    generation: parseIntField(fields[8]!),
    createdAt: fields[9]!,
    updatedAt: fields[10]!,
    availableAt: fields[11]!,
  };
  const pref = emptyToUndefined(fields[3]!);
  const owner = emptyToUndefined(fields[4]!);
  const token = emptyToUndefined(fields[5]!);
  const exp = emptyToUndefined(fields[6]!);
  const lastErr = emptyToUndefined(fields[12]!);
  if (pref !== undefined) rec.payloadRef = pref;
  if (owner !== undefined) rec.leaseOwner = owner;
  if (token !== undefined) rec.leaseToken = token;
  if (exp !== undefined) rec.leaseExpiresAt = exp;
  if (lastErr !== undefined) rec.lastError = lastErr;
  return rec;
}

/**
 * Recon pack (13 fields):
 * key, status, subject_id, reason, lease_owner, lease_token, lease_expires_at,
 * attempts, generation, due_at, created_at, updated_at, last_error
 */
export function parseReconciliationRecord(fields: string[]): ReconciliationRecord {
  if (fields.length < 13) {
    throw new StoreCorruptedRecordError(
      `reconciliation record fields incomplete: ${fields.length}`,
    );
  }
  const rec: ReconciliationRecord = {
    key: fields[0]!,
    status: fields[1] as ReconciliationStatus,
    subjectId: fields[2]!,
    reason: fields[3]!,
    attempts: parseIntField(fields[7]!),
    generation: parseIntField(fields[8]!),
    dueAt: fields[9]!,
    createdAt: fields[10]!,
    updatedAt: fields[11]!,
  };
  const owner = emptyToUndefined(fields[4]!);
  const token = emptyToUndefined(fields[5]!);
  const exp = emptyToUndefined(fields[6]!);
  const lastErr = emptyToUndefined(fields[12]!);
  if (owner !== undefined) rec.leaseOwner = owner;
  if (token !== undefined) rec.leaseToken = token;
  if (exp !== undefined) rec.leaseExpiresAt = exp;
  if (lastErr !== undefined) rec.lastError = lastErr;
  return rec;
}

/** Split trailing token from pack+token arrays (acquired / renew ok). */
export function splitRecordAndToken(fields: string[], packLen: number): {
  pack: string[];
  token: string | undefined;
} {
  if (fields.length === packLen + 1) {
    return { pack: fields.slice(0, packLen), token: fields[packLen] };
  }
  if (fields.length === packLen) {
    return { pack: fields, token: undefined };
  }
  // Best effort: last field is token if longer than pack
  if (fields.length > packLen) {
    return {
      pack: fields.slice(0, packLen),
      token: fields[fields.length - 1],
    };
  }
  return { pack: fields, token: undefined };
}

export const IDEMPOTENCY_PACK_LEN = 11;
export const WEBHOOK_PACK_LEN = 13;
export const RECON_PACK_LEN = 13;
