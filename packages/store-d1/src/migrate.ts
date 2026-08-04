/**
 * Explicit migrate / verify helpers for the Cloudflare D1 adapter.
 *
 * NEVER call migrate at package import time or inside createD1PaymentStores
 * by default. Operators and tests invoke these explicitly.
 *
 * Dialect: sqlite (sql-store foundation schema + SQLITE claim templates).
 * Migration SQL must not wrap statements in BEGIN/COMMIT for D1 apply path.
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
import type { D1Executor } from "./executor";
import {
  createD1Executor,
  isD1Executor,
  isD1DatabaseLike,
  toSqlStoreExecutor,
} from "./executor";
import type { D1DatabaseLike } from "./types";
import { withMappedErrors } from "./errors";

export type MigrateD1AdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  /** ISO clock for applied_at (optional). */
  nowIso?: string;
  /** Target schema version (default current foundation version). */
  targetVersion?: number;
};

export type VerifyD1AdapterOptions = {
  namespace?: SchemaNamespaceConfig | ResolvedSchemaNamespace;
  expectedVersion?: number;
  listTables?: () => Promise<readonly string[]> | readonly string[];
};

/**
 * Prefer a pure executor (query/execute only). When the value is a D1 binding
 * (prepare+batch), wrap it — even if it also happens to look like an executor.
 */
function resolveExecutor(executorOrDb: D1Executor | D1DatabaseLike): D1Executor {
  if (isD1DatabaseLike(executorOrDb)) {
    return createD1Executor(executorOrDb);
  }
  if (isD1Executor(executorOrDb)) {
    return executorOrDb;
  }
  throw new TypeError(
    "migrateD1Adapter: expected D1Executor or D1DatabaseLike",
  );
}

/**
 * Apply pending foundation migrations for dialect `sqlite`.
 * Idempotent: already-applied versions are skipped.
 *
 * Accepts either a narrow {@link D1Executor} or a Workers D1 binding.
 */
export async function migrateD1Adapter(
  executorOrDb: D1Executor | D1DatabaseLike,
  options: MigrateD1AdapterOptions = {},
): Promise<MigrateResult> {
  return withMappedErrors(async () => {
    const executor = resolveExecutor(executorOrDb);
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
 * Verify expected foundation tables/version for dialect `sqlite`.
 */
export async function verifyD1AdapterSchema(
  executorOrDb: D1Executor | D1DatabaseLike,
  options: VerifyD1AdapterOptions = {},
): Promise<VerifySchemaResult> {
  return withMappedErrors(async () => {
    const executor = resolveExecutor(executorOrDb);
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
