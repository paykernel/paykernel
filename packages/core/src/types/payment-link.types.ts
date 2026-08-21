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
import { buildProviderReferences } from "./provider-refs";

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
  /** Hosted URL. Omitted on post-submit indeterminate snapshots (never invent ""). */
  url?: string;
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

/**
 * Post-submit unknown for `createPaymentLink` / `deactivatePaymentLink`.
 * Must not invent PaymentLink `active` or a hosted URL.
 */
export function applyIndeterminatePaymentLinkOutcome(input: {
  paymentLinkId: string;
  message: string;
  errorName: string;
  gateway: string;
}): PaymentLinkOperationResult {
  const lookupId = input.paymentLinkId;
  const paymentLink: PaymentLink = {
    status: "unknown",
    references: buildProviderReferences({
      gateway: input.gateway,
      gatewayId: lookupId,
      status: "unknown",
      ...(lookupId !== "unknown" ? { internalReference: lookupId } : {}),
      providerNativeStatus: "indeterminate",
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
    paymentLink,
  };
}
