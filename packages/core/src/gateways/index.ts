// file: packages/core/src/gateways/index.ts

export { BaseGateway } from "./base.gateway";
export type { PaymentGateway } from "./gateway.interface";
export type { GatewayManifest } from "./gateway-manifest";
export type {
  GatewayCapabilityKey,
  GatewayCapabilities,
} from "./gateway-capabilities";
export {
  GATEWAY_CAPABILITY_KEYS,
  DEFAULT_GATEWAY_CAPABILITIES,
  defineGatewayCapabilities,
  isGatewayCapabilityKey,
  CAPABILITY_OPERATION_MAP,
  freezeCapabilities,
} from "./gateway-capabilities";
export {
  STRIPE_CAPABILITIES,
  MOYASAR_CAPABILITIES,
  PAYPAL_CAPABILITIES,
  PAYMOB_CAPABILITIES,
  BUILTIN_GATEWAY_CAPABILITIES,
  BUILTIN_GATEWAY_MANIFESTS,
  BUILTIN_ADAPTER_VERSION,
} from "./builtin-capabilities";
export type { BuiltinGatewayCapabilityName } from "./builtin-capabilities";
export {
  generateGatewayCapabilitiesMarkdown,
  CAPABILITY_DOCS_BANNER,
} from "./capabilities-docs";
export type {
  GatewayContext,
  CryptoProvider,
  TelemetrySink,
  CreateDefaultGatewayContextOptions,
} from "./gateway-context";
export {
  createDefaultGatewayContext,
  createRedactingTelemetrySink,
} from "./gateway-context";
export type { GatewayAdapter } from "./gateway-adapter";
export type {
  GatewayMap,
  ImmutableGatewayRegistry,
  GatewayRegistryBuilder,
} from "./gateway-registry";
export {
  createGatewayRegistry,
  createDynamicGatewayRegistry,
} from "./gateway-registry";
export { MoyasarGateway } from "./moyasar/moyasar.gateway";
export { PayPalGateway } from "./paypal/paypal.gateway";
export { PaymobGateway } from "./paymob/paymob.gateway";
export { StripeGateway } from "./stripe/stripe.gateway";
export {
  stripeGateway,
  moyasarGateway,
  paypalGateway,
  paymobGateway,
} from "./factories";
