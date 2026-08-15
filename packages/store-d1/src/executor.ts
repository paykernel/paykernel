/**
 * Narrow async D1 executor port (Workers Binding API).
 *
 * D1 is async — design matches TursoExecutor / PostgresExecutor, not local
 * SqliteExecutor sync transactions. Bound parameters only — never interpolate
 * user values into SQL strings. Placeholders: `?` (SQLite).
 *
 * Under the hood: prepare + bind + first/all/run; batch maps to db.batch().
 * Verified against Cloudflare D1 Workers Binding API (pin date in manifest notes).
 *
 * Production createD1Executor does **not** attach `transaction()` on live D1
 * and never issues `BEGIN IMMEDIATE` unless the binding proves same-connection
 * SQLite (mock D1 hook). Store `withTransaction` fails closed with
 * StoreUnsupportedFeatureError. Prefer single-statement UPSERT or `batch()`.
 * Interactive BEGIN lives only in test-utils/mock-d1.ts.
 */

import type { SqlExecutor } from "@paykernel/sql-foundation";
import { mapDriverError } from "./errors";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./types";

/**
 * Minimal async SQL port used by store factories and migrate helpers.
 * Stores must depend only on this port (+ clock + namespace).
 */
export type D1Executor = {
  /**
   * Run a query that returns rows (SELECT, or write with RETURNING).
   * Placeholders: `?`. Params must be bound — never string-interpolated.
   *
   * Uses prepared statement `.all()` so UPSERT/UPDATE/DELETE … RETURNING rows
   * are available (plain writes without RETURNING yield empty results on D1).
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;

  /**
   * Execute a write; returns affected row count when known (via `.run()` meta).
   */
  execute(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ changes: number }>;

  /**
   * Multi-statement transactional batch via D1 `db.batch()`.
   * On statement failure D1 aborts/rolls back the entire sequence.
   * Prefer for multi-statement claims when single-statement UPSERT is not enough.
   */
  batch?(
    statements: Array<{ sql: string; params?: readonly unknown[] }>,
  ): Promise<void>;

  /**
   * Optional interactive write transaction for store `withTransaction`.
   *
   * **Not** attached by {@link createD1Executor} — live D1 rejects interactive
   * `BEGIN IMMEDIATE`. Tests may attach a helper only when they can prove a
   * same-connection mock SQLite. Production stores fail closed with
   * StoreUnsupportedFeatureError when this is missing.
   */
  transaction?<T>(fn: (tx: D1Executor) => Promise<T>): Promise<T>;

  /**
   * Optional: obtain a session-scoped executor (primary-first / bookmark).
   * Requires underlying D1Database.withSession.
   */
  withSession?(constraintOrBookmark?: string): D1Executor;
};

function prepareBound(
  db: D1DatabaseLike,
  sql: string,
  params?: readonly unknown[],
): D1PreparedStatementLike {
  let stmt = db.prepare(sql);
  if (params !== undefined && params.length > 0) {
    stmt = stmt.bind(...params);
  }
  return stmt;
}

function readD1Failure(
  result: { success?: boolean; error?: unknown },
  op: string,
): string | undefined {
  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error;
  }
  if (result.error != null && typeof result.error !== "string") {
    return String(result.error);
  }
  if (result.success === false) {
    return `D1 ${op} failed (success=false)`;
  }
  return undefined;
}

function assertD1Success(
  result: { success?: boolean; error?: unknown },
  op: string,
): void {
  const msg = readD1Failure(result, op);
  if (msg !== undefined) {
    throw mapDriverError(Object.assign(new Error(msg), { code: "D1_ERROR" }));
  }
}

function assertD1BatchResults(results: unknown): void {
  if (!Array.isArray(results)) return;
  for (const item of results) {
    if (item === null || typeof item !== "object") continue;
    assertD1Success(item as { success?: boolean; error?: unknown }, "batch");
  }
}

/**
 * Sessions option for {@link createD1Executor}.
 *
 * - **Default (omitted):** `"first-primary"` when `db.withSession` exists.
 * - **string:** explicit constraint/bookmark.
 * - **`false`:** stay unbound (stale replica reads possible under replication).
 */
export type D1ExecutorOptions = {
  session?: string | false;
};

function resolveExecutorSession(
  db: D1DatabaseLike,
  session?: string | false,
): string | undefined {
  if (session === false) return undefined;
  if (typeof session === "string") return session;
  if (typeof db.withSession === "function") {
    return "first-primary";
  }
  return undefined;
}

