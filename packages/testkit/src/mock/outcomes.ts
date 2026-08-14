/**
 * Scripted outcomes / steps for {@link mockGateway}.
 *
 * Steps are consumed FIFO per operation. After the queue is empty, the mock
 * reuses the last step (or an explicit `defaultOutcome` on the gateway).
 *
 * Synthetic {@link GatewayPaymentResult} values dual-write Phase 6 fields:
 * `outcome`, `references`, and (for indeterminate) `reconciliationRequired`,
 * via core `applyOutcomeToGatewayResult` / `buildProviderReferences`.
 * Refund results dual-write via `applyOutcomeToGatewayRefundResult`.
 * Prefer asserting on `outcome` / `isPaidOutcome` rather than `success` alone.
 */

import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type PaymentOperationOutcome,
  type PaymentStatus,
  type RefundOperationOutcome,
  type RefundStatus,
  type WebhookEvent,
} from "@paykernel/core";

/**
 * High-level outcome names for queues.
 *
 * - `timeout` / `network_error` → {@link NetworkError} (transport-level; reconcile)
 * - `provider_ok_client_timeout` / `provider_success_client_timeout` →
 *   provider ledger updated as `outcome: 'succeeded'` (auth-only when
 *   create used `capture: false`; otherwise paid + full capture); refund
 *   mutates refunded totals then throws; client sees NetworkError
 * - `indeterminate` → result with `outcome: 'indeterminate'`, `success: false`,
 *   status processing, `reconciliationRequired: true` (never a definitive decline)
 * - `requires_action` → `outcome: 'requires_action'`, `success: true`, pending + redirect
 * - `succeeded` → `outcome: 'succeeded'`, status paid (fulfill only when paid-like)
 * - `failed` → definitive failure (`outcome: 'failed'`, success:false, status failed)
 * - `declined` / `insufficient_funds` → typed card/funds errors (throw path)
 */
export type ScriptedOutcomeName =
  | "succeeded"
  | "authorized"
  | "requires_action"
  | "pending"
  | "processing"
  | "declined"
  | "failed"
  | "insufficient_funds"
  | "network_error"
  | "timeout"
  | "indeterminate"
  | "provider_ok_client_timeout"
  | "provider_success_client_timeout"
  | "gateway_api_error"
  | "partial_capture"
  | "partial_refund"
  | "voided"
  | "custom";

export type ScriptedOutcomeBase = {
  /**
   * Artificial delay before resolving (ms).
   * Alias of {@link delayMs}.
   */
  latencyMs?: number;
  /**
   * Artificial delay before resolving (ms).
   * Alias of {@link latencyMs}; if both set, `latencyMs` wins.
   */
  delayMs?: number;
  /**
   * When true, abort with NetworkError if an AbortSignal is already aborted
   * or becomes aborted during latency wait (request cancellation).
   */
  respectAbort?: boolean;
  /** Optional amount override on synthetic results. */
  amount?: number;
  /** Optional status override on synthetic results. */
  status?: PaymentStatus;
};

/**
 * Throw-form step: immediately throws (after optional delay).
 * `throw: 'abort'` surfaces as NetworkError (request cancelled).
 */
export type ScriptedThrowStep = ScriptedOutcomeBase & {
  throw: Error | "abort";
  outcome?: never;
};

export type ScriptedPaymentOutcome =
  | (ScriptedOutcomeBase & {
      outcome: Exclude<ScriptedOutcomeName, "partial_refund" | "custom">;
      /** Override fields on the synthetic GatewayPaymentResult. */
      result?: Partial<GatewayPaymentResult>;
      /** Override error message for error outcomes. */
      message?: string;
      throw?: never;
    })
  | (ScriptedOutcomeBase & {
      outcome: "custom";
      /** Throw this error or return this result. */
      error?: Error;
      result?: GatewayPaymentResult;
      throw?: never;
    })
  | ScriptedThrowStep;

export type ScriptedRefundOutcome =
  | (ScriptedOutcomeBase & {
      outcome:
        | "succeeded"
        | "partial_refund"
        | "network_error"
        | "timeout"
        | "gateway_api_error"
        | "indeterminate"
        | "failed"
        | "provider_ok_client_timeout"
        | "provider_success_client_timeout";
      result?: Partial<GatewayRefundResult>;
      message?: string;
      throw?: never;
    })
  | (ScriptedOutcomeBase & {
      outcome: "custom";
      error?: Error;
      result?: GatewayRefundResult;
      throw?: never;
    })
  | ScriptedThrowStep;

