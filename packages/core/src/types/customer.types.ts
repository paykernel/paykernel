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
  status: CustomerStatus;
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
  customerId: string;
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
