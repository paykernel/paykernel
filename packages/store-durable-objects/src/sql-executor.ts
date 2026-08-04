/**
 * Narrow synchronous Durable Object SQL executor over SqlStorageLike.
 *
 * DO SQLite (`storage.sql.exec`) is **synchronous**. Claims must use:
 * - single-statement INSERT … ON CONFLICT … RETURNING (preferred), and/or
 * - multi-statement only inside `storage.transactionSync` (sync callback, no await).
 *
 * NEVER issue BEGIN/COMMIT via sql.exec — use transactionSync only.
 * Fully consume cursors with `.toArray()` before any await (no snapshot isolation).
 *
 * Verified against CF DO SQLite storage API docs (2026-08-03).
 */

import type { SqlExecutor } from "@paykernel/internal-sql-store";
import type { DoStorageLike, SqlStorageLike } from "./types";

/**
 * Minimal sync SQL port used by store factories and migrate helpers.
 * Stores depend only on this shape — never on cloudflare:workers types.
 */
export type DoExecutor = {
  /**
   * Run a query that returns rows (SELECT, or write with RETURNING).
   * Placeholders: `?`. Params must be bound — never string-interpolated.
   * Cursor is fully consumed via toArray() before return.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): T[];

  /**
   * Execute a write; returns affected row count when known.
   */
  run(sql: string, params?: readonly unknown[]): { changes: number };

  /**
   * Run `fn` inside storage.transactionSync (sync callback only — no await).
   * Nested calls join the outer transaction when depth-tracked.
   */
  transaction<T>(fn: () => T): T;

  /**
   * Optional async-capable outer transaction for store `withTransaction`.
   * Nested sync {@link DoExecutor.transaction} joins this scope.
   * Still: do not await external I/O while holding the lock.
   */
  runInTransaction?<T>(fn: () => Promise<T> | T): Promise<T>;
};

const FORBIDDEN_TXN_RE =
  /^\s*(BEGIN|COMMIT|ROLLBACK|END)(\s|;|$)/i;

/**
 * Create a {@link DoExecutor} over Durable Object storage (or mock).
 *
 * Does **not** migrate. Does **not** hold transactions across external I/O.
 */
export function createDoExecutor(storage: DoStorageLike): DoExecutor {
  let depth = 0;
  /** When true, internal BEGIN/COMMIT/ROLLBACK for async withTransaction are allowed. */
  let allowTxnControl = false;

  function execSql(
    sql: string,
    params?: readonly unknown[],
  ): Record<string, unknown>[] {
    if (!allowTxnControl && FORBIDDEN_TXN_RE.test(sql)) {
      throw new Error(
        "DoExecutor: BEGIN/COMMIT/ROLLBACK via sql.exec is forbidden; use transactionSync",
      );
    }
    const bindings = params !== undefined ? [...params] : [];
    const cursor = storage.sql.exec(sql, ...bindings);
    // Consume fully before any await (policy: cursor-before-await).
    return cursor.toArray();
  }

  function changesAfter(): number {
    try {
      const rows = storage.sql.exec("SELECT changes() AS c").toArray();
      const c = rows[0]?.c;
      if (typeof c === "number") return c;
      if (typeof c === "bigint") return Number(c);
      return 0;
    } catch {
      return 0;
    }
  }

  const executor: DoExecutor = {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): T[] {
      return execSql(sql, params) as T[];
    },

    run(sql: string, params?: readonly unknown[]): { changes: number } {
      execSql(sql, params);
      return { changes: changesAfter() };
    },

    transaction<T>(fn: () => T): T {
      if (depth > 0) {
        // Nested: join outer transaction
        return fn();
      }
      depth += 1;
      try {
        return storage.transactionSync(() => {
          return fn();
        });
      } finally {
        depth -= 1;
      }
    },
  };

  /**
   * Interactive write transaction for store `withTransaction`.
   *
   * - Sync callbacks: `storage.transactionSync` (preferred on real DO).
   * - Async callbacks: internal BEGIN IMMEDIATE … COMMIT/ROLLBACK via sql.exec
   *   (allowed only here; public run/query still forbid BEGIN/COMMIT).
   *   Real CF DO prefers single-statement claims; mock DO SQL supports this path
   *   for conformance. Still: do not await external provider I/O while holding
   *   the lock (claim → commit → external work → complete).
   */
  executor.runInTransaction = async <T>(
    fn: () => Promise<T> | T,
  ): Promise<T> => {
    if (depth > 0) {
      return await fn();
    }

    // Probe: if callback is sync, prefer transactionSync.
    // We cannot know without invoking; use BEGIN path that works for both
    // sync and async under mock SQLite and DO storage that accepts BEGIN.
    depth += 1;
    allowTxnControl = true;
    try {
      execSql("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        execSql("COMMIT");
        return result;
      } catch (err) {
        try {
          execSql("ROLLBACK");
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      }
    } catch (err) {
      // If BEGIN is rejected (some DO environments), fall back to transactionSync
      // for purely sync work only.
      const msg = err instanceof Error ? err.message : String(err);
      if (/begin/i.test(msg) || /transaction/i.test(msg)) {
        depth -= 1;
        allowTxnControl = false;
        const maybe = fn();
        if (maybe !== null && typeof maybe === "object" && "then" in maybe) {
          // Cannot wrap async without BEGIN support.
          return await maybe;
        }
        depth += 1;
        try {
          return storage.transactionSync(() => maybe as T);
        } finally {
          depth -= 1;
        }
      }
      throw err;
    } finally {
      if (depth > 0) depth -= 1;
      allowTxnControl = false;
    }
  };

  return executor;
}

/**
 * Create a {@link DoExecutor} over a bare SqlStorageLike with a synthetic
 * transactionSync that does not provide real atomic multi-statement rollback
 * unless the caller supplies a full DoStorageLike. Prefer createDoExecutor.
 */
export function createDoExecutorFromSql(
  sql: SqlStorageLike,
  transactionSync?: <T>(cb: () => T) => T,
): DoExecutor {
  const storage: DoStorageLike = {
    sql,
    transactionSync:
      transactionSync ??
      (<T>(cb: () => T): T => {
        // No-op wrapper when only sql is available — single-statement claims still safe.
        return cb();
      }),
  };
  return createDoExecutor(storage);
}

/**
 * Adapt {@link DoExecutor} to sql-store {@link SqlExecutor} for migrate/verify.
 * Wraps sync methods so async migrate() can await them.
 */
export function toSqlStoreExecutor(executor: DoExecutor): SqlExecutor {
  return {
    execute: (sql: string, params?: readonly unknown[]) => {
      const result = executor.run(sql, params);
      return Promise.resolve(result);
    },
    query: <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => {
      return Promise.resolve(executor.query<T>(sql, params));
    },
  };
}

/** Type guard: object looks like a DoExecutor. */
export function isDoExecutor(value: unknown): value is DoExecutor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.query === "function" &&
    typeof v.run === "function" &&
    typeof v.transaction === "function"
  );
}

/** Type guard: object looks like DoStorageLike. */
export function isDoStorageLike(value: unknown): value is DoStorageLike {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.transactionSync !== "function") return false;
  const sql = v.sql;
  if (sql === null || typeof sql !== "object") return false;
  return typeof (sql as { exec?: unknown }).exec === "function";
}
