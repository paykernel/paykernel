/**
 * Phase 22.1 — customers and stored payment methods.
 *
 * First-class vault surface. Capability-gated (`customers` / `paymentMethods`).
 * Never accepts raw PAN/CVC; tokenized ids only. No subscription-domain fields.
 */

import type { PaymentErrorLike } from "./operation-result";
import type {
  OperationRequestOptions,
  PaymentMetadata,
} from "./payment.types";
import type { ProviderReferences } from "./provider-refs";
import { buildProviderReferences } from "./provider-refs";

/** Customer object lifecycle on this SDK surface. */
export type CustomerStatus = "active" | "deleted";

/**
 * Common customer fields — no provider-prefixed keys.
 * Extend in adapters for provider-native extras.
 */
export type CommonCustomerInput = {
  email?: string;
  name?: string;
  metadata?: PaymentMetadata;
};

export interface CreateCustomerParams
  extends CommonCustomerInput, OperationRequestOptions {
  idempotencyKey?: string;
}

export interface GetCustomerParams extends OperationRequestOptions {
  customerId: string;
}

export type Customer = {
  /** `unknown` is reserved for post-submit indeterminate snapshots. */
  status: CustomerStatus | string;
  email?: string;
  name?: string;
  references: ProviderReferences;
  metadata?: PaymentMetadata;
  /** Provider-native snapshot — never secrets or PAN. */
  rawResponse?: unknown;
};

export type CustomerOperationOutcome = "succeeded" | "failed" | "indeterminate";

export type CustomerOperationResult =
  | { outcome: "succeeded"; customer: Customer }
  | {
      outcome: "failed";
      error: PaymentErrorLike;
      customer?: Customer;
    }
  | {
      outcome: "indeterminate";
      providerRequestId?: string;
      reconciliationRequired: true;
      customer?: Customer;
      message?: string;
    };

/** Display brand for a stored method (Visa, mada, …) — never a PAN. */
export type StoredPaymentMethodType = "card" | "wallet" | "bank" | "other";

export type StoredPaymentMethod = {
  id: string;
  /** Omitted when the provider snapshot has no customer (e.g. detached). */
  customerId?: string;
  type: StoredPaymentMethodType;
  brand?: string;
  last4?: string;
  references: ProviderReferences;
};

export interface AttachPaymentMethodParams extends OperationRequestOptions {
  customerId: string;
  /** Tokenized provider payment-method id (e.g. `pm_…`). Never a PAN. */
  paymentMethodId?: string;
  /** Tokenized client-SDK token when the provider uses tokens instead of PM ids. */
  token?: string;
  idempotencyKey?: string;
}

export interface ListPaymentMethodsParams extends OperationRequestOptions {
  customerId: string;
}

export interface DetachPaymentMethodParams extends OperationRequestOptions {
  paymentMethodId: string;
  customerId?: string;
  idempotencyKey?: string;
}

export type PaymentMethodOperationResult =
  | { outcome: "succeeded"; paymentMethod: StoredPaymentMethod }
  | {
      outcome: "failed";
      error: PaymentErrorLike;
      paymentMethod?: StoredPaymentMethod;
    }
  | {
      outcome: "indeterminate";
      providerRequestId?: string;
      reconciliationRequired: true;
      paymentMethod?: StoredPaymentMethod;
      message?: string;
    };

export type ListPaymentMethodsResult =
  | { outcome: "succeeded"; paymentMethods: StoredPaymentMethod[] }
  | { outcome: "failed"; error: PaymentErrorLike };

function indeterminateLookupRefs(input: {
  gateway: string;
  lookupId: string;
  customerId?: string;
}): ProviderReferences {
  return buildProviderReferences({
    gateway: input.gateway,
    gatewayId: input.lookupId,
    status: "unknown",
    ...(input.lookupId !== "unknown" ? { internalReference: input.lookupId } : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    providerNativeStatus: "indeterminate",
  });
}

/**
 * Post-submit unknown for `createCustomer`.
 * Must not invent Customer `active` — the provider may never have created it.
 */
export function applyIndeterminateCustomerOutcome(input: {
  customerId: string;
  message: string;
  errorName: string;
  gateway: string;
}): CustomerOperationResult {
  const lookupId = input.customerId;
  const customer: Customer = {
    status: "unknown",
    references: indeterminateLookupRefs({
      gateway: input.gateway,
      lookupId,
    }),
    rawResponse: {
      indeterminate: true,
      message: input.message,
      name: input.errorName,
    },
  };
  return {
    outcome: "indeterminate",
    reconciliationRequired: true,
    message: input.message,
    customer,
  };
}

/**
 * Post-submit unknown for `attachPaymentMethod` / `detachPaymentMethod`.
 * Must not invent `active` stored-method lifecycle.
 */
export function applyIndeterminatePaymentMethodOutcome(input: {
  paymentMethodId: string;
  customerId?: string;
  message: string;
  errorName: string;
  gateway: string;
}): PaymentMethodOperationResult {
  const lookupId = input.paymentMethodId;
  const customerId =
    input.customerId !== undefined && input.customerId.length > 0
      ? input.customerId
      : undefined;
  const paymentMethod: StoredPaymentMethod = {
    id: lookupId,
    ...(customerId !== undefined ? { customerId } : {}),
    type: "other",
    references: indeterminateLookupRefs({
      gateway: input.gateway,
      lookupId,
      ...(customerId !== undefined ? { customerId } : {}),
    }),
  };
  return {
    outcome: "indeterminate",
    reconciliationRequired: true,
    message: input.message,
    paymentMethod,
  };
}
