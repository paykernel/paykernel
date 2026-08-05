// file: packages/core/src/types/operation-result.ts

/**
 * Phase 6 operation outcomes and conversion helpers.
 *
 * Prefer switching on {@link PaymentOperationResult.outcome} (or
 * `GatewayPaymentResult.outcome`) rather than `success: boolean`.
 *
 * @see docs/operation-results.md
 */

import type { PaymentError } from "../errors";
import {
    isPaidLikePaymentStatus,
    type PaymentDomainStatus,
} from "./domain-status";
import type {
    GatewayPaymentResult,
    GatewayRefundResult,
    PaymentNextAction,
    PaymentStatus,
    RefundStatus,
} from "./payment.types";
import type { ProviderReferences } from "./provider-refs";
import { buildProviderReferences } from "./provider-refs";

// ─── Supporting domain types ─────────────────────────────────────────────────

/**
 * Customer action required after create/capture (3DS, redirect, OTP, SDK).
 *
 * Aligns with {@link PaymentNextAction}; prefer structured `type` discriminants.
 * Open index signature allows provider-native shapes.
 */
export type PaymentAction =
    | { type: "redirect"; url?: string; [key: string]: unknown }
    | { type: "use_stripe_sdk"; clientSecret?: string; [key: string]: unknown }
    | {
          type: "stcpay_otp";
          transactionUrl?: string;
          method?: string;
          parameter?: string;
          [key: string]: unknown;
      }
    | { type: string; [key: string]: unknown };

/**
 * Structured decline information (not an thrown error).
 *
 * Prefer this on `outcome: 'declined'` results. Do not put secrets in `raw`.
 */
export type PaymentDecline = {
    code: string;
    message: string;
    /** Provider decline code when different from normalized `code` */
    providerCode?: string;
    softDecline?: boolean;
    /** Provider payload fragment — never secrets */
    raw?: unknown;
};

/**
 * Serializable error shape for `outcome: 'failed'` (safe to log).
 * Prefer plain objects over Error instances on public results.
 */
export type PaymentErrorLike = {
    name: string;
    message: string;
    code: string;
    statusCode?: number;
};

/**
 * Normalized payment snapshot embedded in operation outcomes.
 *
 * Amount fields remain major-unit `number` in 0.x (Phase 5 money model for inputs).
 */
export type Payment = {
    /** Normalized payment lifecycle status (domain status preferred). */
    status: PaymentDomainStatus | PaymentStatus;
    /** Major currency units (0.x); may become Money at 1.0 */
    amount?: number;
    currency?: string;
    references: ProviderReferences;
    redirectUrl?: string;
    clientSecret?: string;
    nextAction?: PaymentNextAction;
    fee?: number;
    capturedAmount?: number;
    refundedAmount?: number;
    rawResponse?: unknown;
};

/** Discriminant for {@link PaymentOperationResult}. */
export type PaymentOperationOutcome =
    | "succeeded"
    | "requires_action"
    | "declined"
    | "failed"
    | "indeterminate";

/**
 * Preferred Phase 6 create/capture/get operation result.
 *
 * Discriminated on `outcome`. **Never** treat `requires_action` or pending
 * snapshots as paid — only `outcome: 'succeeded'` with a paid-like status is paid.
 *
 * **Throw vs outcome policy (Engineering Rule 3):**
 * - Transport / pre-submit failures may still **throw** (`NetworkError`, validation).
 * - After a mutation may have been accepted by the provider (timeout after submit,
 *   ambiguous idempotency replay), return `outcome: 'indeterminate'` with
 *   `reconciliationRequired: true` — **do not** map uncertain outcomes to
 *   `failed` / decline.
 * - Hard declines known from the provider response may use `outcome: 'declined'`
 *   **or** throw `CardDeclinedError` / `InsufficientFundsError` (0.x gateways still
 *   throw in many paths); integrators should handle both until fully migrated.
 */
