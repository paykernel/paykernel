/**
 * @paykernel/store-contracts
 *
 * Portable production store contracts: lease-aware interfaces, StoreError
 * taxonomy, and machine-readable storage adapter manifests.
 *
 * Zero runtime workspace dependencies. No mock gateway / NON_PRODUCTION
 * memory factories — those remain in `@paykernel/testkit` (which re-exports
 * this package for backward compatibility).
 */

// ─── Store contracts (lease-aware) ───────────────────────────────────────────
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
} from "./contracts";
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
} from "./contracts";

// ─── Storage adapter manifest ────────────────────────────────────────────────
export type {
  StorageAdapterManifest,
  StorageCoordinationScope,
  StorageDurability,
  StorageReadAfterWrite,
} from "./adapter-manifest";
export {
  MEMORY_STORAGE_ADAPTER_MANIFEST,
  assertStorageAdapterManifest,
  getMemoryStorageAdapterManifest,
  isProductionSafeCoordination,
  isStrongClaimAdapter,
} from "./adapter-manifest";
