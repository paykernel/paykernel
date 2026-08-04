/**
 * @paykernel/testkit
 *
 * Portable test kit for @paykernel/core:
 * mock gateway, gateway/store conformance suites, fixture safety,
 * and NON-PRODUCTION in-memory stores.
 *
 * Core must NOT depend on this package.
 */

// ─── Mock gateway ────────────────────────────────────────────────────────────
export {
  mockGateway,
  majorToMinor,
  minorToMajor,
  type PaymentState,
} from "./mock/mock-gateway";
export type { MockGateway, MockGatewayOptions } from "./mock/mock-gateway";
export type {
  ScriptedOutcomeName,
  ScriptedPaymentOutcome,
  ScriptedRefundOutcome,
  ScriptedStep,
  ScriptedThrowStep,
  ScriptedWebhookEvent,
  ScriptedOutcomeBase,
  MockRequestRecord,
  HistoryAssertion,
} from "./mock/outcomes";
export {
  defaultPaymentResult,
  defaultRefundResult,
  paymentStatusToOperationOutcome,
} from "./mock/outcomes";
export {
  computeMockWebhookSignature,
  signMockWebhook,
  signWebhook,
  createMockWebhookPayload,
  generateWebhookEvent,
  withDuplicateWebhook,
  generateDuplicateWebhooks,
  outOfOrderWebhooks,
  generateOutOfOrderWebhooks,
  mockPayloadToWebhookEvent,
  DEFAULT_MOCK_WEBHOOK_SECRET,
} from "./mock/webhook-helpers";
export type {
  MockWebhookPayload,
  SignMockWebhookOptions,
  GenerateWebhookEventOptions,
} from "./mock/webhook-helpers";

// ─── Gateway conformance ─────────────────────────────────────────────────────
export {
  runGatewayConformanceSuite,
  GATEWAY_CONFORMANCE_CASES,
} from "./conformance/gateway-conformance";
export type { GatewayConformanceCaseName } from "./conformance/gateway-conformance";
export type {
  GatewayConformanceOptions,
  GatewayConformanceReport,
  GatewayConformanceCaseResult,
  GatewayConformanceFixtures,
  GatewayConformanceMode,
} from "./conformance/types";

// ─── Built-in offline applicable runner ──────────────────────────────────────
export {
  runBuiltinGatewayConformance,
  BUILTIN_GATEWAY_NAMES,
  BUILTIN_TEST_CREDENTIALS,
} from "./builtin/run-builtin-applicable";
export type {
  BuiltinGatewayName,
  RunBuiltinConformanceOptions,
} from "./builtin/run-builtin-applicable";

// ─── Store contracts (lease-aware; distinct from core 0.x IdempotencyStore) ─
export type {
  IdempotencyKey,
  WebhookEventKey,
  ReconciliationKey,
  LeaseToken,
  IsoTimestamp,
  CleanupInput,
  CleanupResult,
  WithTransaction,
  StoreErrorCode,
  IdempotencyRecordStatus,
  IdempotencyRecord,
  ReserveIdempotencyInput,
  IdempotencyReservation,
  RenewIdempotencyReservationInput,
  RenewReservationResult,
  CompleteIdempotencyInput,
  MarkIndeterminateInput,
  IdempotencyStore,
  /** Prefer this alias when core 0.x IdempotencyStore is also in scope. */
  LeaseAwareIdempotencyStore,
  WebhookInboxStatus,
  WebhookInboxRecord,
  ClaimWebhookInput,
  ClaimWebhookResult,
  RenewWebhookLeaseInput,
  RenewWebhookLeaseResult,
  CompleteWebhookInput,
  FailWebhookInput,
  ListRetryableInput,
  WebhookInboxStore,
  ReconciliationStatus,
  ReconciliationRecord,
  ScheduleReconciliationInput,
  ScheduleResult,
  ClaimReconciliationInput,
  ClaimResult,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  CompleteReconciliationInput,
  FailReconciliationInput,
  MarkManualReviewInput,
  ListDueInput,
  ReconciliationStore,
} from "./storage/contracts";
export {
  STORE_ERROR_CODES,
  StoreError,
  StoreConflictError,
  StoreLeaseLostError,
  StoreUnavailableError,
  StoreTimeoutError,
  StoreSerializationFailureError,
  StoreInvalidSchemaError,
  StoreUnsupportedFeatureError,
  StoreCorruptedRecordError,
  StorePayloadHashConflictError,
  isStoreLeaseLostError,
} from "./storage/contracts";