export type PaymentOperationResult =
    | { outcome: "succeeded"; payment: Payment }
    | {
          outcome: "requires_action";
          payment: Payment;
          action: PaymentAction;
      }
    | {
          outcome: "declined";
          failure: PaymentDecline;
          payment?: Payment;
      }
    | {
          outcome: "failed";
          error: PaymentErrorLike;
          payment?: Payment;
      }
    | {
          outcome: "indeterminate";
          providerRequestId?: string;
          reconciliationRequired: true;
          payment?: Payment;
          message?: string;
      };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a {@link PaymentError} (or similar) to a serializable {@link PaymentErrorLike}.
 */
export function toPaymentErrorLike(
    error: PaymentError | PaymentErrorLike | { name?: string; message: string; code?: string; statusCode?: number },
): PaymentErrorLike {
    const name =
        "name" in error && typeof error.name === "string" && error.name.length > 0
            ? error.name
            : "PaymentError";
    const code =
        "code" in error && typeof error.code === "string" && error.code.length > 0
            ? error.code
            : "PAYMENT_ERROR";
    const like: PaymentErrorLike = {
        name,
        message: error.message,
        code,
    };
    if (
        "statusCode" in error &&
        typeof error.statusCode === "number"
    ) {
        like.statusCode = error.statusCode;
    }
    return like;
}

/**
 * Map a {@link PaymentNextAction} (or free-form next step) to {@link PaymentAction}.
 */
export function paymentNextActionToAction(
    next: PaymentNextAction | undefined,
    fallbackRedirectUrl?: string,
): PaymentAction | undefined {
    if (next && typeof next === "object") {
        const type =
            typeof next.type === "string" && next.type.length > 0
                ? next.type
                : "unknown";
        return { ...next, type } as PaymentAction;
    }
    if (fallbackRedirectUrl) {
        return { type: "redirect", url: fallbackRedirectUrl };
    }
    return undefined;
}

/**
 * Build a {@link Payment} snapshot from a gateway result (+ optional gateway name).
 */
export function paymentFromGatewayResult(
    result: GatewayPaymentResult,
    gateway?: string,
): Payment {
    const existingRefs = result.references;
    const references =
        existingRefs ??
        buildProviderReferences({
            gateway: gateway ?? "unknown",
            gatewayId: result.gatewayId,
            status: result.status,
            ...(result.gatewayObjectId !== undefined
                ? { gatewayObjectId: result.gatewayObjectId }
                : {}),
            ...(result.orderId !== undefined ? { orderId: result.orderId } : {}),
            ...(result.captureId !== undefined
                ? { captureId: result.captureId }
                : {}),
            ...(result.authorizationId !== undefined
                ? { authorizationId: result.authorizationId }
                : {}),
            ...(result.providerRequestId !== undefined
                ? { providerRequestId: result.providerRequestId }
                : {}),
        });

    const payment: Payment = {
        status: result.status,
        references,
        rawResponse: result.rawResponse,
    };

    if (result.amount !== undefined) payment.amount = result.amount;
    if (result.redirectUrl !== undefined) payment.redirectUrl = result.redirectUrl;
    if (result.clientSecret !== undefined) payment.clientSecret = result.clientSecret;
    if (result.nextAction !== undefined) payment.nextAction = result.nextAction;
    if (result.fee !== undefined) payment.fee = result.fee;
    if (result.capturedAmount !== undefined) {
        payment.capturedAmount = result.capturedAmount;
    }
    if (result.refundedAmount !== undefined) {
        payment.refundedAmount = result.refundedAmount;
    }

    return payment;
}

