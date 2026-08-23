/**
 * @paykernel/gateway-myfatoorah — portable MyFatoorah adapter for @paykernel/core.
 *
 * Depends only on `@paykernel/core` at runtime. No Node-only imports.
 *
 * @packageDocumentation
 */

export { myfatoorahGateway } from "./factory";
export { MyFatoorahGateway } from "./gateway";
export { MYFATOORAH_ADAPTER_VERSION, MYFATOORAH_CAPABILITIES } from "./capabilities";
export type { MyFatoorahConfig, MyFatoorahCountry } from "./config";
export type {
  MyFatoorahCreatePaymentParams,
  MyFatoorahCustomerInput,
  MyFatoorahGetPaymentParams,
  MyFatoorahPaymentMethod,
  MyFatoorahRefundParams,
} from "./types";
