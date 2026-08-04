/**
 * Map Durable Object / SQLite storage errors into the testkit StoreErrorCode taxonomy.
 *
 * Never leak secrets, auth tokens, API tokens, account IDs, connection strings,
 * or raw provider payloads into messages.
 */

import {
  StoreCorruptedRecordError,
  StoreUnsupportedFeatureError,
  StoreError,
  StoreInvalidSchemaError,
  StoreLeaseLostError,
  StoreSerializationFailureError,
  StoreTimeoutError,
  StoreUnavailableError,
  type StoreErrorCode,
} from "@paykernel/store-contracts";

const MAX_MESSAGE = 256;

function sanitizeMessage(message: string, fallback: string): string {
  const cleaned = message
    .replace(
      /(password|secret|token|authorization|authToken|auth_token|apiToken|api_token)=[^\s&'"]+/gi,
      "$1=***",
    )
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer ***")
    .replace(/CF_API_TOKEN[^\s'"]*/gi, "CF_API_TOKEN=***")
    .replace(/CLOUDFLARE_API_TOKEN[^\s'"]*/gi, "CLOUDFLARE_API_TOKEN=***")
    .replace(/account[_-]?id[=:\s]+[A-Za-z0-9_-]+/gi, "account_id=***")
    .replace(/AccountId[=:\s]+[A-Za-z0-9_-]+/gi, "AccountId=***")
    .replace(/https?:\/\/[^\s'"]*cloudflare\.com[^\s'"]*/gi, "https://***.cloudflare.com")
    .replace(/https?:\/\/[^\s'"]*workers\.dev[^\s'"]*/gi, "https://***.workers.dev")
    .replace(/(?:file|sqlite):\/\/[^\s'"]+/gi, "sqlite://***")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_MESSAGE) return cleaned;
  return cleaned.slice(0, MAX_MESSAGE - 1) + "…";
}

function readCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; errno?: unknown };
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
 * Heuristic mapping of DO SQLite / Workers / network errors.
 */
export function mapDriverError(err: unknown): StoreError {
  if (err instanceof StoreError) return err;

  const code = readCode(err);
  const rawMsg = readMessage(err);
  const msg = sanitizeMessage(rawMsg, "Store operation failed");
  const lower = rawMsg.toLowerCase();
  const codeUpper = (code ?? "").toUpperCase();

  if (code === "lease_lost") {
    return new StoreLeaseLostError(msg, err);
  }

  if (
    codeUpper === "SQLITE_BUSY" ||
    codeUpper === "SQLITE_LOCKED" ||
    codeUpper === "SQLITE_BUSY_SNAPSHOT" ||
    code === "5" ||
    code === "6" ||
    lower.includes("database is locked") ||
    lower.includes("sqlite_busy") ||
    lower.includes("sqlite_locked") ||
    lower.includes("write transaction") ||
    lower.includes("transaction is locked")
  ) {
    return new StoreTimeoutError(msg || "Store operation timed out", err);
  }

  if (
    lower.includes("could not serialize") ||
    lower.includes("deadlock") ||
    (lower.includes("conflict") && lower.includes("write"))
  ) {
    return new StoreSerializationFailureError(
      msg || "Serialization failure",
      err,
    );
  }

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("aborted") ||
    codeUpper === "ETIMEDOUT" ||
    codeUpper === "TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "TIMEOUT"
  ) {
    return new StoreTimeoutError(msg || "Store operation timed out", err);
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ENETUNREACH" ||
    codeUpper === "ECONNREFUSED" ||
    codeUpper === "ECONNRESET" ||
    lower.includes("durable object") ||
    lower.includes("internal error") ||
    lower.includes("storage backend") ||
    lower.includes("connection refused") ||
    lower.includes("connection terminated") ||
    lower.includes("connection reset") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("not connected") ||
    lower.includes("server closed") ||
    lower.includes("socket hang up") ||
    lower.includes("unauthorized") ||
    lower.includes("http 5") ||
    lower.includes("http 401") ||
    lower.includes("http 403") ||
    lower.includes("http 429")
  ) {
    return new StoreUnavailableError(msg || "Store unavailable", err);
  }

  if (
    lower.includes("no such table") ||
    lower.includes("no such column") ||
    (lower.includes("does not exist") &&
      (lower.includes("table") || lower.includes("column")))
  ) {
    return new StoreInvalidSchemaError(msg || "Store schema invalid", err);
  }

  if (
    codeUpper === "SQLITE_CORRUPT" ||
    lower.includes("database disk image is malformed") ||
    lower.includes("corrupt")
  ) {
    return new StoreCorruptedRecordError(msg || "Corrupted record", err);
  }

  // Default: unavailable (retryable) — do not convert uncertain outcomes into
  // hard application failures.
  return new StoreUnavailableError(msg || "Store unavailable", err);
}

/**
 * True when the error looks like a driver/network/SQL failure (not app logic).
 */
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
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("connection refused") ||
    lower.includes("connection terminated") ||
    lower.includes("connection reset") ||
    lower.includes("fetch failed") ||
    lower.includes("database is locked") ||
    lower.includes("sqlite") ||
    lower.includes("durable object") ||
    lower.includes("no such table") ||
    lower.includes("syntax error")
  );
}

/**
 * Wrap a store op (sync or async): rethrow StoreError; map driver failures.
 */
export async function withMappedErrors<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StoreError) throw err;
    throw mapDriverError(err);
  }
}

/**
 * Run a store transaction/callback: propagate application errors; map only driver-like failures.
 */
export async function withMappedTransaction<T>(
  run: () => Promise<T> | T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof StoreError) throw err;
    if (isLikelyDriverFailure(err)) throw mapDriverError(err);
    throw err;
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
  StoreUnsupportedFeatureError,
};