/**
 * Infer {@link PaymentOperationOutcome} from a 0.x {@link GatewayPaymentResult}
 * when `outcome` is not yet populated by the gateway.
 *
 * Money-safe rules:
 * - Explicit `outcome` wins.
 * - `reconciliationRequired` / raw indeterminate markers → `indeterminate`.
 * - Customer action signals (`nextAction`, pending redirect, client secret) →
 *   `requires_action` (never `succeeded`).
 * - Auth holds (`authorized` + API ok) → operation `succeeded`, but
 *   {@link isPaidOutcome} stays false until status is paid-like (`paid` only).
 * - Buyer approval (`approved`, e.g. PayPal pre-capture) → `requires_action`
 *   (never `succeeded`; not paid-like).
 * - Card/hard declines → `declined`; cancelled/voided without force → `failed`.
 * - Bare pending/processing without action still → `requires_action` so callers
 *   never fulfill on non-terminal state.
 */
export function inferOperationOutcome(
    result: GatewayPaymentResult,
): PaymentOperationOutcome {
    // Uncertainty beats an explicit `outcome: 'succeeded'`. Callers that set
    // reconciliationRequired must not get a settled inference for fulfillment.
    if (
        result.reconciliationRequired === true ||
        hasRawIndeterminateMarker(result.rawResponse)
    ) {
        return "indeterminate";
    }

    if (result.outcome !== undefined) {
        return result.outcome;
    }

    if (result.decline !== undefined) {
        return "declined";
    }

    const hasAction =
        result.nextAction !== undefined ||
        (typeof result.redirectUrl === "string" &&
            result.redirectUrl.length > 0 &&
            (result.status === "pending" || result.status === "processing"));

    if (hasAction && result.success) {
        return "requires_action";
    }

    if (!result.success) {
        // Cancelled/voided is not a card decline — use failed, not declined.
        if (result.status === "cancelled") {
            return "failed";
        }
        if (result.status === "failed") {
            return "declined";
        }
        return "failed";
    }

    // success: true (API call completed — not necessarily paid)
    if (
        result.status === "paid" ||
        result.status === "authorized" ||
        result.status === "partially_captured" ||
        result.status === "refunded" ||
        result.status === "partially_refunded"
    ) {
        return "succeeded";
    }

    if (
        result.status === "pending" ||
        result.status === "processing" ||
        result.status === "approved"
    ) {
        // Non-terminal / pre-capture approval: never succeeded. Prefer
        // requires_action so fulfillment gates stay closed (clientSecret, bare
        // pending intention, PayPal buyer APPROVED before capture, etc.).
        return "requires_action";
    }

    if (result.status === "failed") {
        return "declined";
    }

    // cancelled / unknown — not a successful payment capture
    return "failed";
}

function hasRawIndeterminateMarker(raw: unknown): boolean {
    if (raw === null || typeof raw !== "object") {
        return false;
    }
    const o = raw as Record<string, unknown>;
    return (
        o.reconciliationRequired === true ||
        o.indeterminate === true ||
        o.outcome === "indeterminate"
    );
}

/**
 * Map a {@link GatewayPaymentResult} to the preferred {@link PaymentOperationResult}.
 */
export function mapGatewayResultToOperationResult(
    result: GatewayPaymentResult,
    options?: { gateway?: string },
): PaymentOperationResult {
    const outcome = inferOperationOutcome(result);
    const payment = paymentFromGatewayResult(result, options?.gateway);

    switch (outcome) {
        case "succeeded":
            return { outcome: "succeeded", payment };
        case "requires_action": {
            const action =
                paymentNextActionToAction(
                    result.nextAction,
                    result.redirectUrl,
                ) ??
                (result.clientSecret
                    ? {
                          type: "use_stripe_sdk",
                          clientSecret: result.clientSecret,
                      }
                    : { type: "unknown" });
            return { outcome: "requires_action", payment, action };
        }
        case "declined": {
            const failure: PaymentDecline =
                result.decline ??
                {
                    code: "DECLINED",
                    message: "Payment was declined",
                };
            return { outcome: "declined", failure, payment };
        }
        case "failed": {
            const error: PaymentErrorLike = {
                name: "PaymentError",
                message: "Payment operation failed",
                code: "PAYMENT_FAILED",
            };
            return { outcome: "failed", error, payment };
        }
        case "indeterminate": {
            const ind: Extract<
                PaymentOperationResult,
                { outcome: "indeterminate" }
            > = {
                outcome: "indeterminate",
                reconciliationRequired: true,
                payment,
            };
            if (result.providerRequestId !== undefined) {
                ind.providerRequestId = result.providerRequestId;
            } else if (payment.references.providerRequestId !== undefined) {
                ind.providerRequestId = payment.references.providerRequestId;
            }
            return ind;
        }
    }
}

