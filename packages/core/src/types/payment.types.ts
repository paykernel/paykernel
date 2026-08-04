// file: packages/payments/src/types/payment.types.ts

import type {
    CreditCardSource,
    MoyasarPaymentSource,
} from "./moyasar-source.types";
import type { Money } from "../utils/money";
import type { PaymentDomainStatus } from "./domain-status";
import type { ProviderReferences } from "./provider-refs";
import type {
    PaymentDecline,
    PaymentOperationOutcome,
    RefundOperationOutcome,
} from "./operation-result";

/**
 * Amount input accepted during 0.x.
 *
 * Prefer {@link Money} / `money("10.50", "SAR")` (decimal string + currency).
 * Plain `number` major units remain accepted for backward compatibility but are
 * **deprecated** — JS floats cannot represent all decimals exactly. Convert
 * with shared money helpers (`normalizeAmountInput` / `toMinorUnits`); never
 * use `amount * 100` float math at call sites.
 */
export type AmountInput = number | Money;

/**
 * Built-in first-party gateway names shipped with this package.
 */
export type BuiltInGatewayName = "moyasar" | "paypal" | "paymob" | "stripe";

/**
 * Open gateway identifier for plugin/registry contracts.
 *
 * Use this on {@link PaymentGateway}.name, hook context, webhook events, and
 * registry-typed client methods. Built-in names are assignable to {@link GatewayId}.
 */
export type GatewayId = string;

/**
 * Public 0.x alias for the closed built-in gateway name union.
 *
 * Open (third-party / registry) gateway names are typed as {@link GatewayId} or
 * via registry generics on the plugin client APIs — not by widening this alias.
 * Prefer {@link BuiltInGatewayName} when you mean only first-party gateways.
 */
export type GatewayName = BuiltInGatewayName;

/**
 * @deprecated Prefer domain-specific unions:
 * {@link PaymentDomainStatus}, {@link import('./domain-status').RefundDomainStatus},
 * {@link import('./domain-status').SetupTokenStatus}, etc.
 *
 * Legacy mega-union kept for 0.x: payment lifecycle **plus** refund-entity and
 * setup statuses historically mixed into a single field.
 *
 * Equivalent to:
 * `PaymentDomainStatus | 'refund_pending' | 'refund_completed' | 'refund_failed' | 'setup_completed'`.
 */
export type PaymentStatus =
    | PaymentDomainStatus
    | "refund_completed"
    | "refund_pending"
    | "refund_failed"
    | "setup_completed";

/**
 * Refund processing status (entity-level).
 * Alias-compatible with {@link import('./domain-status').RefundDomainStatus}.
 */
export type RefundStatus = "pending" | "completed" | "failed";

/**
 * Merchant metadata bag attached to create/refund params.
 */
export type PaymentMetadata = Record<string, unknown>;

/**
 * Shared options for provider network operations (create/capture/refund/void/get).
 *
 * Not mixed into {@link CommonPaymentInput} (money-focused) so provider
 * adapters that extend only money fields stay free of transport concerns.
 * Mixed into mutation/query param interfaces and checkout session params.
 *
 * Do **not** put `signal` on webhook events or payment/refund results.
 */
export interface OperationRequestOptions {
    /**
     * Optional cancellation for the underlying HTTP request(s).
     * Combined with the gateway timeout via {@link import('../runtime/abort').combineAbortSignals}.
     * Pre-aborted signals fail fast without hanging on the provider network.
     */
    signal?: AbortSignal;
}

/**
 * Common payment fields shared across providers — **no** provider-specific keys.
 *
 * Provider packages/adapters should extend this type rather than dumping
 * `stripe*` / `moyasar*` / `paypal*` / `paymob*` fields into a shared contract.
 *
 * @example
 * ```ts
 * type AcmeCreateParams = CommonPaymentInput & {
 *   currency: string;
 *   callbackUrl: string;
 *   acmeWalletId: string;
 * };
 * ```
 */
export type CommonPaymentInput = {
    /**
     * Prefer {@link Money}; plain `number` major units remain 0.x-deprecated
     * via {@link AmountInput}.
     */
    amount: AmountInput;
    /** Optional order/transaction ID for your system */
    orderId?: string;
    /** Payment description shown to customer */
    description?: string;
    /** Custom metadata to attach to payment */
    metadata?: PaymentMetadata;
};

