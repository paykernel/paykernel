// file: packages/core/src/types/provider-refs.ts

import type { GatewayId, PaymentStatus } from "./payment.types";

/**
 * Structured provider identity / correlation for a payment (or related) object.
 *
 * Prefer populating {@link ProviderReferences} on results while also keeping
 * legacy flat fields (`gatewayId`, `orderId`, `captureId`, `authorizationId`)
 * dual-written for 0.x callers.
 */
export type ProviderReferences = {
    /**
     * SDK / merchant correlation id (e.g. merchant `orderId`, idempotency key).
     */
    internalReference?: string;
    /**
     * Primary provider object ID (PaymentIntent id, Moyasar payment id, etc.).
     * Required when building a complete references object for a known object.
     */
    providerObjectId: string;
    /**
     * Provider request / idempotency / correlation id returned by the provider
     * when available (distinct from merchant idempotency key).
     */
    providerRequestId?: string;
    /** Parent object id when this is a child resource (e.g. capture under order). */
    parentId?: string;
    /**
     * Related provider IDs (order, capture, authorization, refund, charge, customer).
     * Open index for provider-native extras.
     */
    relatedIds?: {
        orderId?: string;
        captureId?: string;
        authorizationId?: string;
        refundId?: string;
        chargeId?: string;
        customerId?: string;
        [key: string]: string | undefined;
    };
    /** Provider-native status string as returned by the API (unnormalized). */
    providerNativeStatus?: string;
    /**
     * Normalized domain status for this object (legacy {@link PaymentStatus}
     * mega-union or a domain-specific status string).
     */
    normalizedStatus: PaymentStatus | string;
    /** Gateway that owns this object. */
    gateway: GatewayId;
};

/**
 * Inputs for {@link buildProviderReferences}.
 * All optional fields use exactOptionalPropertyTypes-friendly omission.
 */
export type BuildProviderReferencesInput = {
    gateway: GatewayId;
    /** Primary provider object id — maps to `providerObjectId` and often `gatewayId`. */
    gatewayId: string;
    /** Normalized status (PaymentStatus or provider-mapped string). */
    status: PaymentStatus | string;
    gatewayObjectId?: string;
    orderId?: string;
    captureId?: string;
    authorizationId?: string;
    refundId?: string;
    chargeId?: string;
    customerId?: string;
    /** Merchant order / internal correlation id. */
    internalReference?: string;
    providerRequestId?: string;
    parentId?: string;
    providerNativeStatus?: string;
    /** Extra related ids merged into `relatedIds`. */
    relatedIds?: ProviderReferences["relatedIds"];
};

/**
 * Build a {@link ProviderReferences} object from flat gateway result fields.
 *
 * Dual-write guidance: when constructing {@link import('./payment.types').GatewayPaymentResult},
 * set both `references` (this helper) **and** legacy `gatewayId` / `orderId` /
 * `captureId` / `authorizationId` so 0.x callers keep working.
 */
export function buildProviderReferences(
    input: BuildProviderReferencesInput,
): ProviderReferences {
    const related: NonNullable<ProviderReferences["relatedIds"]> = {
        ...(input.relatedIds ?? {}),
    };

    if (input.orderId !== undefined) {
        related.orderId = input.orderId;
    }
    if (input.captureId !== undefined) {
        related.captureId = input.captureId;
    }
    if (input.authorizationId !== undefined) {
        related.authorizationId = input.authorizationId;
    }
    if (input.refundId !== undefined) {
        related.refundId = input.refundId;
    }
    if (input.chargeId !== undefined) {
        related.chargeId = input.chargeId;
    }
    if (input.customerId !== undefined) {
        related.customerId = input.customerId;
    }

    const hasRelated = Object.keys(related).some(
        (k) => related[k] !== undefined,
    );

    const refs: ProviderReferences = {
        providerObjectId: input.gatewayId,
        normalizedStatus: input.status,
        gateway: input.gateway,
    };

    if (input.internalReference !== undefined) {
        refs.internalReference = input.internalReference;
    }
    if (input.providerRequestId !== undefined) {
        refs.providerRequestId = input.providerRequestId;
    }
    if (input.parentId !== undefined) {
        refs.parentId = input.parentId;
    }
    if (input.providerNativeStatus !== undefined) {
        refs.providerNativeStatus = input.providerNativeStatus;
    }
    // Prefer explicit gatewayObjectId as parent when distinct from primary id
    if (
        input.gatewayObjectId !== undefined &&
        input.gatewayObjectId !== input.gatewayId &&
        refs.parentId === undefined
    ) {
        refs.parentId = input.gatewayObjectId;
    }
    if (hasRelated) {
        refs.relatedIds = related;
    }

    return refs;
}
