/**
 * Faithful mock D1Database for unit/conformance without Workers.
 *
 * Backed by Bun's embedded SQLite (`bun:sqlite`) so RETURNING, ON CONFLICT,
 * and transactional batch semantics match real SQLite/D1 closely.
 *
 * Batch fidelity (approximate D1 `db.batch()`):
 * - Statements run inside `BEGIN IMMEDIATE` … `COMMIT`.
 * - On any statement error, the entire sequence is `ROLLBACK`ed (atomic).
 * - Real D1 also batches as one SQL transaction; this mock uses local SQLite
 *   IMMEDIATE locks. It does **not** simulate D1 remote latency, statement
 *   size limits, or multi-region replication — only local atomicity.
 *
 * Only used from tests — production package root never imports bun:sqlite.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../types";

export type MockD1Options = {
  /** Optional path; default :memory: */
  path?: string;
  /**
   * When true, withSession returns a session-tagged binding (tracks constraint).
   * Default true so sessions.d1.test.ts can exercise the API.
   */
  sessions?: boolean;
};

/** Observation of a prepare/bind/execute chain for assert-only tests. */
type MockD1StatementTrace = {
  sql: string;
  /** Bound parameter values (via `.bind(...)`), never interpolated into SQL. */
  boundParams: readonly unknown[];
  method: "first" | "all" | "run";
};

export type MockD1Handle = {
  db: D1DatabaseLike;
  /** Underlying Bun SQLite handle (for direct asserts / close). */
  sqlite: Database;
  /** Last withSession constraint (if any). */
  lastSessionConstraint: string | undefined;
  /** Number of times `prepare(sql)` was called. */
  prepareCount: number;
  /** Number of times `.bind(...)` was called. */
  bindCount: number;
  /**
   * Chronological first/all/run invocations with final SQL + bound params.
   * `createD1Executor` must only issue prepared + bound statements (no
   * interpolating user values into the SQL string).
   */
  statementTraces: MockD1StatementTrace[];
  /** Clear counters/traces between test phases. */
  resetTraces: () => void;
  close: () => void;
};

type BoundStmt = {
  sql: string;
  params: SQLQueryBindings[];
  sqlite: Database;
  onBind: () => void;
  onExecute: (method: "first" | "all" | "run", params: readonly unknown[]) => void;
};

function asBindings(values: unknown[]): SQLQueryBindings[] {
  return values as SQLQueryBindings[];
}

function createPrepared(state: BoundStmt): D1PreparedStatementLike {
  const self: D1PreparedStatementLike = {
    bind(...values: unknown[]): D1PreparedStatementLike {
      state.onBind();
      return createPrepared({
        ...state,
        params: [...state.params, ...asBindings(values)],
      });
    },
    async first<T = Record<string, unknown>>(
      colName?: string,
    ): Promise<T | null> {
      state.onExecute("first", state.params);
      const rows = runQuery(state.sqlite, state.sql, state.params);
      const row = rows[0];
      if (!row) return null;
      if (colName !== undefined) {
        return (row[colName] as T) ?? null;
      }
      return row as T;
    },
    async all<T = Record<string, unknown>>(): Promise<{
      results: T[];
      success: boolean;
      meta?: { changes?: number };
    }> {
      state.onExecute("all", state.params);
      const rows = runQuery(state.sqlite, state.sql, state.params) as T[];
      const changes = state.sqlite.query("SELECT changes() AS c").get() as
        | { c: number }
        | null;
      return {
        results: rows,
        success: true,
        meta: { changes: changes?.c ?? 0 },
      };
    },
    async run(): Promise<{
      success: boolean;
      meta?: { changes?: number };
      results?: unknown[];
    }> {
      // Prefer all()-style so RETURNING still works if callers use run().
      // Count as run (executor.execute uses .run()).
      state.onExecute("run", state.params);
      const rows = runQuery(state.sqlite, state.sql, state.params);
      const changes = state.sqlite.query("SELECT changes() AS c").get() as
        | { c: number }
        | null;
      return {
        success: true,
        meta: { changes: changes?.c ?? 0 },
        results: rows,
      };
    },
  };
  return self;
}

function runQuery(
  sqlite: Database,
  sql: string,
  params: SQLQueryBindings[],
): Record<string, unknown>[] {
  const stmt = sqlite.prepare(sql);
  // Bun sqlite: .all(...params) returns rows for SELECT/RETURNING.
  try {
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows ?? [];
  } catch (err) {
    // Some write statements without RETURNING may throw with .all — fall back.
    try {
      stmt.run(...params);
      return [];
    } catch {
      throw err;
    }
  }
}

/**
 * Create an in-memory (or file) mock D1DatabaseLike + handle.
 */
export function createMockD1(options: MockD1Options = {}): MockD1Handle {
  const path = options.path ?? ":memory:";
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA foreign_keys = ON;");

  let lastSessionConstraint: string | undefined;
  let prepareCount = 0;
  let bindCount = 0;
  const statementTraces: MockD1StatementTrace[] = [];

  function makeDb(sessionTag?: string): D1DatabaseLike {
    const db: D1DatabaseLike = {
      prepare(query: string): D1PreparedStatementLike {
        prepareCount += 1;
        return createPrepared({
          sql: query,
          params: [],
          sqlite,
          onBind: () => {
            bindCount += 1;
          },
          onExecute: (method, params) => {
            statementTraces.push({
              sql: query,
              boundParams: [...params],
              method,
            });
          },
        });
      },
      async batch<T = unknown>(
        statements: D1PreparedStatementLike[],
      ): Promise<T[]> {
        // D1 batch is a SQL transaction: abort/rollback entire sequence on error.
        // Fidelity: local BEGIN IMMEDIATE approximates D1 batch atomicity only.
        const results: T[] = [];
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          for (const stmt of statements) {
            const r = await stmt.all();
            results.push(r as T);
          }
          sqlite.exec("COMMIT");
          return results;
        } catch (err) {
          try {
            sqlite.exec("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw err;
        }
      },
      async exec(query: string): Promise<{ count: number; duration: number }> {
        // Split on semicolons carefully enough for tests (no BEGIN/COMMIT required).
        const parts = query
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        let count = 0;
        for (const part of parts) {
          sqlite.exec(part);
          count += 1;
        }
        return { count, duration: 0 };
      },
    };

    if (options.sessions !== false) {
      db.withSession = (constraintOrBookmark?: string): D1DatabaseLike => {
        lastSessionConstraint = constraintOrBookmark;
        // Same underlying SQLite; tag is observational for tests.
        // Session-scoped binding shares counters/traces with the parent handle.
        return makeDb(constraintOrBookmark ?? sessionTag);
      };
    }

    return db;
  }

  const db = makeDb();

  return {
    db,
    sqlite,
    get lastSessionConstraint() {
      return lastSessionConstraint;
    },
    get prepareCount() {
      return prepareCount;
    },
    get bindCount() {
      return bindCount;
    },
    statementTraces,
    resetTraces: () => {
      prepareCount = 0;
      bindCount = 0;
      statementTraces.length = 0;
    },
    close: () => {
      try {
        sqlite.close();
      } catch {
        /* ignore */
      }
    },
  };
}