/**
 * Parameters for creating a new payment.
 *
 * Common fields come from {@link CommonPaymentInput} plus `currency`,
 * `callbackUrl`, optional `capture` / `idempotencyKey`.
 *
 * Provider-specific fields (`stripe*`, `moyasar*`, `paypal*`, `paymob*`, etc.)
 * remain optional on this 0.x mega-interface for convenience. Prefer typed
 * extensions ({@link MoyasarCreatePaymentParams}, Stripe/PayPal/Paymob create
 * params) or extend {@link CommonPaymentInput} in custom adapters so common
 * contracts stay free of provider pollution.
 */
export interface CreatePaymentParams extends CommonPaymentInput, OperationRequestOptions {
    /**
     * Amount in major currency units (e.g., SAR, not halalas).
     *
     * **Preferred (0.x+):** pass {@link Money} from `money("10.50", "SAR")`
     * (decimal string + ISO currency). Internals convert via bigint minor units.
     *
     * **Deprecated:** plain JS `number` major units (e.g. `10.5`, `99.99`) for
     * backward compatibility. Pass clean decimals only — not the result of float
     * arithmetic like `0.1 + 0.2`. Float artifacts can fail strict precision
     * checks (`rounding: 'reject'`, the default). Prefer string-based Money.
     *
     * Response fields on {@link GatewayPaymentResult} still use `number` major
     * units in 0.x for shape stability (may switch to Money at 1.0).
     *
     * @see docs/money.md
     */
    amount: AmountInput;
    /** ISO 4217 currency code */
    currency: string;
    /** URL to redirect after payment completion */
    callbackUrl: string;

    /**
     * Whether to capture the payment immediately.
     * Default: true
     * Set to false to only authorize the amount (requires manual capture later).
     */
    capture?: boolean;

    /**
     * Idempotency key for safe retries (UUIDv4 recommended).
     * Moyasar: Maps to `given_id` - becomes the payment ID.
     * Prevents duplicate charges on network failures.
     */
    idempotencyKey?: string;

    // ═══════════════════════════════════════════════════════════════════════════
    // Stripe-specific fields (0.x convenience — prefer StripeCreatePaymentParams)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Stripe: Payment Method ID (from Stripe.js) */
    stripePaymentMethodId?: string;
    /** Stripe: Customer ID for saved payment methods */
    stripeCustomerId?: string;
    /** Stripe: Setup for future usage */
    stripeSetupFutureUsage?: 'on_session' | 'off_session';

    // ═══════════════════════════════════════════════════════════════════════════
    // Moyasar-specific fields (0.x convenience — prefer MoyasarCreatePaymentParams)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Moyasar payment source.
     * Supports: creditcard, token, applepay, samsungpay, stcpay.
     * Takes precedence over `tokenId` if both are provided.
     */
    moyasarSource?: MoyasarPaymentSource;

    /**
     * @deprecated Use `moyasarSource` with type 'token' instead.
     * Kept for backwards compatibility.
     * Moyasar: Card token from Moyasar.js
     */
    tokenId?: string;

    /** Moyasar: Whether to apply merchant coupon */
    applyCoupon?: boolean;

    // ═══════════════════════════════════════════════════════════════════════════
    // PayPal-specific fields (0.x convenience — prefer PayPalCreatePaymentParams)
    // ═══════════════════════════════════════════════════════════════════════════

    /** PayPal: Return URL after approval */
    returnUrl?: string;
    /** PayPal: Cancel URL if customer cancels */
    cancelUrl?: string;
    /** PayPal: Shipping collection behavior for the approval flow */
    paypalShippingPreference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";

    // ═══════════════════════════════════════════════════════════════════════════
    // Paymob-specific fields (0.x convenience — prefer PaymobCreatePaymentParams)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Paymob: Override configured Integration ID/payment method alias for this payment */
    paymobIntegrationId?: string | number;
    /** Paymob: Explicit payment methods array for Intention API */
    paymobPaymentMethods?: Array<string | number>;
    /** Paymob: Legacy iframe ID override */
    paymobIframeId?: string | number;
    /** Paymob: Billing data sent to the Intention/payment key APIs */
    paymobBillingData?: {
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        country?: string;
        city?: string;
        street?: string;
        building?: string;
        apartment?: string;
        floor?: string;
        postalCode?: string;
        state?: string;
    };
}

/**
 * Moyasar payment source types that are safe to use from a merchant backend.
 * Raw credit card details must be sent directly from the customer device to Moyasar
 * or tokenized with Moyasar.js before reaching backend code.
 */
export type MoyasarBackendPaymentSource = Exclude<
    MoyasarPaymentSource,
    CreditCardSource
>;

