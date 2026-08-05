/**
 * Explicit migrate() helper — NEVER auto-run on package import or construction.
 *
 * Narrow executor interface (not a full ORM). Bound params only.
 */

import type { DialectId } from "../claims/dialect";
import { assertDialectId } from "../claims/dialect";
import {
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  type ResolvedSchemaNamespace,
  type SchemaNamespaceConfig,
} from "../schema/namespace";
import { LOGICAL_TABLES } from "../schema/tables";
import { CURRENT_SCHEMA_VERSION } from "../schema/versions";
import { buildFoundationMigrationSql } from "./definitions";
import { MIGRATIONS, checksumMigrationSql, type MigrationDefinition } from "./metadata";

/**
 * Narrow SQL executor. Adapters wrap their driver here.
 * Prefer prepared statements / bound params for user values.
 * Identifier qualification is done only via validated namespace helpers.
 */
export type SqlExecutor = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  query?<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> | T[];
};

export type MigrateOptions = {
  dialect: DialectId;
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  /** Only 'up' is supported in v1. */
  direction?: "up";
  /**
   * Optional clock for applied_at (ISO). Defaults to Date.now().
   */
  nowIso?: string;
  /**
   * Target version inclusive (default CURRENT_SCHEMA_VERSION).
   */
  targetVersion?: number;
};

export type MigrateResult = {
  applied: readonly number[];
  alreadyApplied: readonly number[];
  currentVersion: number;
};

/**
 * SQLFOUND-1 / FOUND-1 / N10: `migrate()` never acquires a portable cross-dialect
 * advisory lock. Always `false` so callers and tests cannot assume multi-host
 * serialization is provided by this package.
 *
 * Ops must serialize migrate (single migrator job / deploy lock). Adapters may
 * wrap with dialect-specific locks (e.g. Postgres `pg_advisory_lock`) outside
 * this helper.
 */
export const MIGRATE_HAS_PORTABLE_LOCK = false as const;

export class MigrationError extends Error {
  readonly code = "migration_error" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "MigrationError";
  }
}

function resolveNs(
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace,
): ResolvedSchemaNamespace {
  if (
    namespace &&
    typeof (namespace as ResolvedSchemaNamespace).tenantColumnEnabled === "boolean" &&
    "tablePrefix" in namespace
  ) {
    return namespace as ResolvedSchemaNamespace;
  }
  return createSchemaNamespace((namespace as SchemaNamespaceConfig) ?? {});
}

function qualifyTable(logical: string, ns: ResolvedSchemaNamespace): string {
  // Only allow known logical tables.
  const known = Object.values(LOGICAL_TABLES) as string[];
  if (!known.includes(logical)) {
    throw new MigrationError(`refusing to qualify unknown table ${logical}`);
  }
  const physical = resolveUnqualifiedTableName(
    logical as (typeof LOGICAL_TABLES)[keyof typeof LOGICAL_TABLES],
    ns,
  );
  if (ns.sqlSchema !== undefined) {
    return `"${ns.sqlSchema}"."${physical}"`;
  }
  return `"${physical}"`;
}

async function runExecute(
  executor: SqlExecutor,
  sql: string,
  params?: readonly unknown[],
): Promise<unknown> {
  return await executor.execute(sql, params);
}

async function runQuery<T>(
  executor: SqlExecutor,
  sql: string,
  params?: readonly unknown[],
): Promise<T[]> {
  if (executor.query) {
    return (await executor.query<T>(sql, params)) as T[];
  }
  // Fallback: some executors only expose execute that returns rows.
  const result = await executor.execute(sql, params);
  if (Array.isArray(result)) return result as T[];
  return [];
}

function migrationsTableSql(ns: ResolvedSchemaNamespace): string {
  return qualifyTable(LOGICAL_TABLES.storageMigrations, ns);
}

/**
 * Ensure migrations bookkeeping table exists (bootstrap before version reads).
 */
async function ensureMigrationsTable(
  executor: SqlExecutor,
  dialect: DialectId,
  ns: ResolvedSchemaNamespace,
): Promise<void> {
  const mig = migrationsTableSql(ns);
  // Identical enough for postgres / sqlite / generic reference executors.
  void dialect;
  const sql = `
CREATE TABLE IF NOT EXISTS ${mig} (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT
)`.trim();
  await runExecute(executor, sql);
}

