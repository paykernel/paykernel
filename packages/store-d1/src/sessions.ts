/**
 * Helpers for D1 Sessions API (withSession / first-primary / bookmarks).
 *
 * Under D1 read replication, queries without a Session may hit replicas and
 * observe stale data after a write. Prefer `first-primary` (or a bookmark)
 * for correctness-critical read-after-write paths.
 *
 * Docs: https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession
 * Verified: 2026-08-03
 */

import type { D1DatabaseLike } from "./types";
import type { D1Executor } from "./executor";
import { createD1Executor } from "./executor";

/** Well-known session constraint: first query goes to primary. */
export const D1_SESSION_FIRST_PRIMARY = "first-primary" as const;

/** Well-known session constraint: first query unconstrained (lowest latency). */
export const D1_SESSION_FIRST_UNCONSTRAINED = "first-unconstrained" as const;

/**
 * True when the binding exposes `withSession`.
 */
export function supportsD1Sessions(db: D1DatabaseLike): boolean {
  return typeof db.withSession === "function";
}

/**
 * Wrap a D1 binding with a session constraint when available.
 * Returns the original db when Sessions API is missing (mocks / older runtimes).
 */
export function withD1Session(
  db: D1DatabaseLike,
  constraintOrBookmark: string = D1_SESSION_FIRST_PRIMARY,
): D1DatabaseLike {
  if (typeof db.withSession === "function") {
    return db.withSession(constraintOrBookmark);
  }
  return db;
}

/**
 * Build a session-scoped executor from a binding (or pass-through if unsupported).
 */
export function createSessionScopedExecutor(
  db: D1DatabaseLike,
  constraintOrBookmark: string = D1_SESSION_FIRST_PRIMARY,
): D1Executor {
  return createD1Executor(db, { session: constraintOrBookmark });
}

/**
 * Obtain a session-scoped executor from an existing executor when possible.
 * Falls back to the original executor if `withSession` is not available.
 */
export function scopeExecutorSession(
  executor: D1Executor,
  constraintOrBookmark: string = D1_SESSION_FIRST_PRIMARY,
): D1Executor {
  if (typeof executor.withSession === "function") {
    return executor.withSession(constraintOrBookmark);
  }
  return executor;
}
