import {
  paymentRuntimeFromContext,
  type GatewayAdapter,
  type GatewayContext,
} from "@paykernel/core";
import { MYFATOORAH_ADAPTER_VERSION, MYFATOORAH_CAPABILITIES } from "./capabilities";
import { copyMyFatoorahConfig, type MyFatoorahConfig } from "./config";
import { MyFatoorahGateway } from "./gateway";

/**
 * MyFatoorah adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 */
export function myfatoorahGateway(
  config: MyFatoorahConfig,
): GatewayAdapter<"myfatoorah", MyFatoorahGateway> {
  const closed = copyMyFatoorahConfig(config);
  return {
    name: "myfatoorah",
    manifest: {
      name: "myfatoorah",
      displayName: "MyFatoorah",
      version: MYFATOORAH_ADAPTER_VERSION,
      apiVersion: "V3",
      capabilities: MYFATOORAH_CAPABILITIES,
    },
    create(context: GatewayContext) {
      return new MyFatoorahGateway(
        closed,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}
