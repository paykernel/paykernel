/**
 * Validated schema namespace configuration.
 *
 * NEVER interpolate unvalidated arbitrary table/schema names into SQL.
 * Always pass through {@link createSchemaNamespace} / {@link resolveTableName}.
 */

import type { LogicalTableName } from "./tables";
import { ALL_LOGICAL_TABLES } from "./tables";

/** Max identifier length (PostgreSQL NAMEDATALEN-1; safe for SQLite too). */
export const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Strict SQL identifier: letter/underscore start, then alphanumerics/underscore.
 * Rejects dots, quotes, semicolons, spaces, and injection fragments.
 */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Table prefix fragment: alphanumerics + underscore only (may start with digit
 * only if combined with letters elsewhere — we still require full IDENTIFIER_PATTERN
 * after optional empty check; prefix itself uses a slightly looser but still safe set).
 */
export const TABLE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

export type SchemaNamespaceConfig = {
  /**
   * Physical table name prefix, e.g. `"pay_"`.
   * Validated: `[A-Za-z0-9_]+`, max length, non-empty when provided.
   */
  tablePrefix?: string;
  /**
   * PostgreSQL schema name, e.g. `"payments"`.
   * Validated identifier; never used as a string dump into SQL without validation.
   */
  sqlSchema?: string;
  /**
   * Enable tenant column.
   * - `true` → column name `"tenant_id"`
   * - `string` → custom validated column name
   * - omitted / false → no tenant column in resolved names (DDL may still define it nullable)
   */
  tenantColumn?: boolean | string;
};

/**
 * Frozen, fully validated namespace. Construct only via {@link createSchemaNamespace}.
 */
export type ResolvedSchemaNamespace = {
  readonly tablePrefix: string;
  readonly sqlSchema: string | undefined;
  readonly tenantColumnEnabled: boolean;
  readonly tenantColumnName: string | undefined;
};

export class SchemaNamespaceError extends Error {
  readonly code = "invalid_namespace" as const;

  constructor(message: string) {
    super(message);
    this.name = "SchemaNamespaceError";
  }
}

function assertNonEmptyString(value: string, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SchemaNamespaceError(`${field} must be a non-empty string`);
  }
}

/**
 * Validate a SQL identifier (schema name, custom tenant column).
 * Rejects injection characters and over-long names.
 */
