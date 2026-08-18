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
 *
 * **Money completeness:** major-unit amount fields without {@link currency} are
 * incomplete. {@link paymentFromGatewayResult} omits amount-like fields when
 * `currency` is missing (fail-closed) so callers never see a naked major-unit
 * number that cannot be re-scaled safely.
 */
export type Payment = {
    /** Normalized payment lifecycle status (domain status preferred). */
    status: PaymentDomainStatus | PaymentStatus;
    /** Major currency units (0.x); may become Money at 1.0 */
    amount?: number;
    /** ISO 4217 code; required for a complete money snapshot when amount-like fields are set */
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

/** Non-empty ISO 4217-ish code; required to publish any major-unit amount. */
function publishableCurrency(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toUpperCase() : undefined;
}

function isFiniteAmount(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

type AmountLikeSource = {
    amount?: number | undefined;
    currency?: string | undefined;
    fee?: number | undefined;
    capturedAmount?: number | undefined;
    refundedAmount?: number | undefined;
};

/**
 * Copy currency + finite major-unit amounts together (NEW-MONEY-1).
 * Omits incomplete money (no currency, or non-finite amounts). Currency-only
 * snapshots are still published.
 */
function assignPublishableMoneyFields(
    target: AmountLikeSource,
    source: AmountLikeSource,
): void {
    const currency = publishableCurrency(source.currency);
    if (currency === undefined) {
        return;
    }
    target.currency = currency;
    if (isFiniteAmount(source.amount)) {
        target.amount = source.amount;
    }
    if (isFiniteAmount(source.fee)) {
        target.fee = source.fee;
    }
    if (isFiniteAmount(source.capturedAmount)) {
        target.capturedAmount = source.capturedAmount;
    }
    if (isFiniteAmount(source.refundedAmount)) {
        target.refundedAmount = source.refundedAmount;
    }
}

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
 *
 * **CORE-1 / NEW-MONEY-1 / fail-closed money:** amount-like major-unit fields
 * (`amount`, `fee`, `capturedAmount`, `refundedAmount`) are copied only when
 * `result.currency` is a non-empty string **and** the value is
 * {@link Number.isFinite}. A major-unit number without currency (or NaN /
 * ±Infinity) cannot be re-scaled safely and is omitted rather than published
 * incomplete. Currency alone (no amounts) is still copied when present.
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

    if (result.redirectUrl !== undefined) payment.redirectUrl = result.redirectUrl;
    if (result.clientSecret !== undefined) payment.clientSecret = result.clientSecret;
    if (result.nextAction !== undefined) payment.nextAction = result.nextAction;

    assignPublishableMoneyFields(payment, result);

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
 * - Card/hard declines → `declined`; cancelled/voided without explicit
 *   `outcome: succeeded` → `failed`. Intentional voids dual-write
 *   `outcome: succeeded` + `status: cancelled` (CORE-2) and map as succeeded
 *   (still not {@link isPaidOutcome}).
 * - Partial capture: gateways may set `outcome: requires_action` with status
 *   `partially_captured` (CORE-1); Phase-6 must not upgrade that to succeeded.
 *   Bare `{ success: true, status: 'partially_captured' }` (no outcome) also
 *   infers `requires_action` — open money is not a settled operation.
 * - Bare pending/processing without action still → `requires_action` so callers
 *   never fulfill on non-terminal state.
 * - `success: false` (or omitted) + pending/processing/approved **or** a
 *   paid/authorized/partial/refunded / incomplete-refund (`refund_completed` /
 *   `refund_pending`) / `reversed` snapshot → `indeterminate` (not `failed`):
 *   the mutation may have been accepted; do not forge a decline (CORE-INF-1 /
 *   NEW-CORE-9).
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
        // Do not trust explicit outcome over gateway status — same
        // fail-closed family as coerceRefundOutcomeToGatewayStatus.
        return coercePaymentOutcomeToGatewayStatus(result.outcome, result);
    }

    if (result.decline !== undefined) {
        return "declined";
    }

    // CORE-4: paid-like / settled statuses win over residual nextAction so a
    // leftover action blob cannot under-fulfill a already-paid snapshot.
    if (result.success && isSettledSuccessStatus(result.status)) {
        return "succeeded";
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
        // P610-INF-2 / CORE-INF-1: API-not-ok (or omitted success) with a
        // non-terminal, pre-capture, settled, or refunded snapshot is uncertain
        // (request may have been accepted). Do not forge a definitive failure
        // — retry-as-failed can double-charge or double-refund.
        if (
            result.status === "pending" ||
            result.status === "processing" ||
            result.status === "approved" ||
            result.status === "paid" ||
            result.status === "authorized" ||
            result.status === "partially_captured" ||
            result.status === "refunded" ||
            result.status === "partially_refunded" ||
            result.status === "refund_completed" ||
            result.status === "refund_pending" ||
            result.status === "reversed"
        ) {
            return "indeterminate";
        }
        return "failed";
    }

    // success: true (API call completed — not necessarily paid)
    if (isSettledSuccessStatus(result.status)) {
        return "succeeded";
    }

    if (
        result.status === "pending" ||
        result.status === "processing" ||
        result.status === "approved" ||
        result.status === "partially_captured" ||
        result.status === "refund_completed"
    ) {
        // Non-terminal / pre-capture / open partial capture / incomplete refund
        // snapshot: never succeeded.
        // Prefer requires_action so fulfillment gates stay closed (clientSecret,
        // bare pending intention, PayPal buyer APPROVED, leftover auth, etc.).
        return "requires_action";
    }

    if (result.status === "failed") {
        return "declined";
    }

    // cancelled / unknown — not a successful payment capture
    return "failed";
}