/**
 * Proven same-connection SQLite hook (mock D1 only).
 * Live Workers bindings never set this — createD1Executor must not issue
 * BEGIN IMMEDIATE unless this hook is present.
 */
export const D1_SAME_CONNECTION_SQLITE = Symbol.for(
  "@paykernel/store-d1/same-connection-sqlite",
);

export type D1SameConnectionSqliteHook = {
  runTransaction<T>(fn: () => Promise<T>): Promise<T>;
};

function readSameConnectionHook(
  db: object,
): D1SameConnectionSqliteHook | undefined {
  const hook = (db as Record<symbol, unknown>)[D1_SAME_CONNECTION_SQLITE];
  if (
    hook !== null &&
    typeof hook === "object" &&
    typeof (hook as D1SameConnectionSqliteHook).runTransaction === "function"
  ) {
    return hook as D1SameConnectionSqliteHook;
  }
  return undefined;
}

/**
 * Create a narrow {@link D1Executor} over a Workers D1 binding (or mock).
 *
 * Does **not** migrate. Does **not** attach `transaction()` on live D1
 * (no `BEGIN IMMEDIATE`). Mock D1 may prove same-connection SQLite so tests
 * can exercise `withTransaction` rollback. Defaults `session` to
 * `"first-primary"` when `db.withSession` exists; pass `{ session: false }`
 * to stay unbound.
 */
export function createD1Executor(
  db: D1DatabaseLike,
  options: D1ExecutorOptions = {},
): D1Executor {
  const sessionConstraint = resolveExecutorSession(db, options.session);
  const active: D1DatabaseLike =
    sessionConstraint !== undefined && typeof db.withSession === "function"
      ? db.withSession(sessionConstraint)
      : db;

  const executor: D1Executor = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      const stmt = prepareBound(active, sql, params);
      const result = await stmt.all<T>();
      assertD1Success(result, "query");
      return (result.results ?? []) as T[];
    },

    async execute(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ changes: number }> {
      const stmt = prepareBound(active, sql, params);
      const result = await stmt.run();
      assertD1Success(result, "execute");
      const changes =
        result.meta && typeof result.meta.changes === "number"
          ? result.meta.changes
          : 0;
      return { changes };
    },

    async batch(
      statements: Array<{ sql: string; params?: readonly unknown[] }>,
    ): Promise<void> {
      const prepared = statements.map((s) =>
        prepareBound(active, s.sql, s.params),
      );
      const results = await active.batch(prepared);
      assertD1BatchResults(results);
    },
  };

  if (typeof db.withSession === "function") {
    executor.withSession = (constraintOrBookmark?: string): D1Executor => {
      const sessionDb = db.withSession!(constraintOrBookmark);
      // Already session-scoped — do not re-apply the first-primary default.
      return createD1Executor(sessionDb, { session: false });
    };
  }

  // Session wrap may be a new object; fall back to the original binding.
  const sameConnection =
    readSameConnectionHook(active) ?? readSameConnectionHook(db);
  if (sameConnection) {
    // Proven mock / same-connection SQLite only. Live D1 never has this hook.
    executor.transaction = async <T>(
      fn: (tx: D1Executor) => Promise<T>,
    ): Promise<T> => {
      return sameConnection.runTransaction(async () => {
        const tx: D1Executor = {
          query: executor.query,
          execute: executor.execute,
        };
        if (executor.batch) tx.batch = executor.batch;
        if (executor.withSession) tx.withSession = executor.withSession;
        return fn(tx);
      });
    };
  }

  return executor;
}

/**
 * Adapt {@link D1Executor} to sql-foundation {@link SqlExecutor} for migrate/verify.
 */
export function toSqlStoreExecutor(executor: D1Executor): SqlExecutor {
  return {
    execute: async (sql: string, params?: readonly unknown[]) => {
      return executor.execute(sql, params);
    },
    query: async <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => {
      return executor.query<T>(sql, params);
    },
  };
}

/**
 * Type guard: object looks like a D1Executor.
 */
export function isD1Executor(value: unknown): value is D1Executor {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.query === "function" && typeof v.execute === "function";
}

/**
 * Type guard: object looks like a structural D1Database binding.
 */
export function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.prepare === "function" && typeof v.batch === "function";
}
