// file: packages/core/src/create-payment-client.ts

import type { CreatePaymentClientOptions } from "./types/config.types";
import type { GatewayAdapter } from "./gateways/gateway-adapter";
import type { GatewayMap } from "./gateways/gateway-registry";
import type { PaymentGateway } from "./gateways/gateway.interface";
import { PaymentClient } from "./client";

/**
 * Infer gateway instance map from an adapters record.
 */
export type InferGatewayMapFromAdapters<
  TAdapters extends Record<string, GatewayAdapter>,
> = {
  [K in keyof TAdapters]: TAdapters[K] extends GatewayAdapter<
    string,
    infer G extends PaymentGateway
  >
    ? G
    : PaymentGateway;
};

/**
 * Preferred factory for a typed, registry-backed {@link PaymentClient}.
 *
 * Provide **exactly one** of `registry` or `gateways`. Mixing both, or omitting
 * both, throws {@link InvalidRequestError} at runtime (fail closed).
 *
 * @example Registry form
 * ```ts
 * const registry = createGatewayRegistry()
 *   .register(stripeGateway({ secretKey: '...' }))
 *   .register(moyasarGateway({ secretKey: '...' }))
 *   .build();
 * const client = createPaymentClient({ registry, defaultGateway: 'moyasar' });
 * ```
 *
 * @example Gateways map form
 * ```ts
 * const payments = createPaymentClient({
 *   gateways: {
 *     stripe: stripeGateway({ secretKey: '...' }),
 *     moyasar: moyasarGateway({ secretKey: '...' }),
 *     custom: customAdapter,
 *   },
 *   defaultGateway: 'moyasar',
 * });
 * payments.gateway('stripe'); // StripeGateway
 * ```
 */
export function createPaymentClient<TMap extends GatewayMap>(
  options: CreatePaymentClientOptions<TMap> & {
    registry: import("./gateways/gateway-registry").ImmutableGatewayRegistry<TMap>;
    gateways?: never;
  },
): PaymentClient<TMap>;

export function createPaymentClient<
  TAdapters extends Record<string, GatewayAdapter>,
>(
  options: {
    gateways: TAdapters;
    registry?: never;
    defaultGateway?: keyof TAdapters & string;
    hooks?: CreatePaymentClientOptions["hooks"];
    logger?: CreatePaymentClientOptions["logger"];
    /** Portable fetch/crypto/clock/randomUUID overrides (Phase 8). */
    runtime?: CreatePaymentClientOptions["runtime"];
  },
): PaymentClient<InferGatewayMapFromAdapters<TAdapters>>;

export function createPaymentClient<TMap extends GatewayMap>(
  options: CreatePaymentClientOptions<TMap>,
): PaymentClient<TMap>;

export function createPaymentClient(
  options:
    | CreatePaymentClientOptions
    | {
        gateways: Record<string, GatewayAdapter>;
        registry?: never;
        defaultGateway?: string;
        hooks?: CreatePaymentClientOptions["hooks"];
        logger?: CreatePaymentClientOptions["logger"];
        runtime?: CreatePaymentClientOptions["runtime"];
      },
): PaymentClient<GatewayMap> {
  return PaymentClient.createFromPlugin(
    options as CreatePaymentClientOptions,
  );
}
