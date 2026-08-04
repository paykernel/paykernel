/**
 * Migration metadata: versioned list, names, checksums.
 *
 * Raw SQL builders live in {@link ./definitions.ts}.
 */

import { CURRENT_SCHEMA_VERSION } from "../schema/versions";
import {
  FOUNDATION_SQL_PORTABLE,
  FOUNDATION_SQL_POSTGRES,
  FOUNDATION_SQL_SQLITE,
} from "./definitions";

export type MigrationSqlBody = {
  /** Shared DDL intent when dialects agree (rare for full schemas). */
  portable?: string;
  postgres?: string;
  sqlite?: string;
};

export type MigrationDefinition = {
  version: number;
  name: string;
  sql: MigrationSqlBody;
  /** Optional content fingerprint for drift detection. */
  checksum?: string;
};

/** Migration 001: foundation tables + indexes. */
export const MIGRATION_001: MigrationDefinition = {
  version: 1,
  name: "create_payment_storage_foundation",
  sql: {
    postgres: FOUNDATION_SQL_POSTGRES,
    sqlite: FOUNDATION_SQL_SQLITE,
    portable: FOUNDATION_SQL_PORTABLE,
  },
  checksum: "v1_foundation",
};

/**
 * Ordered migrations. Append-only: never renumber applied versions in the field.
 */
export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([MIGRATION_001]);

export { CURRENT_SCHEMA_VERSION };

/** Lookup migration by version. */
export function getMigration(version: number): MigrationDefinition | undefined {
  return MIGRATIONS.find((m) => m.version === version);
}

/** All migration versions ascending. */
export function listMigrationVersions(): readonly number[] {
  return MIGRATIONS.map((m) => m.version);
}

/**
 * Simple non-crypto checksum of SQL body strings (stable for tests / verify).
 * Not a security hash — adapters may replace with stronger digests.
 */
export function checksumMigrationSql(sql: MigrationSqlBody): string {
  const parts = [sql.portable ?? "", sql.postgres ?? "", sql.sqlite ?? ""].join("\n--dialect--\n");
  let h = 2166136261;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16).padStart(8, "0")}`;
}
