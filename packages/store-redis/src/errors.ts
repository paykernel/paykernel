/**
 * Map driver / storage errors into the testkit StoreErrorCode taxonomy.
 *
 * Never leak secrets, connection strings, or raw provider payloads into messages.
 */

import {
  StoreCorruptedRecordError,
  StoreError,
  StoreInvalidSchemaError,
  StoreLeaseLostError,
  StoreSerializationFailureError,
  StoreTimeoutError,
  StoreUnavailableError,
  type StoreErrorCode,
} from "@paykernel/testkit";

const MAX_MESSAGE = 256;

function sanitizeMessage(message: string, fallback: string): string {
  const cleaned = message
    .replace(/(password|secret|token|authorization|api[_-]?key)=[^\s&]+/gi, "$1=***")
    .replace(/redis:\/\/[^\s]+/gi, "redis://***")
    .replace(/rediss:\/\/[^\s]+/gi, "rediss://***")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://***")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_MESSAGE) return cleaned;
  return cleaned.slice(0, MAX_MESSAGE - 1) + "…";
}

function readCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; errno?: unknown; name?: unknown };
  if (typeof e.code === "string") return e.code;
  if (typeof e.code === "number") return String(e.code);
  if (typeof e.errno === "string" || typeof e.errno === "number") {
    return String(e.errno);
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * Heuristic mapping of ioredis / node-redis / Upstash / Bun Redis / network errors.
 */
export function mapDriverError(err: unknown): StoreError {
  if (err instanceof StoreError) return err;

  const code = readCode(err);
  const rawMsg = readMessage(err);
  const msg = sanitizeMessage(rawMsg, "Store operation failed");
  const lower = rawMsg.toLowerCase();

  if (code === "lease_lost") {
    return new StoreLeaseLostError(msg, err);
  }

  // Auth
  if (
    code === "NOAUTH" ||
    code === "WRONGPASS" ||
    lower.includes("noauth") ||
    lower.includes("wrongpass") ||
    lower.includes("invalid password") ||
    lower.includes("authentication required") ||
    lower.includes("auth failed")
  ) {
    return new StoreUnavailableError(msg || "Redis authentication failed", err);
  }

  // Timeouts
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("command timed out")
  ) {
    return new StoreTimeoutError(msg || "Store operation timed out", err);
  }

  // Connection / unavailable
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "NR_CLOSED" ||
    code === "CONNECTION_BROKEN" ||
    code === "CONNECTION_CLOSED" ||
    lower.includes("connection is closed") ||
    lower.includes("connection closed") ||
    lower.includes("connect econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("socket closed") ||
    lower.includes("stream isn't writeable") ||
    lower.includes("the client is closed") ||
    lower.includes("redis is loading") ||
    lower.includes("loading the dataset") ||
    lower.includes("clusterdown") ||
    lower.includes("masterdown") ||
    (lower.includes("readonly") && lower.includes("replica"))
  ) {
    return new StoreUnavailableError(msg || "Store unavailable", err);
  }

  // Script / OOM / busy
  if (
    lower.includes("error running script") ||
    lower.includes("busy redis is busy") ||
    lower.includes("oom command not allowed") ||
    lower.includes("script killed")
  ) {
    return new StoreUnavailableError(msg || "Redis script/engine unavailable", err);
  }

  // CROSSSLOT / cluster topology misconfig
  if (
    lower.includes("crossslot") ||
    (lower.includes("cluster") && lower.includes("down")) ||
    lower.includes("moved ") ||
    lower.includes("ask ")
  ) {
    return new StoreInvalidSchemaError(
      msg || "Redis cluster topology or key slot error",
      err,
    );
  }

  // WRONGTYPE / corrupt layout
  if (code === "WRONGTYPE" || lower.includes("wrongtype")) {
    return new StoreCorruptedRecordError(msg || "Corrupted Redis key type", err);
  }

  // Default: unavailable (retryable) — do not convert uncertain outcomes to hard conflicts.
  return new StoreUnavailableError(msg || "Store unavailable", err);
}

export function isLikelyDriverFailure(err: unknown): boolean {
  if (err instanceof StoreError) return true;
  const code = readCode(err);
  if (code !== undefined && code.length > 0) return true;
  const lower = readMessage(err).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("connection refused") ||
    lower.includes("connection closed") ||
    lower.includes("noscript") ||
    lower.includes("wrongtype") ||
    lower.includes("crossslot") ||
    lower.includes("redis") ||
    lower.includes("loading the dataset")
  );
}

/**
 * Wrap an async store op: rethrow StoreError subclasses; map driver failures.
 */
export async function withMappedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StoreError) throw err;
    throw mapDriverError(err);
  }
}

export type { StoreErrorCode };
export {
  StoreError,
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreTimeoutError,
  StoreSerializationFailureError,
  StoreInvalidSchemaError,
  StoreCorruptedRecordError,
};