/**
 * Moyasar split recipient for marketplace/platform payments.
 * Field names (except unit of `amount`) match Moyasar's API payload so callers
 * can copy examples from Moyasar docs without the SDK silently dropping them.
 *
 * **Amount units**: `amount` is in **major** currency units — the same unit as
 * top-level `createPayment` `amount` (e.g. `50` for 50.00 SAR). The SDK converts
 * each split to Moyasar's minor units (halalas/fils) before calling the API.
 * Moyasar requires a non-zero split amount; negative values are allowed by the
 * API where reverse splits are supported.
 */
export interface MoyasarPaymentSplit {
    /**
     * Split amount in major currency units (e.g. `50` / `money("50", "SAR")`).
     * Converted to minor units for the Moyasar API. Must be non-zero.
     * Negative values are allowed by Moyasar where reverse splits are supported
     * (`allowNegative` on conversion). Prefer {@link Money}; `number` is deprecated.
     */
    amount: AmountInput;
    recipient_id: string;
    reference?: string;
    description?: string;
    fee_source?: boolean;
    refundable?: boolean;
}

/**
 * Moyasar AFT recipient payload.
 * Required only for Account Funding Transaction payment creation.
 */
export interface MoyasarAftRecipient {
    first_name: string;
    last_name: string;
    middle_name?: string;
    address: string;
    street_name?: string;
    postal_code?: string;
    locality?: string;
    country?: string;
    building_number?: string;
}

/**
 * Moyasar AFT sender payload.
 * Required only for Account Funding Transaction payment creation.
 */
export interface MoyasarAftSender {
    account: {
        funds_source: string;
        number: string;
    };
    first_name: string;
    last_name: string;
    address: string;
    locality?: string;
    postal_code?: string;
    administrative_area?: string;
    country_code: string;
    id_type:
    | "ARNB"
    | "BTHD"
    | "CPNY"
    | "CUID"
    | "DRLN"
    | "EMAL"
    | "LAWE"
    | "MILI"
    | "NTID"
    | "PASN"
    | "PHON"
    | "PRXY"
    | "SSNB"
    | "TRVL";
    id: string;
    phone_number: string;
}

/**
 * Moyasar-specific create params. Moyasar only requires callbackUrl for card
 * token flows; STC Pay, Apple Pay, and Samsung Pay can omit it.
 */
export interface MoyasarCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl" | "moyasarSource"> {
    callbackUrl?: string;
    moyasarSource?: MoyasarBackendPaymentSource;
    /** Moyasar marketplace/platform split instructions. */
    splits?: MoyasarPaymentSplit[];
    /** Moyasar AFT recipient information. */
    recipient?: MoyasarAftRecipient;
    /** Moyasar AFT sender information. */
    sender?: MoyasarAftSender;
}

/**
 * Paymob-specific create params. Paymob Intention API treats callback and
 * redirection URLs as optional per-payment overrides; dashboard callbacks can
 * be used instead, especially for non-card payment methods.
 */
export interface PaymobCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl"> {
    callbackUrl?: string;
}

/**
 * PayPal-specific create params. PayPal prefers `returnUrl` / `cancelUrl`;
 * `callbackUrl` is optional when `returnUrl` is provided. Runtime validation
 * requires at least one of `callbackUrl` | `returnUrl` for success return, and
 * at least one of `cancelUrl` | `callbackUrl` | `returnUrl` for cancel fallback.
 */
export interface PayPalCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl"> {
    callbackUrl?: string;
}

/**
 * Parameters for confirming an initiated Moyasar STC Pay payment with the OTP
 * sent to the customer's phone.
 */
export interface MoyasarConfirmStcPayOtpParams extends OperationRequestOptions {
    /** The `source.transaction_url` returned from the initiated STC Pay payment. */
    transactionUrl: string;
    /** OTP value sent to the customer by SMS. */
    otpValue: string | number;
}

/**
 * Parameters for capturing an authorized payment
 */
export interface CaptureParams extends OperationRequestOptions {
    /** Gateway's payment ID */
    gatewayPaymentId: string;
    /**
     * Amount to capture (optional, defaults to full amount).
     * Prefer {@link Money}; plain `number` major units are deprecated in 0.x.
     */
    amount?: AmountInput;
    /**
     * ISO 4217 currency code. Required when providing a partial capture
     * `amount` for Moyasar, PayPal, or Stripe (and similar gateways that need
     * currency to convert major units to minor units). Optional for full
     * captures that rely on the original payment currency at the gateway.
     */
    currency?: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
    /**
     * PayPal: which capture endpoint to call.
     * Default 'order' captures an approved CAPTURE-intent order.
     * Use 'authorization' with an authorization ID returned by PayPalGateway.authorizePayment().
     */
    paypalCaptureType?: "order" | "authorization";
    /**
     * PayPal authorization captures only: whether this is the final capture
     * for the authorization. Amount-dependent SDK defaults (PayPal API default
     * is `false`): omit `amount` (full remaining capture) → `true`; set
     * `amount` (partial) → `false` unless `paypalFinalCapture === true`.
     */
    paypalFinalCapture?: boolean;
}

