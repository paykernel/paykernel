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
} from "@paykernel/store-contracts";

const MAX_MESSAGE = 256;

function sanitizeMessage(message: string, fallback: string): string {
  const cleaned = message
    .replace(/(password|secret|token|authorization)=[^\s&]+/gi, "$1=***")
    .replace(/(?:file|sqlite):\/\/[^\s]+/gi, "sqlite://***")
    .replace(/\b[\w.-]+\.db(?:-wal|-shm)?\b/gi, "***.db")
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
  if (typeof e.name === "string" && e.name.startsWith("SQLite")) {
    return e.name;
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * Heuristic mapping of bun:sqlite / node:sqlite / better-sqlite3 / FS errors.
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

  // Busy / locked → timeout (retryable) — SQLITE_BUSY, SQLITE_LOCKED
  if (
    codeUpper === "SQLITE_BUSY" ||
    codeUpper === "SQLITE_LOCKED" ||
    codeUpper === "SQLITE_BUSY_SNAPSHOT" ||
    codeUpper === "SQLITE_BUSY_RECOVERY" ||
    codeUpper === "SQLITE_BUSY_TIMEOUT" ||
    code === "5" || // SQLITE_BUSY
    code === "6" || // SQLITE_LOCKED
    lower.includes("database is locked") ||
    lower.includes("sqlite_busy") ||
    lower.includes("sqlite_locked") ||
    lower.includes("database table is locked")
  ) {
    return new StoreTimeoutError(msg || "SQLite database is locked", err);
  }

  // Disk / IO / full
  if (
    codeUpper === "SQLITE_IOERR" ||
    codeUpper === "SQLITE_FULL" ||
    codeUpper === "SQLITE_CANTOPEN" ||
    codeUpper === "SQLITE_READONLY" ||
    codeUpper === "SQLITE_CORRUPT" ||
    code === "10" || // SQLITE_IOERR
    code === "13" || // SQLITE_FULL
    code === "14" || // SQLITE_CANTOPEN
    lower.includes("disk i/o error") ||
    lower.includes("database or disk is full") ||
    lower.includes("unable to open database") ||
    lower.includes("readonly database")
  ) {
    if (
      codeUpper === "SQLITE_CORRUPT" ||
      lower.includes("database disk image is malformed") ||
      lower.includes("file is not a database")
    ) {
      return new StoreCorruptedRecordError(msg || "SQLite database corrupted", err);
    }
    return new StoreUnavailableError(msg || "SQLite store unavailable", err);
  }

  // Constraint / schema
  if (
    codeUpper === "SQLITE_ERROR" ||
    codeUpper === "SQLITE_SCHEMA" ||
    lower.includes("no such table") ||
    lower.includes("no such column") ||
    (lower.includes("has no column") && lower.includes("table"))
  ) {
    if (lower.includes("no such table") || lower.includes("no such column")) {
      return new StoreInvalidSchemaError(msg || "Store schema invalid", err);
    }
  }

  // FS / open errors
  if (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOSPC" ||
    lower.includes("eacces") ||
    lower.includes("enoent") ||
    lower.includes("enospc")
  ) {
    return new StoreUnavailableError(msg || "Store unavailable", err);
  }

  // Default: unavailable (retryable) for unknown driver failures —
  // better than converting uncertain outcomes into hard conflicts.
  return new StoreUnavailableError(msg || "Store unavailable", err);
}

/**
 * True when the error looks like a raw driver/SQLite/FS failure (not app logic).
 * Already-classified {@link StoreError} instances are not raw driver failures.
 */
export function isLikelyDriverFailure(err: unknown): boolean {
  if (err instanceof StoreError) return false;
  const code = readCode(err);
  if (code !== undefined && code.length > 0) return true;
  const lower = readMessage(err).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("sqlite") ||
    lower.includes("database is locked") ||
    lower.includes("no such table") ||
    lower.includes("no such column") ||
    lower.includes("disk i/o") ||
    lower.includes("unable to open database") ||
    lower.includes("readonly database") ||
    lower.includes("constraint")
  );
}

/**
 * Wrap a store op (sync or async): rethrow StoreError; map driver failures.
 */
export async function withMappedErrors<T>(fn: () => T | Promise<T>): Promise<T> {
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
export async function withMappedTransaction<T>(run: () => T | Promise<T>): Promise<T> {
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
