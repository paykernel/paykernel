/**
 * Phase 22.2 — hosted checkout sessions.
 *
 * Capability-gated (`hostedCheckout`). This is a first-class Checkout Session
 * product, not every provider redirect URL. Create success is **not** paid
 * settlement — redirect the customer to `session.url` when present, then
 * fulfill from webhooks / `getPayment` + `isPaidOutcome`.
 */

import type { PaymentErrorLike } from "./operation-result";
import type {
  AmountInput,
  OperationRequestOptions,
  PaymentMetadata,
} from "./payment.types";
import type { ProviderReferences } from "./provider-refs";
import { buildProviderReferences } from "./provider-refs";

/** Provider-hosted checkout session lifecycle on this SDK surface. */
export type CheckoutSessionStatus = "open" | "complete" | "expired";

/**
 * Common hosted-checkout create fields — no provider-prefixed keys.
 * Stripe-specific extras (`mode`, `lineItems`, `paymentMethodTypes`,
 * `customerEmail`) live on {@link import("./validation").CreateCheckoutSessionParams}.
 */
export type CommonCheckoutSessionInput = {
  successUrl: string;
  cancelUrl?: string;
  /**
   * Prefer {@link AmountInput} / Money for a one-item payment session.
   * Exclusive with provider line-item arrays on Stripe.
   */
  amount?: AmountInput;
  currency?: string;
  customerId?: string;
  metadata?: PaymentMetadata;
  idempotencyKey?: string;
} & OperationRequestOptions;

export type GetCheckoutSessionParams = {
  sessionId: string;
} & OperationRequestOptions;

/**
 * Normalized hosted checkout session.
 *
 * `url` is omitted when the provider does not return a hosted URL.
 * Amount fields are major units and are omitted without {@link currency}.
 */
export type CheckoutSession = {
  status: CheckoutSessionStatus | string;
  references: ProviderReferences;
  url?: string;
  paymentStatus?: string;
  amount?: number;
  currency?: string;
  refundedAmount?: number;
  rawResponse?: unknown;
};

export type CheckoutSessionOperationOutcome =
  | "succeeded"
  | "failed"
  | "indeterminate";

export type CheckoutSessionOperationResult =
  | { outcome: "succeeded"; session: CheckoutSession }
  | {
      outcome: "failed";
      error: PaymentErrorLike;
      session?: CheckoutSession;
    }
  | {
      outcome: "indeterminate";
      reconciliationRequired: true;
      providerRequestId?: string;
      session?: CheckoutSession;
      message?: string;
    };

/**
 * True when create/get produced a redirectable hosted URL.
 * Never treat this as paid — fulfill on payment settlement.
 */
export function isHostedCheckoutRedirect(
  result: CheckoutSessionOperationResult,
): boolean {
  return (
    result.outcome === "succeeded" &&
    typeof result.session.url === "string" &&
    result.session.url.length > 0
  );
}

/**
 * Post-submit unknown for `createCheckoutSession` (S19-CKO-TIMEOUT).
 * Must not reuse payment-shaped `gatewayId` / `status: processing`.
 */
export function applyIndeterminateCheckoutSessionOutcome(input: {
  sessionId: string;
  message: string;
  errorName: string;
  gateway: string;
}): CheckoutSessionOperationResult {
  const lookupId = input.sessionId;
  const session: CheckoutSession = {
    // Do not invent Checkout `open` — the provider may never have created a session.
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
    session,
  };
}
