// file: packages/payments/src/hooks/hooks.types.ts

import type {
    GatewayId,
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    VoidParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type { WebhookEvent } from '../types/webhook.types';

/**
 * Operation types that can have hooks attached
 */
export type OperationType =
    | 'createPayment'
    | 'authorizePayment'
    | 'capturePayment'
    | 'refundPayment'
    | 'voidPayment'
    | 'confirmStcPayOtp'
    | 'verifyWebhook'
    | 'getPayment'
    | 'getCheckoutSession'
    | 'createCheckoutSession'
    | 'createCustomer'
    | 'getCustomer'
    | 'attachPaymentMethod'
    | 'listPaymentMethods'
    | 'detachPaymentMethod'
    | 'getDispute'
    | 'listDisputes'
    | 'submitDisputeEvidence'
    | 'createPaymentLink'
    | 'getPaymentLink'
    | 'deactivatePaymentLink';

/**
 * Context passed to all lifecycle hooks
 */
export interface HookContext<T = unknown> {
    /** Which gateway is executing (built-in or registered custom {@link GatewayId}) */
    gateway: GatewayId;
    /** Which operation is being performed */
    operation: OperationType;
    /** Operation parameters */
    params: T;
    /** When the operation started */
    timestamp: Date;
    /** Mutable metadata bag for inter-hook communication */
    metadata: Record<string, unknown>;
}

/**
 * Result from a before hook
 */
export interface BeforeHookResult<T = unknown> {
    /** If false, the operation will be aborted */
    proceed: boolean;
    /** Modified params to use instead (optional) */
    params?: T;
    /** Reason for aborting if proceed=false */
    abortReason?: string;
}

/**
 * Result from an after hook
 */
export interface AfterHookResult<R = unknown> {
    /**
     * If false, ignored: later after-handlers still run and the successful
     * gateway result is still returned (after hooks cannot abort committed
     * money operations). Money identity fields on `modifiedResult` are restored
     * from the original gateway result.
     */
    proceed: boolean;
    /**
     * Modified result to return instead (optional). Prefer additive fields
     * only; money/identity fields are restored from the original result.
     */
    modifiedResult?: R;
}

/**
 * Before hook function signature
 */
export type BeforeHook<T = unknown> = (
    ctx: HookContext<T>
) => Promise<BeforeHookResult<T>> | BeforeHookResult<T>;

/**
 * After hook function signature.
 *
 * ⚠️ An after hook runs AFTER the gateway operation has already executed and
 * succeeded. Returning `proceed: false` is **ignored** (later after-handlers
 * still run; the successful result is still returned). Throwing from an after
 * hook is **isolated** (logged) and does **not** fail the operation or drop
 * earlier `modifiedResult` values — analytics/side-channel failures must not
 * become retryable payment failures. Use after hooks to inspect or attach
 * additive fields via `modifiedResult`; do **not** use them to "cancel" a
 * committed operation or to change money identity fields (`success`, `status`,
 * `amount`, `gatewayId`, capture/order/authorization IDs, refund totals, `fee`,
 * `capturedAmount`, `refundedAmount`, `clientSecret`, etc.) — including via
 * in-place mutation of the result argument. Money identity is restored
 * **between** composed after-hooks (and specific → `onAfter`), not only on the
 * client return path, so later handlers never see a forged paid/status/amount.
 * The gateway also freezes those fields from the original result (shallow-cloned
 * into hooks so mutation cannot poison the snapshot). Throws and
 * `proceed: false` are logged and ignored.
 */
export type AfterHook<T = unknown, R = unknown> = (
    ctx: HookContext<T>,
    result: R
) => Promise<AfterHookResult<R>> | AfterHookResult<R>;

/**
 * Error hook function signature
 */
export type ErrorHook = (
    ctx: HookContext,
    error: Error
) => Promise<void> | void;

/**
 * Webhook-specific hook signatures
 */

/**
 * Called the moment a webhook payload arrives, BEFORE signature verification.
 *
 * ⚠️ SECURITY: The payload here is UNVERIFIED and UNTRUSTED — anyone who can
 * reach your webhook endpoint can trigger this hook with arbitrary data. Use it
 * only for side-effect-free work such as request logging or metrics. Do NOT
 * mutate state, fulfill orders, or trust any field. Put side-effect-sensitive
 * logic in {@link WebhookVerifiedHook}, which only runs after verification
 * succeeds.
 */
export type WebhookReceivedHook = (
    gateway: GatewayId,
    payload: unknown
) => Promise<void> | void;

export type WebhookVerifiedHook = (
    event: WebhookEvent
) => Promise<void> | void;

export type WebhookFailedHook = (
    payload: unknown,
    error: Error
) => Promise<void> | void;

/**
 * Complete hooks configuration
 */
export interface PaymentHooks {
    // ═══════════════════════════════════════════════════════════════════════════
    // Global hooks (all gateways, all operations)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before any operation */
    onBefore?: BeforeHook;
    /** Called after any successful operation */
    onAfter?: AfterHook;
    /**
     * Called when the gateway executor/API path throws (mapped error).
     * Not invoked for before-hook aborts (`PaymentAbortedError` from
     * `proceed: false`), nor for after-hook `proceed: false` / throws
     * (those never fail the successful operation).
     */
    onError?: ErrorHook;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment creation hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before creating a payment */
    beforeCreatePayment?: BeforeHook<CreatePaymentParams>;
    /** Called after payment is created */
    afterCreatePayment?: AfterHook<CreatePaymentParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment authorization hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before authorizing an approved payment */
    beforeAuthorize?: BeforeHook<CaptureParams>;
    /** Called after payment is authorized */
    afterAuthorize?: AfterHook<CaptureParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment capture hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before capturing an authorized payment */
    beforeCapture?: BeforeHook<CaptureParams>;
    /** Called after payment is captured */
    afterCapture?: AfterHook<CaptureParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Refund hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before processing a refund */
    beforeRefund?: BeforeHook<RefundParams>;
    /** Called after refund is processed */
    afterRefund?: AfterHook<RefundParams, GatewayRefundResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Void hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before voiding a payment */
    beforeVoid?: BeforeHook<VoidParams>;
    /** Called after payment is voided */
    afterVoid?: AfterHook<VoidParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Called when a webhook is received, BEFORE verification.
     * ⚠️ The payload is UNVERIFIED/UNTRUSTED — keep this side-effect-free
     * (logging/metrics only). Put trusted, state-changing logic in
     * {@link onWebhookVerified}.
     */
    onWebhookReceived?: WebhookReceivedHook;
    /** Called after webhook is verified and parsed (payload is trusted here) */
    onWebhookVerified?: WebhookVerifiedHook;
    /**
     * Called when webhook **verification** fails (`isVerified === false` or
     * verify throws). Not called for pure parse failures after a successful
     * verify — those rethrow without this hook.
     */
    onWebhookFailed?: WebhookFailedHook;
}
