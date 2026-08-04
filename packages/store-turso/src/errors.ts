/**
 * Map driver / storage errors into the testkit StoreErrorCode taxonomy.
 *
 * Never leak secrets, auth tokens, connection strings, or raw provider
 * payloads into messages.
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
} from "@paykernel/store-contracts";

const MAX_MESSAGE = 256;

function sanitizeMessage(message: string, fallback: string): string {
  const cleaned = message
    // Key=value style secrets
    .replace(
      /(password|secret|token|authorization|authToken|auth_token)=[^\s&'"]+/gi,
      "$1=***",
    )
    // Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer ***")
    // Turso / libSQL URLs (may embed tokens in query or userinfo)
    .replace(/libsqls?:\/\/[^\s'"]+/gi, "libsql://***")
    .replace(/https?:\/\/[^\s'"]*turso\.io[^\s'"]*/gi, "https://***.turso.io")
    .replace(/https?:\/\/[^\s'"]*libsql\.com[^\s'"]*/gi, "https://***.libsql.com")
    // Generic authToken in text
    .replace(/TURSO_AUTH_TOKEN[^\s'"]*/gi, "TURSO_AUTH_TOKEN=***")
    .replace(/LIBSQL_AUTH_TOKEN[^\s'"]*/gi, "LIBSQL_AUTH_TOKEN=***")
    .replace(/(?:file|sqlite):\/\/[^\s'"]+/gi, "sqlite://***")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_MESSAGE) return cleaned;
  return cleaned.slice(0, MAX_MESSAGE - 1) + "…";
}

function readCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  // Only real driver codes / errno — never Error.name ("Error"), which would
  // make every plain Error look like a coded driver failure.
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
 * Heuristic mapping of Turso serverless / libSQL / network / SQLite errors.
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

  // Busy / locked → timeout (retryable)
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

  // Serialization / conflict
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

  // Timeout (includes @tursodatabase/serverless TimeoutError code "TIMEOUT")
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

  // Connection / unavailable
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ENETUNREACH" ||
    codeUpper === "ECONNREFUSED" ||
    codeUpper === "ECONNRESET" ||
    lower.includes("connection refused") ||
    lower.includes("connection terminated") ||
    lower.includes("connection reset") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("not connected") ||
    lower.includes("server closed") ||
    lower.includes("socket hang up") ||
    lower.includes("hrana") ||
    lower.includes("stream closed") ||
    lower.includes("unauthorized") ||
    lower.includes("http 5") ||
    lower.includes("http 401") ||
    lower.includes("http 403") ||
    lower.includes("http 429")
  ) {
    return new StoreUnavailableError(msg || "Store unavailable", err);
  }

  // Schema / missing table or column
  if (
    lower.includes("no such table") ||
    lower.includes("no such column") ||
    (lower.includes("does not exist") &&
      (lower.includes("table") || lower.includes("column")))
  ) {
    return new StoreInvalidSchemaError(msg || "Store schema invalid", err);
  }

  // Corruption
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
 * Used so `withTransaction` does not rewrite user-thrown Errors into StoreUnavailableError.
 *
 * Any non-empty driver `code` (SQLITE_*, TIMEOUT, ECONN*, errno digits, …) is
 * treated as a driver failure. Plain application Errors without a code are not.
 */
export function isLikelyDriverFailure(err: unknown): boolean {
  if (err instanceof StoreError) return true;
  const code = readCode(err);
  // Driver SDKs attach codes (TIMEOUT, SQLITE_BUSY, ECONNREFUSED, numeric errno).
  // Application logic throws plain Error without a code (e.g. force_rollback).
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
    lower.includes("libsql") ||
    lower.includes("turso") ||
    lower.includes("hrana") ||
    lower.includes("stream closed") ||
    lower.includes("no such table") ||
    lower.includes("syntax error")
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

/**
 * Run a store transaction: propagate application errors; map only driver-like failures.
 */
export async function withMappedTransaction<T>(
  run: () => Promise<T>,
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
};