// ─── Storage adapter manifest (§9.5 machine-readable guarantees) ─────────────
export type {
  StorageAdapterManifest,
  StorageCoordinationScope,
  StorageDurability,
  StorageReadAfterWrite,
} from "./storage/adapter-manifest";
export {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  getMemoryStorageAdapterManifest,
  isProductionSafeCoordination,
  isStrongClaimAdapter,
} from "./storage/adapter-manifest";

// ─── Phase 18 frozen selection matrix (honesty-guarded; no adapter imports) ──
export type {
  AdapterSelectionMatrixRow,
  SelectionDistributed,
  SelectionDurableAudit,
} from "./storage/adapter-selection-matrix";
export {
  ADAPTER_SELECTION_MATRIX,
  PRODUCTION_ADAPTER_PACKAGE_NAMES,
  PRODUCTION_MANIFEST_NAMES,
  ROADMAP_PRODUCTION_MATRIX_ROW_IDS,
  durableAuditFromDurability,
  forbidsMultiHostMarketing,
} from "./storage/adapter-selection-matrix";

// ─── Storage conformance ─────────────────────────────────────────────────────
export {
  runIdempotencyStoreConformanceSuite,
  buildStoreConformanceReport,
} from "./storage/idempotency-conformance";
export type {
  IdempotencyStoreConformanceOptions,
  StoreConformanceReport,
  StoreConformanceCaseResult,
} from "./storage/idempotency-conformance";
export { runWebhookInboxStoreConformanceSuite } from "./storage/webhook-inbox-conformance";
export type { WebhookInboxStoreConformanceOptions } from "./storage/webhook-inbox-conformance";
export { runReconciliationStoreConformanceSuite } from "./storage/reconciliation-conformance";
export type { ReconciliationStoreConformanceOptions } from "./storage/reconciliation-conformance";

// ─── NON-PRODUCTION memory stores + fake clock ───────────────────────────────
/**
 * Memory store factories are **NON-PRODUCTION** and **NON-DISTRIBUTED**.
 * Process-local only; crash = data loss. See package README.
 *
 * @remarks NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.
 */
export {
  NON_PRODUCTION,
  NON_DISTRIBUTED,
  MEMORY_STORE_WARNING,
  createMemoryIdempotencyStore,
  createMemoryWebhookInboxStore,
  createMemoryReconciliationStore,
  createMemoryStores,
} from "./memory/memory-stores";
export type {
  MemoryStoreOptions,
  MemoryStoreCrashHook,
  MemoryIdempotencyStore,
  MemoryWebhookInboxStore,
  MemoryReconciliationStore,
  MemoryStores,
} from "./memory/memory-stores";
export { createFakeClock, createSystemClock } from "./memory/fake-clock";
export type { Clock, FakeClock, CreateFakeClockOptions } from "./memory/fake-clock";

// ─── Fixture safety ──────────────────────────────────────────────────────────
export {
  sanitizeFixture,
  assertFixtureSafe,
  redactSecretsFromFixture,
  findFixtureSafetyIssues,
  findSecretLeaks,
  REDACTED,
  SECRET_PATTERNS,
} from "./fixtures/fixture-safety";
export type { FixtureSafetyIssue } from "./fixtures/fixture-safety";
export {
  FIXTURE_SCHEMA_VERSION,
  isFixtureEnvelope,
  assertFixtureSchemaVersion,
} from "./fixtures/schema-version";
export type { FixtureEnvelope } from "./fixtures/schema-version";
