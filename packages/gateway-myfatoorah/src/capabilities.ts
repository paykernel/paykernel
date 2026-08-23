import {
  defineGatewayCapabilities,
  freezeCapabilities,
  type GatewayCapabilities,
} from "@paykernel/core";

/** Adapter package version — must match `packages/gateway-myfatoorah/package.json`. */
export const MYFATOORAH_ADAPTER_VERSION = "0.1.0-next.0";

/**
 * Conservative MyFatoorah claims for this adapter surface.
 *
 * V3 `PaymentURL` is a hosted-page **redirect**, not a first-class Checkout
 * Session product (`hostedCheckout` stays false) — same honesty as Tap
 * `src_all`. Authorize / capture / void exist on MyFatoorah but need portal
 * enablement and are not implemented here. Tokenization, customers, payment
 * links, splits, disputes, and recurring are not implemented.
 */
export const MYFATOORAH_CAPABILITIES: GatewayCapabilities = freezeCapabilities(
  defineGatewayCapabilities({
    payments: true,
    immediateCapture: true,
    refunds: true,
    partialRefunds: true,
    authorization: false,
    partialCapture: false,
    voids: false,
    hostedCheckout: false,
    tokenization: false,
    customers: false,
    paymentMethods: false,
    marketplaceSplits: false,
    disputes: false,
    paymentLinks: false,
    providerRecurring: false,
  }),
);
