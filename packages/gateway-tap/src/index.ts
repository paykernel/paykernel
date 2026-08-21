/**
 * @paykernel/gateway-tap — portable Tap Payments adapter for @paykernel/core.
 *
 * Depends only on `@paykernel/core` at runtime. No Node-only imports.
 *
 * @packageDocumentation
 */

export { tapGateway } from "./factory";
export { TapGateway } from "./gateway";
export { TAP_ADAPTER_VERSION, TAP_CAPABILITIES } from "./capabilities";
export type { TapConfig } from "./config";
export type {
  TapCaptureParams,
  TapCreatePaymentParams,
  TapCustomerInput,
  TapRefundParams,
  TapRefundReason,
  TapSource,
  TapVoidParams,
} from "./types";
