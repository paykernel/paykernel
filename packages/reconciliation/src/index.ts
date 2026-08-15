/**
 * @paykernel/reconciliation — portable reconciliation primitives.
 *
 * Depends only on `@paykernel/core` (core). No testkit, adapters, Redis,
 * or DB drivers. No framework coupling. No Node-only imports.
 *
 * @packageDocumentation
 */

// Reconciler
export { createPaymentReconciler } from "./reconciler";
export type {
  CreatePaymentReconcilerOptions,
  PaymentReconciler,
  ReconcileManyItem,
  ReconcileManyOptions,
} from "./reconciler";

// Scheduler
export {
  createReconciliationScheduler,
  deriveReconciliationJobKey,
} from "./scheduler";
export type {
  ClaimDueOptions,
  ClaimedJob,
  CompleteJobInput,
  CreateReconciliationSchedulerOptions,
  FailAndRescheduleInput,
  ListDeadLetterOptions,
  MarkManualReviewJobInput,
  ProcessDueDisposition,
  ProcessDueOptions,
  ReconciliationScheduler,
  ScheduleJobInput,
  SchedulerClock,
} from "./scheduler";

// Backoff
export { createExponentialBackoff } from "./backoff";
export type { ExponentialBackoff, ExponentialBackoffOptions } from "./backoff";

// Policy (decision-only — no mutations)
export {
  decideReconciliationPolicy,
  decideReconciliationAction,
  shouldForbidReplacementCharge,
} from "./policy";
export type { ReconciliationDecision } from "./policy";

// Compare
export { compareSnapshots, comparePaymentSnapshots, moneyEquals } from "./compare";

// Lookup
export {
  resolveProviderSnapshot,
  safeLookup,
  createGetPaymentLookupPort,
} from "./lookup";
export type { LookupOutcome, ProviderLookupPort } from "./lookup";

// Sanitize
export {
  sanitizeReconciliationError,
  DEFAULT_SANITIZE_MAX_LENGTH,
} from "./sanitize";
export type { SanitizeReconciliationErrorOptions } from "./sanitize";

// Store contract + errors
export { StoreLeaseLostError, isStoreLeaseLostError } from "./store";
export type {
  ReconciliationKey,
  LeaseToken,
  IsoTimestamp,
  CleanupInput,
  CleanupResult,
  WithTransaction,
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
} from "./store";

// Domain types
export {
  buildLocalPaymentSnapshot,
  buildReconciliationTarget,
  buildProviderPaymentSnapshot,
} from "./types";
export type {
  LocalPaymentSnapshot,
  ReconciliationTarget,
  ProviderPaymentSnapshot,
  ReconciliationDifference,
  ReconciliationResult,
  BuildLocalPaymentSnapshotInput,
  BuildReconciliationTargetInput,
  BuildProviderPaymentSnapshotInput,
} from "./types";

// Test-only memory store is NOT exported from the public surface intentionally.
// Import from source in package tests only; durable adapters live in testkit + Phase 11+.
