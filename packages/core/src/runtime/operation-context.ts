// file: packages/core/src/runtime/operation-context.ts

/**
 * Phase 20 — structured operation context for diagnostics / telemetry.
 *
 * Carries correlation ids and outcome metadata without secrets. Intended for
 * redacting telemetry sinks and optional observability bridges (metrics/spans).
 *
 * @see createRedactingTelemetrySink
 * @see docs/telemetry.md
 */

/**
 * Canonical payment operation type labels used for span/metric naming.
 * Open string union allows custom/app-defined operation types.
 */
export type PaymentOperationType =
  | "payment.create"
  | "payment.capture"
  | "payment.refund"
  | "payment.void"
  | "payment.webhook.verify"
  | "payment.webhook.claim"
  | "payment.webhook.process"
  | "payment.reconcile"
  | "payment.store.claim"
  | (string & {});

/**
 * Structured, secret-free bag describing a single payment operation attempt.
 *
 * Optional fields use exactOptionalPropertyTypes: omit keys when absent;
 * never assign `undefined`.
 */
export type OperationContext = {
  operationId: string;
  gateway: string;
  operationType: PaymentOperationType | string;
  tenant?: string;
  namespace?: string;
  internalReference?: string;
  providerObjectId?: string;
  /** Provider request / correlation id — allow-listed for telemetry debugging. */
  providerRequestId?: string;
  attemptNumber?: number;
  /** Duration in milliseconds when finalized. */
  durationMs?: number;
  /** Normalized outcome string e.g. succeeded|declined|failed|indeterminate|… */
  normalizedOutcome?: string;
  retry?: boolean;
  reconciliationRequired?: boolean;
  inboxEventKey?: string;
};

/** Required + optional fields accepted by {@link createOperationContext}. */
export type CreateOperationContextInput = {
  operationId: string;
  gateway: string;
  operationType: PaymentOperationType | string;
  tenant?: string;
  namespace?: string;
  internalReference?: string;
  providerObjectId?: string;
  providerRequestId?: string;
  attemptNumber?: number;
  durationMs?: number;
  normalizedOutcome?: string;
  retry?: boolean;
  reconciliationRequired?: boolean;
  inboxEventKey?: string;
};

/**
 * Patch applied by {@link finalizeOperationContext}. All keys optional;
 * present values overwrite the base context (EOPT-safe omit when absent).
 */
export type FinalizeOperationContextPatch = {
  durationMs?: number;
  normalizedOutcome?: string;
  providerRequestId?: string;
  providerObjectId?: string;
  internalReference?: string;
  attemptNumber?: number;
  retry?: boolean;
  reconciliationRequired?: boolean;
  inboxEventKey?: string;
  tenant?: string;
  namespace?: string;
};

const OPTIONAL_KEYS = [
  "tenant",
  "namespace",
  "internalReference",
  "providerObjectId",
  "providerRequestId",
  "attemptNumber",
  "durationMs",
  "normalizedOutcome",
  "retry",
  "reconciliationRequired",
  "inboxEventKey",
] as const;

type OptionalKey = (typeof OPTIONAL_KEYS)[number];

function assignOptional(
  target: OperationContext,
  source: Partial<Record<OptionalKey, unknown>>,
): void {
  for (const key of OPTIONAL_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      // Indexed assignment keeps exactOptionalPropertyTypes happy without
      // listing every key twice.
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

/**
 * Build an {@link OperationContext}. Requires `operationId`, `gateway`, and
 * `operationType`. Optional fields are copied only when present (never set to
 * `undefined`).
 */
export function createOperationContext(
  input: CreateOperationContextInput,
): OperationContext {
  const ctx: OperationContext = {
    operationId: input.operationId,
    gateway: input.gateway,
    operationType: input.operationType,
  };
  assignOptional(ctx, input);
  return ctx;
}

/**
 * Return a new context with finalize/result fields merged in. Does not mutate
 * the input. Optional patch keys overwrite when present.
 */
export function finalizeOperationContext(
  ctx: OperationContext,
  patch: FinalizeOperationContextPatch = {},
): OperationContext {
  const next: OperationContext = {
    operationId: ctx.operationId,
    gateway: ctx.gateway,
    operationType: ctx.operationType,
  };
  assignOptional(next, ctx);
  assignOptional(next, patch);
  return next;
}

/**
 * Plain telemetry bag derived from an {@link OperationContext}.
 * Only defined keys are included (EOPT-safe / JSON-friendly).
 */
export function operationContextToTelemetryData(
  ctx: OperationContext,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    operationId: ctx.operationId,
    gateway: ctx.gateway,
    operationType: ctx.operationType,
  };
  for (const key of OPTIONAL_KEYS) {
    const value = ctx[key];
    if (value !== undefined) {
      data[key] = value;
    }
  }
  return data;
}