export function validateIdentifier(value: string, field: string): string {
  assertNonEmptyString(value, field);
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new SchemaNamespaceError(`${field} exceeds max length ${MAX_IDENTIFIER_LENGTH}`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new SchemaNamespaceError(
      `${field} must match ${IDENTIFIER_PATTERN}: got ${JSON.stringify(value)}`,
    );
  }
  // Extra hard reject for common injection fragments even if pattern changes.
  if (/[;'"\\.\s-]/.test(value) || value.includes("--") || value.includes("/*")) {
    throw new SchemaNamespaceError(`${field} contains forbidden characters`);
  }
  return value;
}

/**
 * Validate table prefix fragment (no dots; allows trailing underscore).
 */
export function validateTablePrefix(value: string): string {
  assertNonEmptyString(value, "tablePrefix");
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new SchemaNamespaceError(`tablePrefix exceeds max length ${MAX_IDENTIFIER_LENGTH}`);
  }
  if (!TABLE_PREFIX_PATTERN.test(value)) {
    throw new SchemaNamespaceError(
      `tablePrefix must match ${TABLE_PREFIX_PATTERN}: got ${JSON.stringify(value)}`,
    );
  }
  if (/[;'"\\.\s]/.test(value) || value.includes("--") || value.includes("/*")) {
    throw new SchemaNamespaceError("tablePrefix contains forbidden characters");
  }
  // Prefixed logical names must remain valid identifiers.
  const sample = `${value}payment_idempotency`;
  if (sample.length > MAX_IDENTIFIER_LENGTH) {
    throw new SchemaNamespaceError(
      `tablePrefix + logical table name exceeds max identifier length ${MAX_IDENTIFIER_LENGTH}`,
    );
  }
  if (!IDENTIFIER_PATTERN.test(sample)) {
    throw new SchemaNamespaceError(
      "tablePrefix must yield a valid identifier when prepended to logical table names",
    );
  }
  return value;
}

/**
 * Parse and validate {@link SchemaNamespaceConfig}. Throws {@link SchemaNamespaceError}.
 */
export function createSchemaNamespace(config: SchemaNamespaceConfig = {}): ResolvedSchemaNamespace {
  let tablePrefix = "";
  if (config.tablePrefix !== undefined) {
    tablePrefix = validateTablePrefix(config.tablePrefix);
  }

  let sqlSchema: string | undefined;
  if (config.sqlSchema !== undefined) {
    sqlSchema = validateIdentifier(config.sqlSchema, "sqlSchema");
  }

  let tenantColumnEnabled: boolean;
  let tenantColumnName: string | undefined;
  if (config.tenantColumn === true) {
    tenantColumnEnabled = true;
    tenantColumnName = "tenant_id";
  } else if (typeof config.tenantColumn === "string") {
    tenantColumnEnabled = true;
    tenantColumnName = validateIdentifier(config.tenantColumn, "tenantColumn");
  } else if (config.tenantColumn === false || config.tenantColumn === undefined) {
    tenantColumnEnabled = false;
    tenantColumnName = undefined;
  } else {
    throw new SchemaNamespaceError("tenantColumn must be boolean or a validated identifier string");
  }

  // exactOptionalPropertyTypes: only include optional keys when defined
  const resolved: ResolvedSchemaNamespace = {
    tablePrefix,
    sqlSchema,
    tenantColumnEnabled,
    tenantColumnName,
  };
  return Object.freeze(resolved);
}

/**
 * Unqualified physical table name: `{prefix}{logical}`.
 * Logical name must be a known canonical table (never arbitrary user SQL).
 */
export function resolveUnqualifiedTableName(
  logical: LogicalTableName,
  namespace: ResolvedSchemaNamespace | SchemaNamespaceConfig = {},
): string {
  if (!ALL_LOGICAL_TABLES.includes(logical)) {
    throw new SchemaNamespaceError(`unknown logical table: ${JSON.stringify(logical)}`);
  }
  const ns =
    "tablePrefix" in namespace &&
    typeof (namespace as ResolvedSchemaNamespace).tenantColumnEnabled === "boolean"
      ? (namespace as ResolvedSchemaNamespace)
      : createSchemaNamespace(namespace as SchemaNamespaceConfig);

  const physical = `${ns.tablePrefix}${logical}`;
  // Defensive: re-validate fully resolved name.
  validateIdentifier(physical, "resolved table name");
  return physical;
}

/**
 * Fully qualified table name for SQL templates.
 *
 * - With `sqlSchema`: `"schema"."table"` (double-quoted validated identifiers)
 * - Without: `"table"` only
 *
 * Identifiers are validated before quoting; never pass raw user input here.
 */
export function resolveTableName(
  logical: LogicalTableName,
  namespace: ResolvedSchemaNamespace | SchemaNamespaceConfig = {},
): string {
  const ns =
    "tablePrefix" in namespace &&
    typeof (namespace as ResolvedSchemaNamespace).tenantColumnEnabled === "boolean"
      ? (namespace as ResolvedSchemaNamespace)
      : createSchemaNamespace(namespace as SchemaNamespaceConfig);

  const physical = resolveUnqualifiedTableName(logical, ns);
  if (ns.sqlSchema !== undefined) {
    // Both parts already validated identifiers.
    return `"${ns.sqlSchema}"."${physical}"`;
  }
  return `"${physical}"`;
}

/**
 * Quote a validated identifier for SQL (schema, column, table fragment).
 * Throws if not a valid identifier.
 */
export function quoteIdentifier(identifier: string): string {
  const id = validateIdentifier(identifier, "identifier");
  return `"${id}"`;
}
