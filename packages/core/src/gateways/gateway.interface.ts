// file: packages/payments/src/gateways/gateway.interface.ts

import type {
    PaymentStatus,
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    VoidParams,
    GetPaymentParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type {
    AttachPaymentMethodParams,
    CreateCustomerParams,
    CustomerOperationResult,
    DetachPaymentMethodParams,
    GetCustomerParams,
    ListPaymentMethodsParams,
    ListPaymentMethodsResult,
    PaymentMethodOperationResult,
} from '../types/customer.types';
import type {
    CommonCheckoutSessionInput,
    CheckoutSessionOperationResult,
    GetCheckoutSessionParams,
} from '../types/checkout.types';
import type {
    GetDisputeParams,
    ListDisputesParams,
    ListDisputesResult,
    DisputeOperationResult,
    SubmitDisputeEvidenceParams,
} from '../types/dispute.types';
import type {
    CreatePaymentLinkParams,
    DeactivatePaymentLinkParams,
    GetPaymentLinkParams,
    PaymentLinkOperationResult,
} from '../types/payment-link.types';
import type { WebhookEvent } from '../types/webhook.types';
import type {
    GatewayCapabilities,
    GatewayCapabilityKey,
} from './gateway-capabilities';

/**
 * Payment gateway interface that all gateway implementations must follow.
 *
 * @typeParam TName - Stable gateway identifier. Built-ins use their const name
 *   (`"stripe"`, …); third-party adapters may use any non-empty string.
 */
export interface PaymentGateway<TName extends string = string> {
    /** Gateway identifier (built-in or registered custom name) */
    readonly name: TName;

    /**
     * Frozen, complete capability snapshot for this instance.
     * Always contains every {@link GatewayCapabilityKey} (true or false).
     * Source of truth for {@link supports}; do not infer support from optional
     * methods alone.
     *
     * {@link import('./base.gateway').BaseGateway} defaults to all-false when
     * subclasses omit explicit claims (fail-closed for third-party adapters).
     */
    readonly capabilities: GatewayCapabilities;

    /**
     * Whether this gateway claims support for `capability`.
     * Returns `false` for unclaimed keys. Prefer this over duck-typing optional methods.
     */
    supports(capability: GatewayCapabilityKey): boolean;

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Payment Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a new payment
     */
    createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;

    /**
     * Capture an authorized payment
     */
    capturePayment(params: CaptureParams): Promise<GatewayPaymentResult>;

    /**
     * Refund a payment (full or partial)
     */
    refundPayment(params: RefundParams): Promise<GatewayRefundResult>;

    /**
     * Void/cancel an authorized payment before capture.
     * Releases the hold on customer's funds.
     */
    voidPayment?(params: VoidParams): Promise<GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Handling
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Verify webhook signature/authenticity (synchronous)
     */
    verifyWebhook(
        payload: unknown,
        signature?: string,
        headers?: Record<string, string>,
    ): boolean;

    /**
     * Verify webhook signature/authenticity asynchronously.
     * Required for gateways like PayPal that need API calls for verification.
     * If not implemented, the SDK falls back to synchronous verifyWebhook.
     *
     * @param payload - The raw webhook payload
     * @param signatureOrHeaders - Either a signature string, or headers object for gateways that need multiple headers
     * @param headers - Optional headers object when signature is passed separately
     */
    verifyWebhookAsync?(
        payload: unknown,
        signatureOrHeaders?: string | Record<string, string>,
        headers?: Record<string, string>,
    ): Promise<boolean>;

    /**
     * Parse gateway-specific webhook into normalized {@link WebhookEvent}.
     *
     * Implementations should keep 0.x fields (`type` = provider-native,
     * `rawPayload` request-local) and dual-write Phase 7 fields via
     * {@link import('../types/payment-event').attachPaymentEvent}
     * (`event`, `stableType`, `provider`, optional `payloadHash`).
     * {@link import('../client').PaymentClient.handleWebhook} also attaches
     * if `event` is missing (custom-gateway safety net).
     */
    parseWebhookEvent(payload: unknown): WebhookEvent;

    // ═══════════════════════════════════════════════════════════════════════════
    // Optional Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Retrieve full payment details by gateway ID
     * @param params - Parameters containing the gateway payment ID
     */
    getPayment?(params: GetPaymentParams): Promise<GatewayPaymentResult>;

    /**
     * Get current status of a payment
     */
    getPaymentStatus?(gatewayId: string): Promise<PaymentStatus>;

    /**
     * Create a hosted checkout session (capability `hostedCheckout`).
     * Not every provider redirect URL — first-class Checkout Session product.
     */
    createCheckoutSession?(
        params: CommonCheckoutSessionInput,
    ): Promise<CheckoutSessionOperationResult>;

    /**
     * Retrieve a hosted checkout session (capability `hostedCheckout`).
     */
    getCheckoutSession?(
        params: GetCheckoutSessionParams,
    ): Promise<CheckoutSessionOperationResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Customers and stored payment methods (Phase 22.1)
    // Capability-gated: `customers` / `paymentMethods`. Never persist PAN/CVC.
    // ═══════════════════════════════════════════════════════════════════════════

    createCustomer?(params: CreateCustomerParams): Promise<CustomerOperationResult>;

    getCustomer?(params: GetCustomerParams): Promise<CustomerOperationResult>;

    attachPaymentMethod?(
        params: AttachPaymentMethodParams,
    ): Promise<PaymentMethodOperationResult>;

    listPaymentMethods?(
        params: ListPaymentMethodsParams,
    ): Promise<ListPaymentMethodsResult>;

    detachPaymentMethod?(
        params: DetachPaymentMethodParams,
    ): Promise<PaymentMethodOperationResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Disputes (Phase 22.3) — capability `disputes`
    // ═══════════════════════════════════════════════════════════════════════════

    getDispute?(params: GetDisputeParams): Promise<DisputeOperationResult>;

    listDisputes?(params: ListDisputesParams): Promise<ListDisputesResult>;

    submitDisputeEvidence?(
        params: SubmitDisputeEvidenceParams,
    ): Promise<DisputeOperationResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment links (Phase 22.5) — capability `paymentLinks`
    // ═══════════════════════════════════════════════════════════════════════════

    createPaymentLink?(
        params: CreatePaymentLinkParams,
    ): Promise<PaymentLinkOperationResult>;

    getPaymentLink?(
        params: GetPaymentLinkParams,
    ): Promise<PaymentLinkOperationResult>;

    deactivatePaymentLink?(
        params: DeactivatePaymentLinkParams,
    ): Promise<PaymentLinkOperationResult>;
}
