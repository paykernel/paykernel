/**
 * Migration test fixtures (in-memory fake executor + sample rows).
 */

import type { SqlExecutor } from "../migrations/migrate";
import type { DialectId } from "../claims/dialect";
import {
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  type SchemaNamespaceConfig,
} from "../schema/namespace";
import { ALL_LOGICAL_TABLES, LOGICAL_TABLES } from "../schema/tables";
import type {
  IdempotencyRecordShape,
  ReconciliationRecordShape,
  WebhookInboxRecordShape,
} from "../codecs/rows";

export type FakeDbState = {
  tables: Set<string>;
  migrations: Map<number, { name: string; appliedAt: string; checksum: string | null }>;
  statements: string[];
};

export function createFakeDbState(): FakeDbState {
  return {
    tables: new Set(),
    migrations: new Map(),
    statements: [],
  };
}

/**
 * Fake executor that records SQL and simulates CREATE TABLE + migration inserts.
 * Does not auto-migrate on construction.
 */
export function createFakeExecutor(
  state: FakeDbState,
  namespaceConfig: SchemaNamespaceConfig = {},
): SqlExecutor {
  const ns = createSchemaNamespace(namespaceConfig);
  const migTable = resolveUnqualifiedTableName(LOGICAL_TABLES.storageMigrations, ns);

  return {
    execute(sql: string, params?: readonly unknown[]) {
      state.statements.push(sql);
      const s = sql.trim();
      const createMatch = s.match(
        /CREATE TABLE IF NOT EXISTS\s+(?:"([^"]+)"(?:\."([^"]+)")?|([A-Za-z_][A-Za-z0-9_]*))/i,
      );
      if (createMatch) {
        const name = createMatch[2] ?? createMatch[1] ?? createMatch[3] ?? "";
        if (name) state.tables.add(name);
        return { ok: true };
      }
      if (/INSERT INTO/i.test(s) && params && params.length >= 3) {
        // Migration bookkeeping or other inserts — detect by table name in SQL
        if (s.includes(migTable) || /payment_storage_migrations/.test(s)) {
          state.tables.add(migTable);
          state.migrations.set(Number(params[0]), {
            name: String(params[1]),
            appliedAt: String(params[2]),
            checksum: params[3] != null ? String(params[3]) : null,
          });
        }
        return { ok: true };
      }
      return { ok: true };
    },
    query<T = Record<string, unknown>>(sql: string) {
      state.statements.push(sql);
      if (/SELECT version FROM/i.test(sql)) {
        return [...state.migrations.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([version, meta]) => ({
            version,
            name: meta.name,
            applied_at: meta.appliedAt,
            checksum: meta.checksum,
          })) as T[];
      }
      if (/sqlite_master/i.test(sql)) {
        return [...state.tables].map((name) => ({ name })) as T[];
      }
      if (/information_schema/i.test(sql)) {
        return [...state.tables].map((table_name) => ({ table_name })) as T[];
      }
      return [] as T[];
    },
  };
}

/** Expected physical table names for a namespace. */
export function expectedTablesForNamespace(config: SchemaNamespaceConfig = {}): string[] {
  const ns = createSchemaNamespace(config);
  return ALL_LOGICAL_TABLES.map((t) => resolveUnqualifiedTableName(t, ns));
}

export function sampleIdempotencyRecord(
  overrides: Partial<IdempotencyRecordShape> = {},
): IdempotencyRecordShape {
  const now = "2026-01-15T12:00:00.000Z";
  return {
    key: "idemp_key_1",
    status: "reserved",
    fingerprint: "fp_abc",
    leaseOwner: "worker-1",
    leaseToken: "lease_token_1",
    leaseExpiresAt: "2026-01-15T12:00:30.000Z",
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    generation: 1,
    ...overrides,
  };
}

export function sampleWebhookRecord(
  overrides: Partial<WebhookInboxRecordShape> = {},
): WebhookInboxRecordShape {
  const now = "2026-01-15T12:00:00.000Z";
  return {
    key: "wh_evt_1",
    status: "claimed",
    payloadHash: "sha256:deadbeef",
    leaseOwner: "worker-1",
    leaseToken: "lease_token_wh_1",
    leaseExpiresAt: "2026-01-15T12:00:30.000Z",
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    generation: 1,
    ...overrides,
  };
}

export function sampleReconciliationRecord(
  overrides: Partial<ReconciliationRecordShape> = {},
): ReconciliationRecordShape {
  const now = "2026-01-15T12:00:00.000Z";
  return {
    key: "recon_1",
    status: "scheduled",
    subjectId: "pay_123",
    reason: "status_mismatch",
    attempts: 0,
    dueAt: now,
    createdAt: now,
    updatedAt: now,
    generation: 0,
    ...overrides,
  };
}

export type DialectSample = {
  dialect: DialectId;
  label: string;
};

export const DIALECT_SAMPLES: readonly DialectSample[] = [
  { dialect: "postgres", label: "PostgreSQL" },
  { dialect: "sqlite", label: "SQLite" },
] as const;
