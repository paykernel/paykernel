/**
 * Recommended SQLite pragmas for single-host production deployments.
 *
 * Call explicitly from application bootstrap or driver helpers —
 * not auto-applied on every store create.
 */

import type { SqliteExecutor } from "./executor";

export type RecommendedPragmaOptions = {
  /**
   * PRAGMA busy_timeout = N (milliseconds).
   * Default 5000 when applying recommended settings.
   */
  busyTimeoutMs?: number;
  /**
   * When true, set `PRAGMA journal_mode = WAL`.
   * File-backed only — `:memory:` does not use durable WAL the same way.
   * Default false (caller opts in for persistent DBs).
   */
  wal?: boolean;
  /**
   * When true (default), `PRAGMA foreign_keys = ON`.
   */
  foreignKeys?: boolean;
};

/**
 * Apply recommended pragmas for single-host SQLite deployments.
 *
 * Recommendations (14.1 / 14.3 / 14.5):
 * - `busy_timeout` so concurrent writers wait instead of failing immediately
 * - WAL for persistent file-backed multi-connection same-host apps
 * - `foreign_keys = ON`
 *
 * Does not migrate schema. Does not open databases.
 */
export function applyRecommendedPragmas(
  executor: SqliteExecutor,
  options: RecommendedPragmaOptions = {},
): void {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (Number.isFinite(busyTimeoutMs) && busyTimeoutMs >= 0) {
    // Integer only — never interpolate untrusted values beyond number check.
    const n = Math.floor(busyTimeoutMs);
    executor.run(`PRAGMA busy_timeout = ${n}`);
  }

  if (options.foreignKeys !== false) {
    executor.run("PRAGMA foreign_keys = ON");
  }

  if (options.wal === true) {
    // WAL is a recommendation for file-backed DBs; callers should not enable for :memory: only workflows.
    executor.run("PRAGMA journal_mode = WAL");
  }
}