/**
 * Base fields for {@link applyOutcomeToGatewayResult} before outcome dual-write.
 */
export type ApplyOutcomeGatewayBase = {
    gatewayId: string;
    status: PaymentStatus;
    rawResponse: unknown;
    // `| undefined` required under exactOptionalPropertyTypes so callers may pass
    // `value | undefined` from optional gateway fields without conditional spreads.
    gatewayObjectId?: string | undefined;
    orderId?: string | undefined;
    captureId?: string | undefined;
    authorizationId?: string | undefined;
    redirectUrl?: string | undefined;
    amount?: number | undefined;
    fee?: number | undefined;
    capturedAmount?: number | undefined;
    refundedAmount?: number | undefined;
    clientSecret?: string | undefined;
    nextAction?: PaymentNextAction | undefined;
    references?: ProviderReferences | undefined;
    decline?: PaymentDecline | undefined;
    providerRequestId?: string | undefined;
    /** Provider-native status string (stored on references.providerNativeStatus). */
    providerNativeStatus?: string | undefined;
    /** Charge id (Stripe) dual-written into references.relatedIds.chargeId. */
    chargeId?: string | undefined;
    /** Extra related ids merged when auto-building references. */
    relatedIds?: ProviderReferences["relatedIds"] | undefined;
    /** Merchant / internal correlation id for references.internalReference. */
    internalReference?: string | undefined;
    /** Gateway name for auto-building references when omitted. */
    gateway?: string | undefined;
};

/**
 * Dual-write `outcome` (+ related fields) onto a {@link GatewayPaymentResult},
 * setting deprecated `success` from outcome mapping.
 *
 * ## `success` semantics (0.x compatibility)
 *
 * Historically gateways set `success: true` when the **API call completed**
 * without transport failure — **not** “customer was charged / fulfill order”.
 * That mapping is preserved:
 *
 * | outcome            | success | notes |
 * | ------------------ | ------- | ----- |
 * | `succeeded`        | `true`  | Paid-like or successful auth op |
 * | `requires_action`  | `true`  | API ok; customer action needed |
 * | `declined`         | `false` | Definitive decline |
 * | `failed`           | `false` | Definitive failure |
 * | `indeterminate`    | `false` | **Not** a decline — always set `reconciliationRequired: true` |
 *
 * **Do not fulfill on `success` alone.** Use {@link isPaidOutcome} or
 * `outcome === 'succeeded'` with a paid-like {@link PaymentStatus}.
 */
