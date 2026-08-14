// file: packages/core/src/gateways/gateway-capabilities.ts

/**
 * Stable capability keys for gateway adapters (Phase 3).
 *
 * Keys describe what **this SDK surface** can advertise and query via
 * {@link import('./gateway.interface').PaymentGateway.supports} — not the full
 * upstream provider API. Adapters must claim capabilities explicitly; the SDK
 * does not infer `true` from optional method presence alone.
 */

/**
 * Canonical ordered list of capability keys.
 * Keep stable: consumers and generated docs rely on these string values.
 */
export const GATEWAY_CAPABILITY_KEYS = [
  "payments",
  "immediateCapture",
  "authorization",
  "partialCapture",
  "refunds",
  "partialRefunds",
  "voids",
  "hostedCheckout",
  "tokenization",
  "customers",
  "paymentMethods",
  "marketplaceSplits",
  "disputes",
  "paymentLinks",
  "providerRecurring",
] as const;

/** One of the stable {@link GATEWAY_CAPABILITY_KEYS}. */
export type GatewayCapabilityKey = (typeof GATEWAY_CAPABILITY_KEYS)[number];

/**
 * Complete, explicit capability map. Every key is present and boolean —
 * never partial at the snapshot boundary.
 */
export type GatewayCapabilities = Readonly<
  Record<GatewayCapabilityKey, boolean>
>;

/**
 * Safe default for unknown / third-party adapters that do not declare
 * capabilities: claim nothing. Prefer fail-closed over silent over-claim.
 */
export const DEFAULT_GATEWAY_CAPABILITIES: GatewayCapabilities =
  Object.freeze(
    Object.fromEntries(
      GATEWAY_CAPABILITY_KEYS.map((key) => [key, false]),
    ) as Record<GatewayCapabilityKey, boolean>,
  );

/**
 * Merge a partial claim map with the all-false base so every key is explicit.
 * Unspecified keys are `false`. Does not freeze; pass through
 * {@link freezeCapabilities} before storing on a gateway or registry.
 */
export function defineGatewayCapabilities(
  partial: Partial<Record<GatewayCapabilityKey, boolean>> = {},
): GatewayCapabilities {
  const out = { ...DEFAULT_GATEWAY_CAPABILITIES } as Record<
    GatewayCapabilityKey,
    boolean
  >;
  for (const key of GATEWAY_CAPABILITY_KEYS) {
    if (partial[key] !== undefined) {
      out[key] = partial[key] === true;
    }
  }
  return out;
}

/** Type guard for unknown strings (e.g. config / docs tooling). */
export function isGatewayCapabilityKey(
  value: string,
): value is GatewayCapabilityKey {
  return (GATEWAY_CAPABILITY_KEYS as readonly string[]).includes(value);
}

/**
 * Primary SDK operation associated with a capability, when one exists.
 *
 * This map is method presence only (claim-harness structural check). It is
 * not create-path proof that createPayment implements the capability.
 *
 * Semantics (this SDK surface):
 * - `payments` → `createPayment` (create a payment / charge intent)
 * - `immediateCapture` → `createPayment` (create that captures without a later capture step)
 * - `authorization` → `capturePayment` (method presence only, not create-path proof.
 *   Completing an auth hold uses capture; this mapping does not prove the
 *   create path supports `capture: false` / authorize intent.)
 * - `partialCapture` → `capturePayment` (capture with a partial `amount`)
 * - `refunds` / `partialRefunds` → `refundPayment`
 * - `voids` → `voidPayment`
 * - `hostedCheckout` → `createCheckoutSession` (hosted session API, not any redirect)
 *
 * Keys without a single primary client/gateway method (tokenization, customers,
 * paymentMethods, marketplaceSplits, disputes, paymentLinks, providerRecurring)
 * are omitted — they are extension / multi-method surfaces, not one operation.
 *
 * `providerRecurring` is extension-only: claim only when the adapter exposes
 * provider-native recurring as a first-class SDK surface. Stripe Checkout
 * subscription mode alone does **not** force `providerRecurring=true`.
 */