/**
 * Parameters for refunding a payment
 */
export interface RefundParams extends OperationRequestOptions {
    /** Gateway's payment ID to refund */
    gatewayPaymentId: string;
    /**
     * Amount to refund (optional, undefined = full refund).
     * Prefer {@link Money}; plain `number` major units are deprecated in 0.x.
     */
    amount?: AmountInput;
    /** Reason for refund */
    reason?: string;
    /** Custom metadata to attach to the refund when the gateway supports it */
    metadata?: Record<string, unknown>;
    /** ISO 4217 currency code (required for PayPal partial refunds) */
    currency?: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
}

/**
 * Parameters for voiding a payment
 */
export interface VoidParams extends OperationRequestOptions {
    /** Gateway's payment ID to void */
    gatewayPaymentId: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
}

/**
 * Parameters for retrieving a payment
 */
export interface GetPaymentParams extends OperationRequestOptions {
    /** Gateway's payment ID to retrieve */
    gatewayPaymentId: string;
}

/**
 * Moyasar STC Pay OTP next step. `transactionUrl` is the OTP submission
 * endpoint (not a browser redirect) — pass it to `confirmStcPayOtp`.
 */
export type MoyasarStcPayOtpNextAction = {
    type: "stcpay_otp";
    transactionUrl: string;
    method: "POST";
    parameter: "otp_value";
};

/**
 * SDK-normalized browser/checkout redirect next step (Moyasar 3DS, Paymob
 * unified checkout, etc.).
 */
export type RedirectPaymentNextAction = {
    type: "redirect";
    /** Browser redirect URL (e.g. Moyasar 3DS `transaction_url`) */
    url?: string;
    /** Paymob unified checkout URL */
    checkoutUrl?: string;
    intentionId?: string;
    clientSecret?: string;
    paymentKeys?: unknown;
};

/**
 * Customer next-step after create/capture. Narrow on `type` for Moyasar STC Pay
 * OTP (`stcpay_otp`) and SDK-normalized redirects (`redirect`). Other providers
 * (e.g. Stripe `PaymentIntent.next_action`) may pass through provider-native
 * shapes under a free-form object.
 */
export type PaymentNextAction =
    | MoyasarStcPayOtpNextAction
    | RedirectPaymentNextAction
    | { type?: string; [key: string]: unknown };

/** @deprecated Prefer {@link PaymentNextAction}; alias kept for Moyasar-focused call sites. */
export type MoyasarNextAction = MoyasarStcPayOtpNextAction | { type: "redirect"; url: string };

/**
 * Result from gateway payment operations.
 *
 * ## Outcome vs success (Phase 6)
 *
 * Prefer {@link PaymentOperationOutcome} via the `outcome` field (and helpers
 * `isPaidOutcome` / `mapGatewayResultToOperationResult`). See
 * `docs/operation-results.md`.
 *
 * **`success` (deprecated for fulfillment decisions):** historically means
 * "the HTTP/API call completed without transport failure", **not** "customer
 * paid". Gateways may set `success: true` for pending / 3DS / requires_action.
 * Dual-written from `outcome` when using `applyOutcomeToGatewayResult`:
 * - `succeeded` | `requires_action` → `success: true`
 * - `declined` | `failed` | `indeterminate` → `success: false`
 *
 * **Never fulfill on `success` alone.** Use `outcome === 'succeeded'` with a
 * paid-like `status` (`paid` / `approved`), or `isPaidOutcome(result)`.
 *
 * **Indeterminate:** when present, always treat as non-terminal for money —
 * `outcome: 'indeterminate'` + `reconciliationRequired: true`. Do not treat as
 * a definitive decline.
 *
 * **After-hook freeze**: money / identity fields (`success`, `outcome`, `status`,
 * `amount`, `gatewayId`, capture/order/authorization/refund IDs, `fee`,
 * `capturedAmount`, `refundedAmount`, `clientSecret`, `references`,
 * `reconciliationRequired`, `providerRequestId`, …) are restored from the
 * original gateway result after after-hooks run. After-hooks may only attach
 * additive fields (and cannot flip outcomes via in-place mutation of the hook
 * argument either).
 */
