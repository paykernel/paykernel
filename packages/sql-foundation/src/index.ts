/**
 * @paykernel/sql-foundation
 *
 * Publishable shared relational foundation: schemas, codecs, migrations, claim algorithms.
 * Not a general ORM. Not private-only.
 *
 * CRITICAL: migrate() is never invoked at module load or from this barrel's
 * top-level code. Callers must invoke migrate/verify explicitly.
 */

// ─── Schema versions ─────────────────────────────────────────────────────────
export { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_V1, SCHEMA_FAMILY } from "./schema/versions";

// ─── Tables ──────────────────────────────────────────────────────────────────
export {
  LOGICAL_TABLES,
  ALL_LOGICAL_TABLES,
  IDEMPOTENCY_STATUSES,
  WEBHOOK_INBOX_STATUSES,
  RECONCILIATION_STATUSES,
  IDEMPOTENCY_COLUMNS,
  WEBHOOK_INBOX_COLUMNS,
  RECONCILIATION_COLUMNS,
  MIGRATIONS_COLUMNS,
  TABLE_INDEX_INTENTS,
  TABLE_PRIMARY_KEYS,
} from "./schema/tables";
export type {
  LogicalTableName,
  IdempotencyStatusSql,
  WebhookInboxStatusSql,
  ReconciliationStatusSql,
} from "./schema/tables";

// ─── Namespace ───────────────────────────────────────────────────────────────
export {
  MAX_IDENTIFIER_LENGTH,
  LONGEST_LOGICAL_TABLE_NAME_LENGTH,
  MAX_SAFE_TABLE_PREFIX_LENGTH,
  IDENTIFIER_PATTERN,
  TABLE_PREFIX_PATTERN,
  SchemaNamespaceError,
  validateIdentifier,
  validateTablePrefix,
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  resolveTableName,
  quoteIdentifier,
} from "./schema/namespace";
export type { SchemaNamespaceConfig, ResolvedSchemaNamespace } from "./schema/namespace";

// ─── Validation ──────────────────────────────────────────────────────────────
export {
  MAX_SANITIZED_ERROR_LENGTH,
  RecordValidationError,
  enforceMaxSanitizedError,
  requireNonEmptyString,
  validateLeaseToken,
  isIdempotencyStatus,
  isWebhookInboxStatus,
  isReconciliationStatus,
  validateIdempotencyStatus,
  validateWebhookInboxStatus,
  validateReconciliationStatus,
  isIsoTimestamp,
  validateIsoTimestamp,
  validateOptionalIsoTimestamp,
  canonicalizeIsoTimestamp,
  canonicalizeOptionalIsoTimestamp,
  isCanonicalIsoZ,
  validatePayloadHash,
  validateNonNegativeInt,
} from "./codecs/validation";

// ─── Row codecs ──────────────────────────────────────────────────────────────
export {
  idempotencyRowToRecord,
  idempotencyRecordToRow,
  webhookInboxRowToRecord,
  webhookInboxRecordToRow,
  reconciliationRowToRecord,
  reconciliationRecordToRow,
  migrationRowToRecord,
  migrationRecordToRow,
  serializeResultJson,
  MAX_RESULT_JSON_BYTES,
} from "./codecs/rows";
export type {
  IdempotencyRecordShape,
  WebhookInboxRecordShape,
  ReconciliationRecordShape,
  MigrationRecordShape,
  IdempotencySqlRow,
  WebhookInboxSqlRow,
  ReconciliationSqlRow,
  MigrationSqlRow,
} from "./codecs/rows";

// ─── Migrations ──────────────────────────────────────────────────────────────
export {
  MIGRATIONS,
  MIGRATION_001,
  getMigration,
  listMigrationVersions,
  checksumMigrationSql,
} from "./migrations/metadata";
export type { MigrationDefinition, MigrationSqlBody } from "./migrations/metadata";
export {
  buildFoundationMigrationSql,
  indexLabel,
  INDEX_LABEL_MAX,
  FOUNDATION_SQL_POSTGRES,
  FOUNDATION_SQL_SQLITE,
  FOUNDATION_SQL_PORTABLE,
} from "./migrations/definitions";
export {
  migrate,
  splitSqlStatements,
  MigrationError,
  MIGRATE_HAS_PORTABLE_LOCK,
} from "./migrations/migrate";
export type { SqlExecutor, MigrateOptions, MigrateResult } from "./migrations/migrate";
export { verifySchema } from "./migrations/verify";
export type { VerifySchemaOptions, VerifySchemaResult } from "./migrations/verify";

