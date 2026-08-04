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
    .replace(/(password|secret|token|authorization)=[^\s&]+/gi, "$1=***")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://***")
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
 * Heuristic mapping of node-postgres / postgres.js / Bun SQL / network errors.
 */
export function mapDriverError(err: unknown): StoreError {
  if (err instanceof StoreError) return err;

  const code = readCode(err);
  const rawMsg = readMessage(err);
  const msg = sanitizeMessage(rawMsg, "Store operation failed");
  const lower = rawMsg.toLowerCase();

  // Lease lost is normally thrown by stores on 0-row conditional updates —
  // keep pass-through if already shaped.
  if (code === "lease_lost") {
    return new StoreLeaseLostError(msg, err);
  }

  // Serialization / deadlock (retryable)
  if (
    code === "40001" ||
    code === "40P01" ||
    lower.includes("deadlock") ||
    lower.includes("could not serialize")
  ) {
    return new StoreSerializationFailureError(msg || "Serialization failure", err);
  }

  // Lock / statement timeout
  if (
    code === "57014" ||
    code === "55P03" ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("canceling statement due to statement timeout")
  ) {
    return new StoreTimeoutError(msg || "Store operation timed out", err);
  }

  // Connection / unavailable
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "57P01" || // admin shutdown
    code === "57P02" || // crash shutdown
    code === "57P03" || // cannot connect now
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    code === "08001" ||
    code === "08004" ||
    lower.includes("connection terminated") ||
    lower.includes("connection refused") ||
    lower.includes("not connected") ||
    lower.includes("server closed the connection")
  ) {
    return new StoreUnavailableError(msg || "Store unavailable", err);
  }

  // Schema / undefined table or column
  if (
    code === "42P01" || // undefined_table
    code === "42703" || // undefined_column
    code === "3F000" || // invalid_schema_name
    (lower.includes("does not exist") &&
      (lower.includes("relation") || lower.includes("table") || lower.includes("column")))
  ) {
    return new StoreInvalidSchemaError(msg || "Store schema invalid", err);
  }

  // Data corruption / invalid text representation
  if (code === "22P02" || code === "22021") {
    return new StoreCorruptedRecordError(msg || "Corrupted record", err);
  }

  // Default: unavailable (retryable) for unknown driver failures —
  // better than converting uncertain network outcomes into hard conflicts.
  return new StoreUnavailableError(msg || "Store unavailable", err);
}

/**
 * True when the error looks like a driver/network/SQL failure (not app logic).
 * Used so `withTransaction` does not rewrite user-thrown Errors into StoreUnavailableError.
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
    lower.includes("connection refused") ||
    lower.includes("connection terminated") ||
    lower.includes("server closed the connection") ||
    lower.includes("could not serialize") ||
    lower.includes("deadlock") ||
    lower.includes("statement timeout") ||
    lower.includes("does not exist") ||
    lower.includes("syntax error") ||
    lower.includes("postgres")
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