export function applyOutcomeToGatewayResult(
    base: ApplyOutcomeGatewayBase,
    outcome: PaymentOperationOutcome,
    extras?: {
        decline?: PaymentDecline;
        action?: PaymentAction;
        reconciliationRequired?: boolean;
    },
): GatewayPaymentResult {
    const success = successFromOutcome(outcome);

    const references =
        base.references ??
        buildProviderReferences({
            gateway: base.gateway ?? "unknown",
            gatewayId: base.gatewayId,
            status: base.status,
            ...(base.gatewayObjectId !== undefined
                ? { gatewayObjectId: base.gatewayObjectId }
                : {}),
            ...(base.orderId !== undefined ? { orderId: base.orderId } : {}),
            ...(base.captureId !== undefined
                ? { captureId: base.captureId }
                : {}),
            ...(base.authorizationId !== undefined
                ? { authorizationId: base.authorizationId }
                : {}),
            ...(base.providerRequestId !== undefined
                ? { providerRequestId: base.providerRequestId }
                : {}),
            ...(base.providerNativeStatus !== undefined
                ? { providerNativeStatus: base.providerNativeStatus }
                : {}),
            ...(base.chargeId !== undefined ? { chargeId: base.chargeId } : {}),
            ...(base.internalReference !== undefined
                ? { internalReference: base.internalReference }
                : {}),
            ...(base.relatedIds !== undefined
                ? { relatedIds: base.relatedIds }
                : {}),
        });

    const result: GatewayPaymentResult = {
        success,
        outcome,
        gatewayId: base.gatewayId,
        status: base.status,
        redirectUrl: base.redirectUrl,
        rawResponse: base.rawResponse,
        references,
    };

    if (base.gatewayObjectId !== undefined) {
        result.gatewayObjectId = base.gatewayObjectId;
    }
    if (base.orderId !== undefined) result.orderId = base.orderId;
    if (base.captureId !== undefined) result.captureId = base.captureId;
    if (base.authorizationId !== undefined) {
        result.authorizationId = base.authorizationId;
    }
    if (base.amount !== undefined) result.amount = base.amount;
    if (base.fee !== undefined) result.fee = base.fee;
    if (base.capturedAmount !== undefined) {
        result.capturedAmount = base.capturedAmount;
    }
    if (base.refundedAmount !== undefined) {
        result.refundedAmount = base.refundedAmount;
    }
    if (base.clientSecret !== undefined) {
        result.clientSecret = base.clientSecret;
    }
    if (base.nextAction !== undefined) {
        result.nextAction = base.nextAction;
    } else if (extras?.action !== undefined) {
        result.nextAction = extras.action as PaymentNextAction;
    }
    if (base.providerRequestId !== undefined) {
        result.providerRequestId = base.providerRequestId;
    }

    const decline = extras?.decline ?? base.decline;
    if (decline !== undefined) {
        result.decline = decline;
    }

    if (outcome === "indeterminate") {
        result.reconciliationRequired = true;
    } else if (extras?.reconciliationRequired === true) {
        result.reconciliationRequired = true;
    }

    return result;
}

/**
 * Derive deprecated `success` boolean from outcome (see {@link applyOutcomeToGatewayResult}).
 */
export function successFromOutcome(outcome: PaymentOperationOutcome): boolean {
    return outcome === "succeeded" || outcome === "requires_action";
}

/**
 * True only when the result means money settled for fulfillment:
 * `outcome === 'succeeded'` (or inferred) **and** paid-like status (`paid` only).
 *
 * Auth holds (`authorized`), buyer approval (`approved`), pending, requires_action,
 * declined, failed, and indeterminate all return **false**.
 * `reconciliationRequired: true` always returns **false** even if outcome/status
 * look settled — post-submit uncertainty must not drive fulfillment.
 */
export function isPaidOutcome(
    result: GatewayPaymentResult | PaymentOperationResult,
): boolean {
    if (isOperationResult(result)) {
        // Indeterminate arm is the only settled-uncertainty path on
        // PaymentOperationResult; never treat it as paid for fulfillment.
        if (result.outcome === "indeterminate") {
            return false;
        }
        return (
            result.outcome === "succeeded" &&
            isPaidLikePaymentStatus(result.payment.status)
        );
    }
    if (result.reconciliationRequired === true) {
        return false;
    }
    const outcome = inferOperationOutcome(result);
    return outcome === "succeeded" && isPaidLikePaymentStatus(result.status);
}

/**
 * True when customer action is required (3DS, redirect, OTP, client secret confirm).
 */
export function isRequiresActionOutcome(
    result: GatewayPaymentResult | PaymentOperationResult,
): boolean {
    if (isOperationResult(result)) {
        return result.outcome === "requires_action";
    }
    return inferOperationOutcome(result) === "requires_action";
}

/**
 * True when the result is explicitly indeterminate and must be reconciled.
 */
export function isIndeterminateOutcome(
    result: GatewayPaymentResult | PaymentOperationResult,
): boolean {
    if (isOperationResult(result)) {
        return result.outcome === "indeterminate";
    }
    return inferOperationOutcome(result) === "indeterminate";
}

