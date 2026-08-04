/**
 * Nestable BEGIN/COMMIT scope for sync SQLite connections.
 *
 * Depth-tracked so outer `runInTransaction` + inner claim `transaction()`
 * share one connection-level unit of work. COMMIT failures are not swallowed.
 */

import type { SqliteTransactionMode } from "./executor";

export type SqlExecFn = (sql: string) => void;

export type TransactionScope = {
  transaction: <T>(
    fn: () => T,
    options?: { mode?: SqliteTransactionMode },
  ) => T;
  runInTransaction: <T>(
    fn: () => Promise<T> | T,
    options?: { mode?: SqliteTransactionMode },
  ) => Promise<T>;
};

function beginSql(mode: SqliteTransactionMode): string {
  if (mode === "exclusive") return "BEGIN EXCLUSIVE";
  if (mode === "immediate") return "BEGIN IMMEDIATE";
  return "BEGIN";
}

/**
 * Create nestable transaction helpers backed by raw `exec("BEGIN…")` / COMMIT / ROLLBACK.
 */
export function createTransactionScope(execSql: SqlExecFn): TransactionScope {
  let depth = 0;
  let aborted = false;

  const enter = (mode: SqliteTransactionMode): void => {
    if (depth === 0) {
      execSql(beginSql(mode));
      aborted = false;
    }
    depth += 1;
  };

  const leave = (ok: boolean): void => {
    if (!ok) aborted = true;
    depth -= 1;
    if (depth !== 0) return;

    const shouldRollback = aborted;
    aborted = false;
    try {
      if (shouldRollback) execSql("ROLLBACK");
      else execSql("COMMIT");
    } catch (err) {
      try {
        execSql("ROLLBACK");
      } catch {
        // Secondary rollback after a failed COMMIT/ROLLBACK — nothing more we can do.
      }
      throw err;
    }
  };

  return {
    transaction<T>(
      fn: () => T,
      options?: { mode?: SqliteTransactionMode },
    ): T {
      const mode = options?.mode ?? "deferred";
      enter(mode);
      try {
        const result = fn();
        leave(true);
        return result;
      } catch (err) {
        leave(false);
        throw err;
      }
    },
    async runInTransaction<T>(
      fn: () => Promise<T> | T,
      options?: { mode?: SqliteTransactionMode },
    ): Promise<T> {
      const mode = options?.mode ?? "immediate";
      enter(mode);
      try {
        const result = await fn();
        leave(true);
        return result;
      } catch (err) {
        leave(false);
        throw err;
      }
    },
  };
}
