/**
 * Explicit migrate / ensure helpers for the Cloudflare Durable Object adapter.
 *
 * NEVER call migrate at package import time or inside createDoPaymentStores
 * by default. Operators and DO lifecycle invoke these explicitly.
 *
 * Dialect: sqlite (sql-store foundation schema).
 * DO-internal SQL is synchronous; we adapt via toSqlStoreExecutor for migrate().
 *
 * Schema ensure inside a DO constructor via blockConcurrencyWhile is OK IF
 * documented as DO lifecycle — not as auto-migrate on npm import.
 *
 * Do NOT wrap foundation DDL in BEGIN/COMMIT via sql.exec — transactionSync
 * is preferred when multi-statement atomicity is needed during migrate.
 */

import {
  migrate,
  verifySchema,
  type MigrateOptions,
  type MigrateResult,
  type VerifySchemaOptions,
  type VerifySchemaResult,
} from "@paykernel/sql-foundation";
import type {
  SchemaNamespaceConfig,
  ResolvedSchemaNamespace,
} from "@paykernel/sql-foundation";
import type { DoExecutor } from "./sql-executor";
import {
  createDoExecutor,
  isDoExecutor,
  isDoStorageLike,
  toSqlStoreExecutor,
} from "./sql-executor";
import type { DoStorageLike } from "./types";
import { withMappedErrors } from "./errors";

export type MigrateDoAdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  /** ISO clock for applied_at (optional). */
  nowIso?: string;
  /** Target schema version (default current foundation version). */
  targetVersion?: number;
};

export type VerifyDoAdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  expectedVersion?: number;
  listTables?: () => Promise<readonly string[]> | readonly string[];
};

function resolveExecutor(
  storageOrExecutor: DoExecutor | DoStorageLike,
): DoExecutor {
  if (isDoStorageLike(storageOrExecutor)) {
    return createDoExecutor(storageOrExecutor);
  }
  if (isDoExecutor(storageOrExecutor)) {
    return storageOrExecutor;
  }
  throw new TypeError(
    "migrateDoAdapter: expected DoExecutor or DoStorageLike",
  );
}

/**
 * Apply pending foundation migrations for dialect `sqlite`.
 * Idempotent: already-applied versions are skipped.
 *
 * Accepts either a narrow {@link DoExecutor} or {@link DoStorageLike}.
 */
export async function migrateDoAdapter(
  storageOrExecutor: DoExecutor | DoStorageLike,
  options: MigrateDoAdapterOptions = {},
): Promise<MigrateResult> {
  return withMappedErrors(async () => {
    const executor = resolveExecutor(storageOrExecutor);
    const sqlExec = toSqlStoreExecutor(executor);
    const migrateOpts: MigrateOptions = {
      dialect: "sqlite",
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
 * Alias preferred in DO lifecycle docs: ensure schema on an object once.
 * Same as migrateDoAdapter — never called from package import.
 */
export async function ensureDoSchema(
  storageOrExecutor: DoExecutor | DoStorageLike,
  options: MigrateDoAdapterOptions = {},
): Promise<MigrateResult> {
  return migrateDoAdapter(storageOrExecutor, options);
}

/**
 * Verify expected foundation tables/version for dialect `sqlite`.
 */
export async function verifyDoAdapterSchema(
  storageOrExecutor: DoExecutor | DoStorageLike,
  options: VerifyDoAdapterOptions = {},
): Promise<VerifySchemaResult> {
  return withMappedErrors(async () => {
    const executor = resolveExecutor(storageOrExecutor);
    const sqlExec = toSqlStoreExecutor(executor);
    const verifyOpts: VerifySchemaOptions = {
      dialect: "sqlite",
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
