/**
 * Faithful mock DoStorageLike / SqlStorage for unit/conformance without Workers.
 *
 * Backed by Bun's embedded SQLite (`bun:sqlite`) so RETURNING, ON CONFLICT,
 * and transactionSync rollback semantics match real SQLite closely.
 *
 * transactionSync fidelity:
 * - BEGIN IMMEDIATE … COMMIT on success
 * - ROLLBACK on throw (aborts partial writes)
 *
 * Only used from tests — production package root never imports bun:sqlite.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  DoStorageLike,
  SqlStorageCursorLike,
  SqlStorageLike,
} from "../types";

export type MockDoSqlOptions = {
  /** Optional path; default :memory: */
  path?: string;
  /** Enable mock setAlarm/getAlarm/deleteAlarm. Default true. */
  alarms?: boolean;
};

export type MockDoSqlHandle = {
  storage: DoStorageLike;
  /** Underlying Bun SQLite handle (for direct asserts / close). */
  sqlite: Database;
  /** Last setAlarm scheduled time (ms), if any. */
  lastAlarmMs: number | null;
  /** Number of setAlarm calls. */
  setAlarmCount: number;
  /** Number of transactionSync entries. */
  transactionSyncCount: number;
  /** SQL statements executed (for cursor/bind asserts). */
  sqlTraces: Array<{ sql: string; bindings: readonly unknown[] }>;
  resetTraces: () => void;
  close: () => void;
};

function asBindings(values: unknown[]): SQLQueryBindings[] {
  return values as SQLQueryBindings[];
}

function runQuery(
  sqlite: Database,
  sql: string,
  params: SQLQueryBindings[],
): Record<string, unknown>[] {
  const stmt = sqlite.prepare(sql);
  try {
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows ?? [];
  } catch (err) {
    try {
      stmt.run(...params);
      return [];
    } catch {
      throw err;
    }
  }
}

/**
 * Create an in-memory (or file) mock DoStorageLike + handle.
 */
export function createMockDoSql(options: MockDoSqlOptions = {}): MockDoSqlHandle {
  const path = options.path ?? ":memory:";
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA foreign_keys = ON;");

  let lastAlarmMs: number | null = null;
  let setAlarmCount = 0;
  let transactionSyncCount = 0;
  let txnDepth = 0;
  const sqlTraces: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  const enableAlarms = options.alarms !== false;

  const sql: SqlStorageLike = {
    exec(query: string, ...bindings: unknown[]): SqlStorageCursorLike {
      sqlTraces.push({ sql: query, bindings: [...bindings] });
      const rows = runQuery(sqlite, query, asBindings(bindings));
      return {
        toArray: () => rows,
        one: () => rows[0] ?? null,
      };
    },
  };

  const storage: DoStorageLike = {
    sql,
    transactionSync<T>(callback: () => T): T {
      transactionSyncCount += 1;
      if (txnDepth > 0) {
        return callback();
      }
      txnDepth += 1;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = callback();
        // Reject Promises inside transactionSync (sync-only policy).
        if (
          result !== null &&
          typeof result === "object" &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          sqlite.exec("ROLLBACK");
          throw new Error(
            "transactionSync callback must be synchronous (no Promise/await)",
          );
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        txnDepth -= 1;
      }
    },
  };

  if (enableAlarms) {
    storage.setAlarm = async (scheduledTime: number | Date) => {
      setAlarmCount += 1;
      lastAlarmMs =
        typeof scheduledTime === "number"
          ? scheduledTime
          : scheduledTime.getTime();
    };
    storage.getAlarm = async () => lastAlarmMs;
    storage.deleteAlarm = async () => {
      lastAlarmMs = null;
    };
  }

  return {
    storage,
    sqlite,
    get lastAlarmMs() {
      return lastAlarmMs;
    },
    get setAlarmCount() {
      return setAlarmCount;
    },
    get transactionSyncCount() {
      return transactionSyncCount;
    },
    sqlTraces,
    resetTraces: () => {
      sqlTraces.length = 0;
    },
    close: () => {
      sqlite.close();
    },
  };
}