// ─── Claims ──────────────────────────────────────────────────────────────────
export type { DialectId } from "./claims/dialect";
export { DIALECTS, isDialectId, assertDialectId } from "./claims/dialect";
export {
  decideIdempotencyReserve,
  decideWebhookClaim,
  decideReconciliationClaim,
  classifyIdempotencyReserveMiss,
  classifyReconciliationClaimMiss,
  classifyWebhookClaimMiss,
  evaluateClaim,
  decideLeaseMutation,
  isActiveLeaseToken,
  isLeaseActive,
  addMsIso,
  nowIso,
} from "./claims/algorithm";
export type {
  ClaimClock,
  IdempotencyReserveInput,
  IdempotencyReserveDecision,
  IdempotencyExistingSnapshot,
  IdempotencyReserveMissKind,
  IdempotencyReserveMissSnapshot,
  WebhookClaimInput,
  WebhookClaimDecision,
  WebhookExistingSnapshot,
  WebhookClaimMissKind,
  WebhookClaimMissSnapshot,
  ReconciliationClaimInput,
  ReconciliationClaimDecision,
  ReconciliationExistingSnapshot,
  ReconciliationClaimMissKind,
  ReconciliationClaimMissSnapshot,
  EvaluateClaimRequest,
  EvaluateClaimResult,
  LeaseMutationInput,
  LeaseMutationDecision,
  LeaseMutationKind,
} from "./claims/algorithm";
export {
  idempotencyReserveTemplates,
  webhookClaimTemplates,
  reconciliationClaimTemplates,
  reconciliationTimestampRepairTemplates,
  webhookTimestampRepairTemplates,
  idempotencyTimestampRepairTemplates,
  idempotencyCompleteTemplates,
  webhookCompleteTemplates,
  webhookFailTemplates,
  pickClaimTemplate,
} from "./claims/templates";
export type { SqlFragment, ClaimTemplateSet } from "./claims/templates";
export { runClaimContentionHarness, memoryRelationalAsHarnessAdapter } from "./claims/harness";
export type {
  ClaimContentionAdapter,
  ContentionReport,
  RunClaimContentionOptions,
  HarnessIdempotencyReserveResult,
  HarnessWebhookClaimResult,
} from "./claims/harness";

// ─── Reference (test-oriented; memory only on main export) ───────────────────
// bun:sqlite reference is intentionally NOT re-exported here so portable
// consumers never pull `bun:sqlite`. The Bun SQLite reference lives only as a
// test helper: `src/reference/bun-sqlite-store.test.ts` (used by claim-contention tests).
export {
  createMemoryRelationalStore,
  MEMORY_RELATIONAL_NON_PRODUCTION,
  MEMORY_RELATIONAL_NON_DISTRIBUTED,
  ReferenceLeaseLostError,
  isReferenceLeaseLostError,
} from "./reference/memory-relational-store";
export type {
  MemoryRelationalStore,
  MemoryRelationalOptions,
} from "./reference/memory-relational-store";

// ─── Fixtures (sample rows / namespace helpers only) ─────────────────────────
// PKG-1: createFakeExecutor is test-only (`./testing.ts`) — it always
// succeeds and must not sit next to migrate() on the root export.
export {
  createFakeDbState,
  expectedTablesForNamespace,
  sampleIdempotencyRecord,
  sampleWebhookRecord,
  sampleReconciliationRecord,
  DIALECT_SAMPLES,
} from "./fixtures/migration-fixtures";
export type { FakeDbState, DialectSample } from "./fixtures/migration-fixtures";
