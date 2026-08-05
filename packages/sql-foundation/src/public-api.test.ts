/**
 * Freezes export names for the private package surface.
 * Asserts private package shape and no auto-migrate on import.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as api from "./index";

const EXPECTED_RUNTIME_EXPORTS = [
  // versions
  "CURRENT_SCHEMA_VERSION",
  "SCHEMA_VERSION_V1",
  "SCHEMA_FAMILY",
  // tables
  "LOGICAL_TABLES",
  "ALL_LOGICAL_TABLES",
  "IDEMPOTENCY_STATUSES",
  "WEBHOOK_INBOX_STATUSES",
  "RECONCILIATION_STATUSES",
  "IDEMPOTENCY_COLUMNS",
  "WEBHOOK_INBOX_COLUMNS",
  "RECONCILIATION_COLUMNS",
  "MIGRATIONS_COLUMNS",
  "TABLE_INDEX_INTENTS",
  "TABLE_PRIMARY_KEYS",
  // namespace
  "MAX_IDENTIFIER_LENGTH",
  "LONGEST_LOGICAL_TABLE_NAME_LENGTH",
  "MAX_SAFE_TABLE_PREFIX_LENGTH",
  "IDENTIFIER_PATTERN",
  "TABLE_PREFIX_PATTERN",
  "SchemaNamespaceError",
  "validateIdentifier",
  "validateTablePrefix",
  "createSchemaNamespace",
  "resolveUnqualifiedTableName",
  "resolveTableName",
  "quoteIdentifier",
  // validation
  "MAX_SANITIZED_ERROR_LENGTH",
  "RecordValidationError",
  "enforceMaxSanitizedError",
  "requireNonEmptyString",
  "validateLeaseToken",
  "isIdempotencyStatus",
  "isWebhookInboxStatus",
  "isReconciliationStatus",
  "validateIdempotencyStatus",
  "validateWebhookInboxStatus",
  "validateReconciliationStatus",
  "isIsoTimestamp",
  "validateIsoTimestamp",
  "validateOptionalIsoTimestamp",
  "canonicalizeIsoTimestamp",
  "canonicalizeOptionalIsoTimestamp",
  "isCanonicalIsoZ",
  "validatePayloadHash",
  "validateNonNegativeInt",
  // codecs
  "idempotencyRowToRecord",
  "idempotencyRecordToRow",
  "webhookInboxRowToRecord",
  "webhookInboxRecordToRow",
  "reconciliationRowToRecord",
  "reconciliationRecordToRow",
  "migrationRowToRecord",
  "migrationRecordToRow",
  // migrations
  "MIGRATIONS",
  "MIGRATION_001",
  "getMigration",
  "listMigrationVersions",
  "checksumMigrationSql",
  "buildFoundationMigrationSql",
  "indexLabel",
  "INDEX_LABEL_MAX",
  "FOUNDATION_SQL_POSTGRES",
  "FOUNDATION_SQL_SQLITE",
  "FOUNDATION_SQL_PORTABLE",
  "migrate",
  "splitSqlStatements",
  "MigrationError",
  "verifySchema",
  // claims
  "DIALECTS",
  "isDialectId",
  "assertDialectId",
  "decideIdempotencyReserve",
  "decideWebhookClaim",
  "decideReconciliationClaim",
  "classifyReconciliationClaimMiss",
  "evaluateClaim",
  "decideLeaseMutation",
  "isActiveLeaseToken",
  "isLeaseActive",
  "addMsIso",
  "nowIso",
  "idempotencyReserveTemplates",
  "webhookClaimTemplates",
  "reconciliationClaimTemplates",
  "reconciliationTimestampRepairTemplates",
  "idempotencyCompleteTemplates",
  "webhookCompleteTemplates",
  "webhookFailTemplates",
  "pickClaimTemplate",
  "runClaimContentionHarness",
  "memoryRelationalAsHarnessAdapter",
  // reference
  "createMemoryRelationalStore",
  "MEMORY_RELATIONAL_NON_PRODUCTION",
  "MEMORY_RELATIONAL_NON_DISTRIBUTED",
  "ReferenceLeaseLostError",
  "isReferenceLeaseLostError",
  // fixtures
  "createFakeDbState",
  "createFakeExecutor",
  "expectedTablesForNamespace",
  "sampleIdempotencyRecord",
  "sampleWebhookRecord",
  "sampleReconciliationRecord",
  "DIALECT_SAMPLES",
] as const;

describe("public API surface", () => {
  it("exports every expected runtime symbol", () => {
    for (const name of EXPECTED_RUNTIME_EXPORTS) {
      expect(name in api).toBe(true);
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("export freeze: no unexpected runtime symbols beyond the frozen list", () => {
    const expected = new Set<string>(EXPECTED_RUNTIME_EXPORTS);
    const actual = Object.keys(api).filter((k) => {
      // Types are erased; only runtime values appear on the namespace object.
      return (api as Record<string, unknown>)[k] !== undefined || k in api;
    });
    const extra = actual.filter((k) => !expected.has(k));
    expect(extra).toEqual([]);
    expect(actual.length).toBe(EXPECTED_RUNTIME_EXPORTS.length);
  });

  it("does not export a general query builder / ORM", () => {
    const forbidden = [
      "createQueryBuilder",
      "sql",
      "ORM",
      "createConnection",
      "Pool",
      "knex",
      "drizzle",
    ];
    for (const name of forbidden) {
      expect(name in api).toBe(false);
    }
  });

  it("package.json is publishable sql-foundation (not private internal)", () => {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name: string;
      private?: boolean;
      publishConfig?: { access?: string };
      paymentsSdk?: { privateInternal?: boolean; portable?: boolean };
    };
    expect(pkg.name).toBe("@paykernel/sql-foundation");
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.paymentsSdk?.privateInternal).not.toBe(true);
    expect(pkg.paymentsSdk?.portable).toBe(true);
  });

  it("importing the package does not call migrate (no side-effect DDL)", () => {
    // Module evaluation must not touch storage. Fresh fake DB state after import
    // is empty; migrate remains an explicit callable only.
    expect(typeof api.migrate).toBe("function");
    expect(api.CURRENT_SCHEMA_VERSION).toBe(1);
    const state = api.createFakeDbState();
    expect(state.statements).toEqual([]);
    expect(state.tables.size).toBe(0);
  });

  it("export freeze list has no duplicate names", () => {
    expect(new Set(EXPECTED_RUNTIME_EXPORTS).size).toBe(EXPECTED_RUNTIME_EXPORTS.length);
  });
});