/**
 * GatewayPaymentResult always has `success` + `gatewayId` + `status`.
 * PaymentOperationResult arms have `outcome` without that trio.
 * When both exist (gateway result with dual-written `outcome`), treat as gateway result.
 */
export function isGatewayPaymentResult(
    result: GatewayPaymentResult | PaymentOperationResult,
): result is GatewayPaymentResult {
    return (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        "gatewayId" in result &&
        "status" in result
    );
}

function isOperationResult(
    result: GatewayPaymentResult | PaymentOperationResult,
): result is PaymentOperationResult {
    return !isGatewayPaymentResult(result) && "outcome" in result;
}

// ─── Refund operation results (Phase 6 parallel surface) ─────────────────────

/**
 * Discriminant for {@link RefundOperationResult}.
 *
 * Mirrors payment outcomes but refunds have no `requires_action` / 3DS arm;
 * async provider refunds use `pending` instead.
 */
export type RefundOperationOutcome =
    | "succeeded"
    | "failed"
    | "pending"
    | "indeterminate";

/**
 * Preferred Phase 6 refund result (discriminated on `outcome`).
 *
 * **Throw vs outcome:** same Engineering Rule 3 as payments — post-submit
 * unknown state → `indeterminate` + `reconciliationRequired: true`, never a
 * forged `failed` decline.
 */
export type RefundOperationResult =
    | {
          outcome: "succeeded";
          refundId: string;
          status: "completed";
          totalRefunded?: number;
      }
    | {
          outcome: "pending";
          refundId: string;
          status: "pending";
          totalRefunded?: number;
      }
    | {
          outcome: "failed";
          error: PaymentErrorLike;
          refundId?: string;
          status?: "failed";
      }
    | {
          outcome: "indeterminate";
          reconciliationRequired: true;
          refundId?: string;
          providerRequestId?: string;
          message?: string;
      };

/**
 * Derive deprecated refund `success` boolean from outcome.
 * `succeeded` | `pending` → true; `failed` | `indeterminate` → false.
 */
export function successFromRefundOutcome(
    outcome: RefundOperationOutcome,
): boolean {
    return outcome === "succeeded" || outcome === "pending";
}

/**
 * Base fields for {@link applyOutcomeToGatewayRefundResult} before outcome dual-write.
 */
export type ApplyOutcomeGatewayRefundBase = {
    gatewayRefundId: string;
    status: RefundStatus;
    rawResponse: unknown;
    // `| undefined` required under exactOptionalPropertyTypes so callers may pass
    // `value | undefined` from optional gateway fields without conditional spreads.
    totalRefunded?: number | undefined;
    refundedAt?: Date | undefined;
    providerRequestId?: string | undefined;
};

/**
 * Dual-write `outcome` (+ related fields) onto a {@link GatewayRefundResult},
 * setting deprecated `success` from {@link successFromRefundOutcome}.
 *
 * ## `success` semantics (0.x compatibility)
 *
 * | outcome         | success | notes |
 * | --------------- | ------- | ----- |
 * | `succeeded`     | `true`  | Refund settled / completed |
 * | `pending`       | `true`  | API accepted; not yet terminal |
 * | `failed`        | `false` | Definitive refund failure |
 * | `indeterminate` | `false` | **Not** a failure to mark settled/failed — always set `reconciliationRequired: true` |
 *
 * Does **not** invent `succeeded` from a failed `status` — callers pass the
 * explicit {@link RefundOperationOutcome}; `success` is derived only from that.
 * Prefer building base fields from the provider response, then:
 * `applyOutcomeToGatewayRefundResult(base, outcome)`.
 */
