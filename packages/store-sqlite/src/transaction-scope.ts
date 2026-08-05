/**
 * Nestable BEGIN/COMMIT scope for sync SQLite connections.
 *
 * Depth-tracked so outer `runInTransaction` + inner claim `transaction()`
 * share one connection-level unit of work. COMMIT failures are not swallowed.
 *
 * **SQLITE-1:** Concurrent outer scopes on a shared connection are serialized
 * (async mutex). Same-async-context nested `runInTransaction` joins the open
 * unit of work (AsyncLocalStorage reentrancy). Nested sync `transaction()`
 * still joins when depth > 0. Starting a sync outer while an async outer is
 * active throws rather than joining a unit of work that can still
 * outer-ROLLBACK after a caller already observed `acquired`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
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
  /** Async outer scopes waiting / holding exclusive connection ownership. */
  let outerChain: Promise<void> = Promise.resolve();
  /**
   * Count of async outers queued or running. Used so a concurrent sync outer
   * at depth 0 cannot BEGIN while an async owner holds (or is about to hold)
   * the connection — that path is the SQLITE-1 double-charge hole.
   * Nested sync `transaction()` (depth > 0) still joins the open unit of work.
   */
  let asyncOuterOwners = 0;
  /**
   * Marks the active async transaction context for this scope. Concurrent
   * callers see `undefined` and must take the mutex; reentrant nested
   * `runInTransaction` from the same async stack sees the token and joins.
   * Depth alone is not enough: concurrent work can observe depth > 0 and
   * wrongly join a unit of work that may still ROLLBACK (SQLITE-1).
   */
  const asyncTxnContext = new AsyncLocalStorage<true>();

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

  const runNested = async <T>(
    fn: () => Promise<T> | T,
    mode: SqliteTransactionMode,
  ): Promise<T> => {
    enter(mode);
    try {
      const result = await fn();
      leave(true);
      return result;
    } catch (err) {
      leave(false);
      throw err;
    }
  };

  return {
    transaction<T>(
      fn: () => T,
      options?: { mode?: SqliteTransactionMode },
    ): T {
      // Concurrent sync while an async outer owns the connection must not join
      // (depth>0 alone is not enough — that is the SQLITE-1 hole). Same-context
      // nested claim under the open async scope has asyncTxnContext set and joins.
      if (asyncOuterOwners > 0 && asyncTxnContext.getStore() !== true) {
        throw new Error(
          "SQLite: cannot start a sync transaction while an async " +
            "runInTransaction is active on this connection (SQLITE-1). " +
            "Serialize store access or nest under the open async scope.",
        );
      }
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

      // Same async context as an open outer → join (no mutex; avoids deadlock).
      // Concurrent callers must not use depth>0 alone — that is the SQLITE-1 hole.
      if (asyncTxnContext.getStore() === true) {
        return runNested(fn, mode);
      }

      // Serialize concurrent async *outers* so one cannot observe acquired then
      // lose the lease when another outer ROLLBACKs the shared connection.
      const prev = outerChain;
      let release!: () => void;
      outerChain = new Promise<void>((resolve) => {
        release = resolve;
      });
      asyncOuterOwners += 1;
      try {
        await prev;
        return await asyncTxnContext.run(true, () => runNested(fn, mode));
      } finally {
        asyncOuterOwners -= 1;
        release();
      }
    },
  };
}
