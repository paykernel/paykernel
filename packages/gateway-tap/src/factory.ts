import {
  paymentRuntimeFromContext,
  type GatewayAdapter,
  type GatewayContext,
} from "@paykernel/core";
import { TAP_ADAPTER_VERSION, TAP_CAPABILITIES } from "./capabilities";
import { copyTapConfig, type TapConfig } from "./config";
import { TapGateway } from "./gateway";

/**
 * Tap Payments adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 */
export function tapGateway(
  config: TapConfig,
): GatewayAdapter<"tap", TapGateway> {
  const closed = copyTapConfig(config);
  return {
    name: "tap",
    manifest: {
      name: "tap",
      displayName: "Tap Payments",
      version: TAP_ADAPTER_VERSION,
      apiVersion: "V2",
      capabilities: TAP_CAPABILITIES,
    },
    create(context: GatewayContext) {
      return new TapGateway(
        closed,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}