export function applyOutcomeToGatewayRefundResult(
    base: ApplyOutcomeGatewayRefundBase,
    outcome: RefundOperationOutcome,
    extras?: {
        reconciliationRequired?: boolean;
    },
): GatewayRefundResult {
    const success = successFromRefundOutcome(outcome);

    const result: GatewayRefundResult = {
        success,
        outcome,
        gatewayRefundId: base.gatewayRefundId,
        status: base.status,
        rawResponse: base.rawResponse,
    };

    if (base.totalRefunded !== undefined) {
        result.totalRefunded = base.totalRefunded;
    }
    if (base.refundedAt !== undefined) {
        result.refundedAt = base.refundedAt;
    }
    if (base.providerRequestId !== undefined) {
        result.providerRequestId = base.providerRequestId;
    }

    if (outcome === "indeterminate") {
        result.reconciliationRequired = true;
    } else if (extras?.reconciliationRequired === true) {
        result.reconciliationRequired = true;
    }

    return result;
}

/**
 * Infer {@link RefundOperationOutcome} from a 0.x {@link GatewayRefundResult}.
 */
export function inferRefundOperationOutcome(
    result: GatewayRefundResult,
): RefundOperationOutcome {
    // CORE-1: match payment recon-first guards — uncertainty beats an explicit
    // `outcome: 'succeeded'` so uncertain refunds never settle as completed.
    if (
        result.reconciliationRequired === true ||
        hasRawIndeterminateMarker(result.rawResponse)
    ) {
        return "indeterminate";
    }
    if (result.outcome !== undefined) {
        return result.outcome;
    }
    if (result.status === "completed" && result.success) {
        return "succeeded";
    }
    if (result.status === "pending" && result.success) {
        return "pending";
    }
    if (result.status === "failed" || !result.success) {
        return "failed";
    }
    return "pending";
}

/**
 * CORE-2: keep Phase-6 outcome arms consistent with gateway refund status.
 * Explicit `outcome: succeeded` must not invent a completed refund when the
 * gateway still reports pending/failed (and the reverse for pending+completed).
 */
function coerceRefundOutcomeToGatewayStatus(
    outcome: RefundOperationOutcome,
    gatewayStatus: GatewayRefundResult["status"],
): RefundOperationOutcome {
    if (outcome === "succeeded") {
        if (gatewayStatus === "pending") return "pending";
        if (gatewayStatus === "failed") return "failed";
        return outcome;
    }
    if (outcome === "pending") {
        if (gatewayStatus === "failed") return "failed";
        if (gatewayStatus === "completed") return "succeeded";
        return outcome;
    }
    return outcome;
}

/**
 * Map a {@link GatewayRefundResult} to {@link RefundOperationResult}.
 */
export function mapGatewayRefundToOperationResult(
    result: GatewayRefundResult,
): RefundOperationResult {
    const outcome = inferRefundOperationOutcome(result);

    const resolvedOutcome = coerceRefundOutcomeToGatewayStatus(
        outcome,
        result.status,
    );

    switch (resolvedOutcome) {
        case "succeeded":
            return {
                outcome: "succeeded",
                refundId: result.gatewayRefundId,
                status: "completed",
                ...(result.totalRefunded !== undefined
                    ? { totalRefunded: result.totalRefunded }
                    : {}),
            };
        case "pending":
            return {
                outcome: "pending",
                refundId: result.gatewayRefundId,
                status: "pending",
                ...(result.totalRefunded !== undefined
                    ? { totalRefunded: result.totalRefunded }
                    : {}),
            };
        case "failed":
            return {
                outcome: "failed",
                refundId: result.gatewayRefundId,
                status: "failed",
                error: {
                    name: "PaymentError",
                    message: "Refund operation failed",
                    code: "REFUND_FAILED",
                },
            };
        case "indeterminate": {
            const ind: Extract<
                RefundOperationResult,
                { outcome: "indeterminate" }
            > = {
                outcome: "indeterminate",
                reconciliationRequired: true,
            };
            if (result.gatewayRefundId) {
                ind.refundId = result.gatewayRefundId;
            }
            if (result.providerRequestId !== undefined) {
                ind.providerRequestId = result.providerRequestId;
            }
            return ind;
        }
    }
}