/**
 * Statuses where API success implies operation outcome `succeeded`.
 * Outcome-only: `isPaidOutcome` remains `paid` exclusively.
 * `partially_captured` is open money — not settled-success.
 */
function isSettledSuccessStatus(status: GatewayPaymentResult["status"]): boolean {
    return (
        status === "paid" ||
        status === "authorized" ||
        status === "refunded" ||
        status === "partially_refunded"
    );
}

/**
 * Keep Phase-6 payment outcome arms consistent with gateway status.
 * Explicit `outcome: succeeded` must not invent a paid/settled op when status
 * is still pending/failed (refund-style coerce parity).
 *
 * CORE-1: do not upgrade gateway-demoted `requires_action` on
 * `partially_captured` (open capture story) back to `succeeded`.
 * CORE-2: intentional void dual-writes `outcome: succeeded` + `status: cancelled`
 * — preserve that as operation success (not charge paid; {@link isPaidOutcome} false).
 * NEW-CORE-6: `declined` / `failed` must not persist on paid-like status —
 * demote to `succeeded` so fulfillment gates stay honest.
 * NEW-CORE-10: `requires_action` + `status: failed` is a decline, not
 * `success: true` (do not persist an action arm on a failed snapshot).
 */
function coercePaymentOutcomeToGatewayStatus(
    outcome: PaymentOperationOutcome,
    result: GatewayPaymentResult,
): PaymentOperationOutcome {
    if (outcome === "indeterminate") {
        return "indeterminate";
    }
    if (outcome === "succeeded") {
        if (result.decline !== undefined || result.status === "failed") {
            return "declined";
        }
        // CORE-2: successful void is outcome succeeded + status cancelled.
        // Bare cancelled (no explicit outcome) still fails closed via infer.
        if (result.status === "cancelled") {
            return "succeeded";
        }
        if (
            result.status === "pending" ||
            result.status === "processing" ||
            result.status === "approved" ||
            result.status === "partially_captured" ||
            result.status === "refund_completed"
        ) {
            return "requires_action";
        }
        // residual nextAction on paid-like status: keep succeeded
        return "succeeded";
    }
    if (outcome === "requires_action") {
        // NEW-CORE-10: a failed snapshot is a decline, not customer action.
        // `successFromOutcome(requires_action)` is true — do not persist that.
        if (result.status === "failed") {
            return "declined";
        }
        // CORE-1: partial capture is open money — Paymob/Stripe demote to
        // requires_action; do not upgrade via settled-status coerce.
        if (
            result.status === "partially_captured" ||
            result.status === "refund_completed"
        ) {
            return "requires_action";
        }
        // Explicit requires_action must not under-fulfill fully settled money
        // (paid / authorized / refunded / partially_refunded).
        if (result.success && isSettledSuccessStatus(result.status)) {
            return "succeeded";
        }
        return outcome;
    }
    if (outcome === "declined" || outcome === "failed") {
        // NEW-CORE-6: a paid-like snapshot is settled money — do not persist a
        // decline/fail that would close fulfillment while status stays paid.
        if (isPaidLikePaymentStatus(result.status)) {
            return "succeeded";
        }
        return outcome;
    }
    return outcome;
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
    /** ISO 4217 code for major-unit money fields; prefer always set when amount is set. */
    currency?: string | undefined;
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
 * `reconciliationRequired` is attached **only** for `outcome: 'indeterminate'`.
 * After apply, stored `outcome` matches {@link inferOperationOutcome} (do not
 * attach recon on a non-indeterminate write — that would flip infer).
 *
 * **Do not fulfill on `success` alone.** Use {@link isPaidOutcome} or
 * `outcome === 'succeeded'` with a paid-like {@link PaymentStatus}.
 *
 * **CORE-5:** stored `outcome` / `success` are coerced against `base.status`
 * (same family as {@link inferOperationOutcome}). `outcome: 'succeeded'` with
 * `status: 'failed'` / `'pending'` is never persisted as `success: true` +
 * `outcome: 'succeeded'`.
 *
 * **NEW-CORE-6:** `declined` / `failed` with paid-like `status` is stored as
 * `succeeded` (status wins) so `isPaidOutcome` stays honest.
 *
 * **NEW-MONEY-1:** amount-like major-unit fields are copied only with a
 * non-empty `currency` and a finite number. Currency is always published
 * together with those amounts (currency-only snapshots are still allowed).
 */
export function applyOutcomeToGatewayResult(
    base: ApplyOutcomeGatewayBase,
    outcome: PaymentOperationOutcome,
    extras?: {
        decline?: PaymentDecline;
        action?: PaymentAction;
        /**
         * Ignored unless `outcome` is `indeterminate`. Never attach
         * `reconciliationRequired` on a settled/action/decline/failed write —
         * that would make {@link inferOperationOutcome} disagree with stored
         * `outcome`.
         */
        reconciliationRequired?: boolean;
    },
): GatewayPaymentResult {
    const decline = extras?.decline ?? base.decline;
    const storedOutcome = coercePaymentOutcomeToGatewayStatus(outcome, {
        success: successFromOutcome(outcome),
        gatewayId: base.gatewayId,
        status: base.status,
        redirectUrl: base.redirectUrl,
        rawResponse: base.rawResponse,
        ...(decline !== undefined ? { decline } : {}),
    });
    const success = successFromOutcome(storedOutcome);

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
        outcome: storedOutcome,
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
    assignPublishableMoneyFields(result, base);
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

    if (decline !== undefined && storedOutcome === "declined") {
        result.decline = decline;
    }

    // Only the indeterminate arm is a reconciliation signal. Attaching the
    // flag on any other outcome makes infer() return indeterminate while
    // stored `outcome` stays something else (dual-write lie).
    if (storedOutcome === "indeterminate") {
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
 * **NEW-CORE-5:** stored `outcome` / `success` are coerced against `base.status`
 * (same family as {@link inferRefundOperationOutcome} /
 * {@link applyOutcomeToGatewayResult}). `outcome: 'succeeded'` with
 * `status: 'pending'` / `'failed'` is never persisted as a settled success.
 * Prefer building base fields from the provider response, then:
 * `applyOutcomeToGatewayRefundResult(base, outcome)`.
 */
export function applyOutcomeToGatewayRefundResult(
    base: ApplyOutcomeGatewayRefundBase,
    outcome: RefundOperationOutcome,
    extras?: {
        /**
         * Ignored unless the stored (coerced) `outcome` is `indeterminate`.
         * Never attach `reconciliationRequired` on a succeeded/pending/failed write.
         */
        reconciliationRequired?: boolean;
    },
): GatewayRefundResult {
    const storedOutcome = coerceRefundOutcomeToGatewayStatus(
        outcome,
        base.status,
    );
    const success = successFromRefundOutcome(storedOutcome);

    const result: GatewayRefundResult = {
        success,
        outcome: storedOutcome,
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

    if (storedOutcome === "indeterminate") {
        result.reconciliationRequired = true;
    }

    return result;
}

/**
 * Payment snapshot when a mutation left the process with no settled provider
 * response (timeout / drop / 5xx after POST). Callers must reconcile — do not
 * retry the mutation as a fresh failure.
 */
export function applyIndeterminatePaymentOutcome(input: {
    gateway: string;
    gatewayId: string;
    message: string;
    errorName: string;
}): GatewayPaymentResult {
    return applyOutcomeToGatewayResult(
        {
            gatewayId: input.gatewayId,
            status: "processing",
            rawResponse: {
                indeterminate: true,
                message: input.message,
                name: input.errorName,
            },
            gateway: input.gateway,
        },
        "indeterminate",
    );
}

/**
 * Refund twin of {@link applyIndeterminatePaymentOutcome}.
 */
export function applyIndeterminateRefundOutcome(input: {
    gatewayRefundId: string;
    message: string;
    errorName: string;
}): GatewayRefundResult {
    return applyOutcomeToGatewayRefundResult(
        {
            gatewayRefundId: input.gatewayRefundId,
            status: "pending",
            rawResponse: {
                indeterminate: true,
                message: input.message,
                name: input.errorName,
            },
        },
        "indeterminate",
    );
}

/**
 * Infer {@link RefundOperationOutcome} from a 0.x {@link GatewayRefundResult}.
 *
 * **CORE-1:** Explicit `outcome` is coerced against gateway `status` (same
 * family as {@link inferOperationOutcome} / `mapGatewayRefundToOperationResult`).
 * Bare callers must not treat `outcome: 'succeeded'` as settled while status is
 * still `pending` (or reverse under-report pending when status is completed).
 *
 * **P610-INF-2:** `success: false` (or omitted `success`) + `pending` /
 * `processing` / `approved` is **indeterminate**, not `failed`.
 * **CORE-INF-2:** the same rule applies to `status: "completed"` — `success`
 * is not a decline; retry-as-failed can double-refund.
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
        // CORE-1: do not trust explicit outcome over gateway status — same
        // coerce as mapGatewayRefundToOperationResult (payment path parity).
        return coerceRefundOutcomeToGatewayStatus(result.outcome, result.status);
    }
    if (result.status === "completed" && result.success) {
        return "succeeded";
    }
    if (result.status === "pending" && result.success) {
        return "pending";
    }
    // P610-INF-2 / CORE-INF-2: success:false (or omitted success) +
    // pending/processing/approved/completed is uncertain — the refund request
    // may have been accepted (`completed` + success already returned succeeded
    // above). Do not forge a definitive `failed` (retry can double-refund).
    const status = result.status as string;
    if (
        !result.success &&
        (status === "pending" ||
            status === "processing" ||
            status === "approved" ||
            status === "completed")
    ) {
        return "indeterminate";
    }
    if (result.status === "failed" || result.success === false) {
        return "failed";
    }
    return "pending";
}

/**
 * CORE-2 / NEW-CORE-9: keep Phase-6 outcome arms consistent with gateway
 * refund status. Explicit `outcome: succeeded` must not invent a completed
 * refund when the gateway still reports pending/failed (and the reverse for
 * pending+completed). Explicit `failed` must not persist on `completed` —
 * status wins (`succeeded`) so a settled refund is not a retryable fail.
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
    if (outcome === "failed" && gatewayStatus === "completed") {
        return "succeeded";
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