async function readAppliedVersions(
  executor: SqlExecutor,
  ns: ResolvedSchemaNamespace,
): Promise<Set<number>> {
  const mig = migrationsTableSql(ns);
  try {
    const rows = await runQuery<{ version: number | string }>(
      executor,
      `SELECT version FROM ${mig} ORDER BY version ASC`,
    );
    const set = new Set<number>();
    for (const row of rows) {
      set.add(Number(row.version));
    }
    return set;
  } catch {
    return new Set();
  }
}

function selectDialectSql(
  migration: MigrationDefinition,
  dialect: DialectId,
  ns: ResolvedSchemaNamespace,
): string {
  const qualify = (logical: string) => qualifyTable(logical, ns);
  if (migration.version === 1 && (dialect === "postgres" || dialect === "sqlite")) {
    return buildFoundationMigrationSql(dialect, qualify);
  }
  if (dialect === "postgres") {
    return migration.sql.postgres ?? migration.sql.portable ?? "";
  }
  if (dialect === "sqlite") {
    return migration.sql.sqlite ?? migration.sql.portable ?? "";
  }
  return migration.sql.portable ?? migration.sql.postgres ?? migration.sql.sqlite ?? "";
}

/**
 * Apply pending migrations. Idempotent: already-applied versions are skipped.
 *
 * **Never** call from package top-level import or production constructors by default.
 *
 * ## Concurrency / multi-host (SQLFOUND-1 / FOUND-1 / N10)
 *
 * {@link MIGRATE_HAS_PORTABLE_LOCK} is **always false**. No portable cross-dialect
 * advisory lock (Postgres `pg_advisory_lock` is not available on SQLite / D1 /
 * generic executors). **Serialize migrate across hosts** (single migrator job or
 * deploy lock). v1 DDL is mostly `IF NOT EXISTS`, but version INSERT after
 * multi-statement DDL can race and future non-idempotent migrations inherit that
 * window. This helper does **not** wrap multi-statement bodies in a portable
 * transaction either (executor surface is execute/query only).
 */
export async function migrate(
  executor: SqlExecutor,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const dialect = assertDialectId(options.dialect);
  if (options.direction !== undefined && options.direction !== "up") {
    throw new MigrationError(`unsupported direction: ${String(options.direction)}`);
  }
  const ns = resolveNs(options.namespace);
  const target = options.targetVersion ?? CURRENT_SCHEMA_VERSION;
  const nowIso = options.nowIso ?? new Date().toISOString();

  await ensureMigrationsTable(executor, dialect, ns);
  const appliedSet = await readAppliedVersions(executor, ns);
  const applied: number[] = [];
  const alreadyApplied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version > target) continue;
    if (appliedSet.has(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }

    const sql = selectDialectSql(migration, dialect, ns);
    if (!sql) {
      throw new MigrationError(`migration ${migration.version} has no SQL for dialect ${dialect}`);
    }

    // Split on semicolon boundaries for multi-statement bodies.
    // Statements are package-authored only (not user input).
    const statements = splitSqlStatements(sql);
    for (const stmt of statements) {
      await runExecute(executor, stmt);
    }

    const checksum = migration.checksum ?? checksumMigrationSql(migration.sql);
    const mig = migrationsTableSql(ns);
    // Bound params for user-facing values (version/name are from our constants).
    if (dialect === "postgres") {
      await runExecute(
        executor,
        `INSERT INTO ${mig} (version, name, applied_at, checksum) VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, nowIso, checksum],
      );
    } else {
      await runExecute(
        executor,
        `INSERT INTO ${mig} (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`,
        [migration.version, migration.name, nowIso, checksum],
      );
    }

    applied.push(migration.version);
    appliedSet.add(migration.version);
  }

  const currentVersion = appliedSet.size === 0 ? 0 : Math.max(...appliedSet.values());

  return {
    applied: Object.freeze(applied),
    alreadyApplied: Object.freeze(alreadyApplied),
    currentVersion,
  };
}

/** Split multi-statement SQL; ignores empty and pure-comment chunks. */
export function splitSqlStatements(sql: string): string[] {
  const parts = sql.split(";");
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Skip comment-only fragments
    const withoutComments = trimmed
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!withoutComments) continue;
    out.push(trimmed);
  }
  return out;
}
