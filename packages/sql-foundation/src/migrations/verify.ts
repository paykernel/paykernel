/**
 * Schema verification helper — explicit only (never on import).
 */

import type { DialectId } from "../claims/dialect";
import { assertDialectId } from "../claims/dialect";
import {
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  type ResolvedSchemaNamespace,
  type SchemaNamespaceConfig,
} from "../schema/namespace";
import { ALL_LOGICAL_TABLES, LOGICAL_TABLES } from "../schema/tables";
import { CURRENT_SCHEMA_VERSION } from "../schema/versions";
import type { SqlExecutor } from "./migrate";

export type VerifySchemaOptions = {
  dialect: DialectId;
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  expectedVersion?: number;
  /**
   * Preferred for fake/in-memory executors: return physical table names present.
   */
  listTables?: () => Promise<readonly string[]> | readonly string[];
};

export type VerifySchemaResult = {
  ok: boolean;
  version: number;
  missing: readonly string[];
  extra?: readonly string[];
  expectedVersion: number;
  errors: readonly string[];
};

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

function expectedPhysicalNames(ns: ResolvedSchemaNamespace): string[] {
  return ALL_LOGICAL_TABLES.map((logical) => resolveUnqualifiedTableName(logical, ns));
}

async function readVersion(executor: SqlExecutor, ns: ResolvedSchemaNamespace): Promise<number> {
  const physical = resolveUnqualifiedTableName(LOGICAL_TABLES.storageMigrations, ns);
  const qualified =
    ns.sqlSchema !== undefined ? `"${ns.sqlSchema}"."${physical}"` : `"${physical}"`;
  try {
    if (executor.query) {
      const rows = await executor.query<{ version: number | string }>(
        `SELECT version FROM ${qualified} ORDER BY version DESC`,
      );
      if (!rows.length) return 0;
      return Number(rows[0]!.version);
    }
    const result = await executor.execute(`SELECT version FROM ${qualified} ORDER BY version DESC`);
    if (Array.isArray(result) && result.length > 0) {
      const row = result[0] as { version?: number | string };
      return Number(row.version ?? 0);
    }
    return 0;
  } catch {
    return 0;
  }
}

async function listPresentTables(
  executor: SqlExecutor,
  options: VerifySchemaOptions,
  ns: ResolvedSchemaNamespace,
  errors: string[],
): Promise<string[]> {
  if (options.listTables) {
    return [...(await options.listTables())].map((n) => n.replace(/"/g, ""));
  }

  if (!executor.query) {
    errors.push("verifySchema requires executor.query or options.listTables to detect tables");
    return [];
  }

  try {
    if (options.dialect === "sqlite") {
      const rows = await executor.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      );
      return rows.map((r) => r.name);
    }
    if (options.dialect === "postgres") {
      const schema = ns.sqlSchema ?? "public";
      const rows = await executor.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [schema],
      );
      return rows.map((r) => r.table_name);
    }
    // generic: no automatic discovery
    errors.push("generic dialect requires options.listTables");
    return [];
  } catch (err) {
    errors.push(`list tables failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Verify expected logical tables exist (after prefix) and version matches.
 *
 * Explicit helper only — never invoked on package import.
 */
export async function verifySchema(
  executor: SqlExecutor,
  options: VerifySchemaOptions,
): Promise<VerifySchemaResult> {
  assertDialectId(options.dialect);
  const ns = resolveNs(options.namespace);
  const expectedVersion = options.expectedVersion ?? CURRENT_SCHEMA_VERSION;
  const expected = expectedPhysicalNames(ns);
  const errors: string[] = [];

  const present = await listPresentTables(executor, options, ns, errors);
  const presentSet = new Set(present);
  const missing = expected.filter((name) => !presentSet.has(name));
  if (missing.length > 0) {
    errors.push(`missing tables: ${missing.join(", ")}`);
  }

  const version = await readVersion(executor, ns);
  if (version !== expectedVersion) {
    errors.push(`schema version ${version} !== expected ${expectedVersion}`);
  }

  const expectedSet = new Set(expected);
  const extra = present.filter(
    (n) =>
      !expectedSet.has(n) &&
      (ns.tablePrefix === "" || n.startsWith(ns.tablePrefix)) &&
      n.includes("payment_"),
  );

  const ok = missing.length === 0 && version === expectedVersion;

  if (extra.length > 0) {
    return {
      ok,
      version,
      missing: Object.freeze([...missing]),
      extra: Object.freeze([...extra]),
      expectedVersion,
      errors: Object.freeze([...errors]),
    };
  }

  return {
    ok,
    version,
    missing: Object.freeze([...missing]),
    expectedVersion,
    errors: Object.freeze([...errors]),
  };
}