export interface GatewayPaymentResult {
    /**
     * @deprecated Prefer `outcome`. Kept for 0.x.
     * Means API/call completed without transport failure when true — **not** "paid".
     * Dual-written from outcome mapping when gateways use Phase 6 helpers.
     */
    success: boolean;
    /**
     * Preferred Phase 6 outcome discriminant. When present, clients should switch
     * on this (or use `isPaidOutcome` / `mapGatewayResultToOperationResult`).
     */
    outcome?: PaymentOperationOutcome | undefined;
    /** Gateway's primary payment object ID for this operation */
    gatewayId: string;
    /** Gateway object ID when it is useful to expose separately from the primary ID */
    gatewayObjectId?: string | undefined;
    /** PayPal order ID, when the operation involves a PayPal order */
    orderId?: string | undefined;
    /** PayPal capture ID, required for PayPal refunds */
    captureId?: string | undefined;
    /** PayPal authorization ID, required for PayPal authorization captures and voids */
    authorizationId?: string | undefined;
    /** Normalized payment status */
    status: PaymentStatus;
    /** Redirect URL for 3DS/PayPal approval (if applicable) - may be undefined */
    redirectUrl: string | undefined;
    /**
     * Amount in major currency units (e.g., SAR).
     * Still a JS `number` in 0.x for response-shape stability; derived via
     * shared fromMinorUnits + safe conversion. Prefer treating as display/legacy;
     * do not re-input float-derived values without re-validation. May become
     * {@link Money} at 1.0.
     */
    amount?: number | undefined;
    /** Fee charged by gateway in major currency units (0.x number; see amount) */
    fee?: number | undefined;
    /** Amount captured so far (partial captures) in major units (0.x number) */
    capturedAmount?: number | undefined;
    /** Amount refunded so far (partial refunds) in major units (0.x number) */
    refundedAmount?: number | undefined;
    /** Client secret for frontend confirmation flows (Stripe PaymentIntents) */
    clientSecret?: string | undefined;
    /** Gateway-specific next action payload for customer authentication or redirects */
    nextAction?: PaymentNextAction | undefined;
    /**
     * Standardized provider references (preferred over ad-hoc id fields alone).
     * Dual-write with legacy `gatewayId` / `orderId` / `captureId` / `authorizationId`.
     */
    references?: ProviderReferences | undefined;
    /** Structured decline when outcome is `declined` (or success false with decline). */
    decline?: PaymentDecline | undefined;
    /**
     * Explicit indeterminate marker. When `outcome === 'indeterminate'`, must be
     * `true`. New clients must reconcile — never treat as definitive decline/paid.
     */
    reconciliationRequired?: boolean | undefined;
    /** Provider request / correlation id when available */
    providerRequestId?: string | undefined;
    /** Raw response from the gateway API */
    rawResponse: unknown;
}

/**
 * Result from gateway refund operations.
 * Note: Some gateways (like Moyasar) don't have separate refund entities.
 * The refund is tracked on the payment object itself.
 *
 * ## Outcome vs success (Phase 6)
 *
 * Prefer {@link import('./operation-result').RefundOperationOutcome} via optional
 * `outcome` (and `mapGatewayRefundToOperationResult`). `success` remains the 0.x
 * API-call flag; pending refunds may still set `success: true`.
 */
export interface GatewayRefundResult {
    /** Whether the API call succeeded (not “refund settled”) */
    success: boolean;
    /**
     * Preferred Phase 6 refund outcome. When present, switch on this rather than
     * `success` alone. See {@link import('./operation-result').RefundOperationResult}.
     */
    outcome?: RefundOperationOutcome | undefined;
    /**
     * Gateway's refund identifier.
     * For Moyasar: This is the payment ID (refunds are tracked on payment).
     * For PayPal: This is the actual refund ID.
     */
    gatewayRefundId: string;
    /** Refund processing status */
    status: RefundStatus;
    /** Total amount refunded on this payment (in base currency units) */
    totalRefunded?: number | undefined;
    /** Timestamp when refund was processed */
    refundedAt?: Date | undefined;
    /**
     * Explicit indeterminate marker for post-submit unknown refund state.
     * When `outcome === 'indeterminate'`, must be `true`.
     */
    reconciliationRequired?: boolean | undefined;
    /** Provider request / correlation id when available */
    providerRequestId?: string | undefined;
    /** Raw response from the gateway API */
    rawResponse: unknown;
}
