// file: packages/payments/src/errors.ts

import type { GatewayCapabilityKey } from './gateways/gateway-capabilities';

/**
 * Base error class for all payment-related errors
 */
export class PaymentError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 500
    ) {
        super(message);
        this.name = 'PaymentError';
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Thrown when a payment operation is aborted by a before-hook or by a caller
 * {@link AbortSignal} on operation params (not a provider timeout — those map
 * to {@link NetworkError}).
 */
export class PaymentAbortedError extends PaymentError {
    constructor(reason?: string) {
        super(
            reason ?? 'Payment operation was aborted',
            'PAYMENT_ABORTED',
            400
        );
        this.name = 'PaymentAbortedError';
    }
}

/**
 * Thrown when a gateway is not properly configured
 */
export class GatewayNotConfiguredError extends PaymentError {
    constructor(gatewayName: string) {
        super(
            `Gateway '${gatewayName}' is not configured`,
            'GATEWAY_NOT_CONFIGURED',
            400
        );
        this.name = 'GatewayNotConfiguredError';
    }
}

/**
 * Options for {@link OperationNotSupportedError} capability metadata.
 * All fields optional for backward-compatible two-arg construction.
 */
export interface OperationNotSupportedErrorOptions {
    /** Capability key that was required / missing for this failure */
    capability?: GatewayCapabilityKey;
    /**
     * What `supports(capability)` returned (or would return) when the error
     * was raised. Typically `false` for fail-closed unsupported paths.
     */
    claimedSupport?: boolean;
    /** Override the default human-readable message */
    message?: string;
}

/**
 * Thrown when a configured gateway does not support the requested operation
 * (missing optional method, or capability not claimed).
 *
 * Two-arg form remains valid: `new OperationNotSupportedError(name, op)`.
 * Prefer the options bag when a capability key is known so callers can branch
 * without parsing the message string.
 */
export class OperationNotSupportedError extends PaymentError {
    readonly gatewayName: string;
    readonly operation: string;
    readonly capability?: GatewayCapabilityKey;
    readonly claimedSupport?: boolean;

    constructor(
        gatewayName: string,
        operation: string,
        options?: OperationNotSupportedErrorOptions,
    ) {
        const message =
            options?.message ??
            (options?.capability !== undefined
                ? `Gateway '${gatewayName}' does not support ${operation} (capability '${options.capability}')`
                : `Gateway '${gatewayName}' does not support ${operation}`);
        super(message, 'OPERATION_NOT_SUPPORTED', 400);
        this.name = 'OperationNotSupportedError';
        this.gatewayName = gatewayName;
        this.operation = operation;
        if (options?.capability !== undefined) {
            this.capability = options.capability;
        }
        if (options?.claimedSupport !== undefined) {
            this.claimedSupport = options.claimedSupport;
        }
    }
}

/**
 * Thrown when webhook verification fails
 */
export class InvalidWebhookError extends PaymentError {
    constructor(message?: string) {
        super(
            message ?? 'Webhook verification failed',
            'INVALID_WEBHOOK',
            403
        );
        this.name = 'InvalidWebhookError';
    }
}

/**
 * Thrown when a gateway API call fails
 */
export class GatewayApiError extends PaymentError {
    constructor(
        message: string,
        public readonly gatewayName: string,
        public readonly rawError?: unknown
    ) {
        super(message, 'GATEWAY_API_ERROR', 502);
        this.name = 'GatewayApiError';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Standardized Logic Errors
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thrown when the card is declined by the issuer
 */
export class CardDeclinedError extends PaymentError {
    constructor(message = 'Card was declined', public readonly rawError?: unknown) {
        super(message, 'CARD_DECLINED', 402);
        this.name = 'CardDeclinedError';
    }
}

/**
 * Thrown when the card has insufficient funds
 */
export class InsufficientFundsError extends PaymentError {
    constructor(message = 'Insufficient funds', public readonly rawError?: unknown) {
        super(message, 'INSUFFICIENT_FUNDS', 402);
        this.name = 'InsufficientFundsError';
    }
}

/**
 * Thrown when authentication fails (e.g. 3DS failed, wrong CVV/Expiry)
 */
export class AuthenticationError extends PaymentError {
    constructor(message = 'Authentication failed', public readonly rawError?: unknown) {
        super(message, 'AUTHENTICATION_FAILED', 401);
        this.name = 'AuthenticationError';
    }
}

/**
 * Thrown when the gateway rate limit is exceeded
 */
export class RateLimitError extends PaymentError {
    /** Seconds to wait before retrying, parsed from the Retry-After header when present. */
    public readonly retryAfterSeconds?: number;

    constructor(gatewayName: string, retryAfter?: number) {
        super(
            `Rate limit exceeded for ${gatewayName}${retryAfter ? `. Retry after ${retryAfter}s` : ''}`,
            'RATE_LIMIT_EXCEEDED',
            429
        );
        this.name = 'RateLimitError';
        if (retryAfter !== undefined) {
            this.retryAfterSeconds = retryAfter;
        }
    }
}

/**
 * Thrown when a requested gateway resource does not exist
 */
export class ResourceNotFoundError extends PaymentError {
    constructor(message = 'Requested resource was not found', public readonly rawError?: unknown) {
        super(message, 'RESOURCE_NOT_FOUND', 404);
        this.name = 'ResourceNotFoundError';
    }
}

/**
 * Thrown when the request is invalid (validation failed upstream or at gateway)
 */
export class InvalidRequestError extends PaymentError {
    constructor(message: string, public readonly validationErrors?: unknown[]) {
        super(message, 'INVALID_REQUEST', 400);
        this.name = 'InvalidRequestError';
    }
}

/**
 * Thrown when there is a network connectivity issue usually transient
 */
export class NetworkError extends PaymentError {
    /**
     * True when the provider may already have accepted a mutating request
     * (timeout / drop / 5xx after POST). Callers must reconcile, not retry
     * as a fresh failure. Preflight auth and GET failures stay false.
     */
    readonly afterProviderSubmit: boolean;

    constructor(
        message = 'Network error occurred',
        public readonly originalError?: unknown,
        options?: { afterProviderSubmit?: boolean },
    ) {
        super(message, 'NETWORK_ERROR', 503);
        this.name = 'NetworkError';
        this.afterProviderSubmit = options?.afterProviderSubmit === true;
    }
}