/** @deprecated Prefer ScriptedPaymentOutcome; alias for roadmap ScriptedStep. */
export type ScriptedStep = ScriptedPaymentOutcome;

export type ScriptedWebhookEvent = Partial<WebhookEvent> & {
  /** When omitted, mock generates id. */
  id?: string;
  type?: string;
  status?: PaymentStatus;
  gatewayPaymentId?: string;
};

export type MockRequestRecord = {
  operation:
    | "createPayment"
    | "capturePayment"
    | "refundPayment"
    | "voidPayment"
    | "getPayment"
    | "getPaymentStatus"
    | "verifyWebhook"
    | "parseWebhookEvent"
    | "createCheckoutSession";
  /** Params after {@link redact} (secrets/PII scrubbed). */
  params: unknown;
  /** Successful result after redact, when the call returned. */
  result?: unknown;
  /** Error summary when the call threw. */
  error?: { name: string; message: string; code?: string };
  /** Epoch millis from the mock clock (fake or wall). */
  atMs: number;
};

export type HistoryAssertion = {
  operation: MockRequestRecord["operation"];
  /** Optional deep partial match against redacted params. */
  params?: unknown;
  /** Optional deep partial match against redacted result. */
  result?: unknown;
  /** When true, expect an error was recorded. */
  error?: boolean | { name?: string; code?: string };
};

/**
 * Map a ledger/status snapshot to a Phase 6 {@link PaymentOperationOutcome}.
 * Used by synthetic results when no scripted outcome name is available.
 */
export function paymentStatusToOperationOutcome(
  status: PaymentStatus,
): PaymentOperationOutcome {
  switch (status) {
    case "failed":
      return "failed";
    case "pending":
    case "processing":
    case "approved":
      // Buyer approval (PayPal pre-capture) is not settled — aligns with core
      // inferOperationOutcome / mapPayPalOutcome (requires_action, not succeeded).
      return "requires_action";
    case "paid":
    case "authorized":
    case "partially_captured":
    case "refunded":
    case "partially_refunded":
    case "cancelled":
    case "reversed":
    case "refund_completed":
    case "refund_pending":
    case "refund_failed":
    case "setup_completed":
    default:
      // Void/cancel/refund terminal ops are still "operation succeeded" at API level;
      // isPaidOutcome stays false unless status is paid (not approved/authorized).
      return "succeeded";
  }
}

/**
 * Synthetic payment result with Phase 6 dual-write (`outcome` + `references`).
 * Deprecated `success` is set from outcome via core helpers.
 * When `amount` is set, pass `currency` so major-unit snapshots are complete.
 */
export function defaultPaymentResult(
  gatewayId: string,
  status: PaymentStatus,
  amount?: number,
  gateway: string = "mock",
  currency?: string,
): GatewayPaymentResult {
  const outcome = paymentStatusToOperationOutcome(status);
  const base: Parameters<typeof applyOutcomeToGatewayResult>[0] = {
    gatewayId,
    status,
    rawResponse: { mock: true, status },
    gateway,
    redirectUrl: undefined,
  };
  if (amount !== undefined) {
    base.amount = amount;
  }
  if (currency !== undefined) {
    base.currency = currency;
  }
  return applyOutcomeToGatewayResult(base, outcome);
}

export function defaultRefundResult(
  gatewayRefundId: string,
  status: RefundStatus = "completed",
  totalRefunded?: number,
): GatewayRefundResult {
  const outcome: RefundOperationOutcome =
    status === "completed"
      ? "succeeded"
      : status === "pending"
        ? "pending"
        : "failed";
  return applyOutcomeToGatewayRefundResult(
    {
      gatewayRefundId,
      status,
      totalRefunded,
      rawResponse: { mock: true, status },
    },
    outcome,
  );
}

/** Resolve effective delay from a step (latencyMs preferred over delayMs). */
export function stepDelayMs(
  step: { latencyMs?: number; delayMs?: number } | undefined,
  defaultLatencyMs = 0,
): number {
  if (!step) return defaultLatencyMs;
  if (typeof step.latencyMs === "number") return step.latencyMs;
  if (typeof step.delayMs === "number") return step.delayMs;
  return defaultLatencyMs;
}
