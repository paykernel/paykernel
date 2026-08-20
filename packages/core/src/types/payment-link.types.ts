/**
 * Phase 22.5 — payment links (reusable shareable URLs).
 *
 * Capability-gated (`paymentLinks`). Distinct from hosted checkout sessions:
 * a link can collect many payments; a Checkout Session is typically one-shot.
 */

import type { PaymentErrorLike } from "./operation-result";
import type {
  AmountInput,
  OperationRequestOptions,
  PaymentMetadata,
} from "./payment.types";
import type { ProviderReferences } from "./provider-refs";

export type PaymentLinkStatus = "active" | "inactive";

export type CommonPaymentLinkInput = {
  amount?: AmountInput;
  currency?: string;
  description?: string;
  metadata?: PaymentMetadata;
  idempotencyKey?: string;
} & OperationRequestOptions;

export type CreatePaymentLinkParams = CommonPaymentLinkInput;

export type GetPaymentLinkParams = {
  paymentLinkId: string;
} & OperationRequestOptions;

export type DeactivatePaymentLinkParams = {
  paymentLinkId: string;
  idempotencyKey?: string;
} & OperationRequestOptions;

export type PaymentLink = {
  status: PaymentLinkStatus | string;
  url: string;
  references: ProviderReferences;
  amount?: number;
  currency?: string;
  rawResponse?: unknown;
};

export type PaymentLinkOperationOutcome =
  | "succeeded"
  | "failed"
  | "indeterminate";

export type PaymentLinkOperationResult =
  | { outcome: "succeeded"; paymentLink: PaymentLink }
  | {
      outcome: "failed";
      error: PaymentErrorLike;
      paymentLink?: PaymentLink;
    }
  | {
      outcome: "indeterminate";
      reconciliationRequired: true;
      providerRequestId?: string;
      paymentLink?: PaymentLink;
      message?: string;
    };
