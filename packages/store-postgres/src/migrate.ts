/**
 * Explicit migrate / verify helpers for the PostgreSQL adapter.
 *
 * NEVER call migrate at package import time or inside createPostgres*Store
 * by default. Operators and tests invoke these explicitly.
 */

import {
  migrate,
  verifySchema,
  type MigrateOptions,
  type MigrateResult,
  type VerifySchemaOptions,
  type VerifySchemaResult,
} from "@paykernel/sql-foundation";
import type { SchemaNamespaceConfig, ResolvedSchemaNamespace } from "@paykernel/sql-foundation";
import type { PostgresExecutor } from "./executor";
import { toSqlStoreExecutor } from "./executor";
import { withMappedErrors } from "./errors";

export type MigratePostgresAdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  /** ISO clock for applied_at (optional). */
  nowIso?: string;
  /** Target schema version (default current foundation version). */
  targetVersion?: number;
};

export type VerifyPostgresAdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  expectedVersion?: number;
  listTables?: () => Promise<readonly string[]> | readonly string[];
};

/**
 * Apply pending foundation migrations for dialect `postgres`.
 * Idempotent: already-applied versions are skipped.
 */
export async function migratePostgresAdapter(
  executor: PostgresExecutor,
  options: MigratePostgresAdapterOptions = {},
): Promise<MigrateResult> {
  return withMappedErrors(async () => {
    const sqlExec = toSqlStoreExecutor(executor);
    const migrateOpts: MigrateOptions = {
      dialect: "postgres",
    };
    if (options.namespace !== undefined) migrateOpts.namespace = options.namespace;
    if (options.nowIso !== undefined) migrateOpts.nowIso = options.nowIso;
    if (options.targetVersion !== undefined) {
      migrateOpts.targetVersion = options.targetVersion;
    }
    return migrate(sqlExec, migrateOpts);
  });
}

/**
 * Verify expected foundation tables/version for dialect `postgres`.
 */
export async function verifyPostgresAdapterSchema(
  executor: PostgresExecutor,
  options: VerifyPostgresAdapterOptions = {},
): Promise<VerifySchemaResult> {
  return withMappedErrors(async () => {
    const sqlExec = toSqlStoreExecutor(executor);
    const verifyOpts: VerifySchemaOptions = {
      dialect: "postgres",
    };
    if (options.namespace !== undefined) verifyOpts.namespace = options.namespace;
    if (options.expectedVersion !== undefined) {
      verifyOpts.expectedVersion = options.expectedVersion;
    }
    if (options.listTables !== undefined) {
      verifyOpts.listTables = options.listTables;
    }
    return verifySchema(sqlExec, verifyOpts);
  });
}