export const CAPABILITY_OPERATION_MAP: Readonly<
  Partial<Record<GatewayCapabilityKey, string>>
> = Object.freeze({
  payments: "createPayment",
  immediateCapture: "createPayment",
  authorization: "capturePayment",
  partialCapture: "capturePayment",
  refunds: "refundPayment",
  partialRefunds: "refundPayment",
  voids: "voidPayment",
  hostedCheckout: "createCheckoutSession",
});

/**
 * Capabilities that must be claimed for `operation` given hook-final `params`.
 * Shared by {@link PaymentClient} facade checks and BaseGateway post-before
 * asserts so a non-BaseGateway surface cannot skip authorization / splits.
 */
export function requiredCapabilitiesForOperation(
  operation: string,
  params: unknown,
): GatewayCapabilityKey[] {
  const bag =
    params !== null && typeof params === "object"
      ? (params as Record<string, unknown>)
      : {};

  switch (operation) {
    case "createPayment": {
      const required: GatewayCapabilityKey[] = ["payments"];
      if (bag.capture === false) {
        required.push("authorization");
      }
      if (Array.isArray(bag.splits) && bag.splits.length > 0) {
        required.push("marketplaceSplits");
      }
      return required;
    }
    case "refundPayment": {
      const required: GatewayCapabilityKey[] = ["refunds"];
      if (bag.amount !== undefined) {
        required.push("partialRefunds");
      }
      return required;
    }
    case "voidPayment":
      return ["voids"];
    case "createCheckoutSession":
      return ["hostedCheckout"];
    case "capturePayment":
      return bag.amount !== undefined ? ["partialCapture"] : [];
    default:
      return [];
  }
}

/**
 * Shallow-freeze a complete capability record (boolean values only).
 * Returns a new frozen object; does not mutate the input.
 */
export function freezeCapabilities(
  caps: GatewayCapabilities | Record<GatewayCapabilityKey, boolean>,
): GatewayCapabilities {
  return Object.freeze({ ...caps }) as GatewayCapabilities;
}

// ─── Per-key documentation (SDK surface meaning) ─────────────────────────────

/**
 * Capability key meanings for THIS SDK:
 *
 * - **payments**: Adapter implements {@link import('./gateway.interface').PaymentGateway.createPayment}
 *   for creating payments / payment intents.
 * - **immediateCapture**: Create path can capture funds immediately (default
 *   capture-on-create / `capture: true` style flows).
 * - **authorization**: Create path can place an authorization hold
 *   (`capture: false` / authorize intent) for a later capture.
 * - **partialCapture**: `capturePayment` accepts a partial `amount` less than
 *   the authorized total. Full capture (omitted amount) is not partial.
 * - **refunds**: Adapter implements refunds via `refundPayment`.
 * - **partialRefunds**: `refundPayment` accepts a partial `amount`. Full refund
 *   (omitted amount) is not partial.
 * - **voids**: Adapter implements `voidPayment` to release an uncaptured hold.
 * - **hostedCheckout**: Adapter implements `createCheckoutSession` for a
 *   provider-hosted Checkout Session product (not every redirect URL).
 * - **tokenization**: First-class setup / save-payment-method / token APIs on
 *   the adapter (beyond ad-hoc source fields on create).
 * - **customers**: First-class customer create/retrieve surface on the adapter.
 * - **paymentMethods**: First-class stored payment-method CRUD on the adapter.
 * - **marketplaceSplits**: Marketplace split / transfer params as a supported
 *   create-time or transfer surface (e.g. documented splits API).
 * - **disputes**: First-class dispute / chargeback APIs on the adapter.
 * - **paymentLinks**: First-class payment-link product APIs on the adapter.
 * - **providerRecurring**: Provider-native recurring / subscription billing
 *   exposed as a first-class adapter extension. Extension-only; default false.
 *   Do not set true solely because Checkout supports `mode: subscription`.
 */
