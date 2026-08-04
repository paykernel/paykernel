// file: packages/core/src/gateways/gateway-adapter.ts

import type { GatewayContext } from "./gateway-context";
import type { GatewayManifest } from "./gateway-manifest";
import type { PaymentGateway } from "./gateway.interface";

/**
 * Factory that creates a configured {@link PaymentGateway} from a shared
 * {@link GatewayContext}.
 *
 * Adapters own secrets by closing over them in the factory (or in `create`).
 * Never put credentials on the context or the manifest.
 *
 * @typeParam TName - Stable gateway name produced by instances
 * @typeParam TGateway - Concrete gateway type returned by {@link create}
 */
export interface GatewayAdapter<
    TName extends string = string,
    TGateway extends PaymentGateway<TName> = PaymentGateway<TName>,
> {
    /** Must match `manifest.name` and instances' `name` */
    readonly name: TName;
    /** Frozen-safe descriptive metadata (no secrets) */
    readonly manifest: GatewayManifest;
    /**
     * Materialize a gateway instance. Prefer constructing once at client /
     * registry materialization time, not per request.
     */
    create(context: GatewayContext): TGateway;
}
