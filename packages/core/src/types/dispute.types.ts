/**
 * Phase 22.3 — disputes and chargebacks.
 *
 * Capability-gated (`disputes`). Provider-native status stays on
 * `providerStatus` / `references.providerNativeStatus`. Evidence submission
 * is a small common set plus a Stripe-only bag — not a fake 50-field form.
 */

import type { Money } from "../utils/money";
import type { DisputeStatus } from "./domain-status";
import type { PaymentErrorLike } from "./operation-result";
import type { OperationRequestOptions } from "./payment.types";
import type { ProviderReferences } from "./provider-refs";
import { buildProviderReferences } from "./provider-refs";

/**
 * Normalized dispute snapshot (API results and `PaymentEvent.dispute`).
 *
 * Amount fields are major units and must travel with {@link currency}.
 */
export type Dispute = {
  status: DisputeStatus | string;
  references: ProviderReferences;
  amount?: Money | number | undefined;
  currency?: string | undefined;
  reason?: string;
  /** ISO-8601 evidence deadline when the provider exposes one. */
  evidenceDueBy?: string;
  /** Best-effort provider dashboard URL (constructed; not returned by Stripe). */
  dashboardUrl?: string;
  /** Provider-native lifecycle string. */
  providerStatus?: string;
  rawResponse?: unknown;
};

export type GetDisputeParams = {
  disputeId: string;
} & OperationRequestOptions;

export type ListDisputesParams = {
  /** Provider payment / charge / PaymentIntent id to bound the list. */
  paymentId?: string;
} & OperationRequestOptions;

/**
 * Stable evidence fields most providers can accept. Extra Stripe hashes go
 * on {@link stripeEvidence} — never PAN/CVC.
 */
export type DisputeEvidenceInput = {
  uncategorizedText?: string;
  customerName?: string;
  customerEmail?: string;
  productDescription?: string;
  /**
   * Stripe evidence hash extras (`uncategorized_file`, `receipt`, …).
   * Values must be Stripe file ids or strings — never raw card data.
   */
  stripeEvidence?: Readonly<Record<string, string>>;
};

export type SubmitDisputeEvidenceParams = {
  disputeId: string;
  evidence: DisputeEvidenceInput;
  idempotencyKey?: string;
} & OperationRequestOptions;

export type DisputeOperationOutcome = "succeeded" | "failed" | "indeterminate";

export type DisputeOperationResult =
  | { outcome: "succeeded"; dispute: Dispute }
  | {
      outcome: "failed";
      error: PaymentErrorLike;
      dispute?: Dispute;
    }
  | {
      outcome: "indeterminate";
      reconciliationRequired: true;
      providerRequestId?: string;
      dispute?: Dispute;
      message?: string;
    };

export type ListDisputesResult =
  | { outcome: "succeeded"; disputes: Dispute[] }
  | { outcome: "failed"; error: PaymentErrorLike };

/**
 * Post-submit unknown for `submitDisputeEvidence`.
 * Must not invent `needs_response` / `under_review` / won / lost.
 */
export function applyIndeterminateDisputeOutcome(input: {
  disputeId: string;
  message: string;
  errorName: string;
  gateway: string;
}): DisputeOperationResult {
  const lookupId = input.disputeId;
  const dispute: Dispute = {
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
    dispute,
  };
}
