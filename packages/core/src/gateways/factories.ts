// file: packages/core/src/gateways/factories.ts

import { InvalidRequestError } from "../errors";
import type {
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  StripeConfig,
} from "../types/config.types";
import type { GatewayAdapter } from "./gateway-adapter";
import {
  BUILTIN_ADAPTER_VERSION,
  MOYASAR_CAPABILITIES,
  PAYMOB_CAPABILITIES,
  PAYPAL_CAPABILITIES,
  STRIPE_CAPABILITIES,
} from "./builtin-capabilities";
import { MoyasarGateway } from "./moyasar/moyasar.gateway";
import { PayPalGateway } from "./paypal/paypal.gateway";
import { PaymobGateway } from "./paymob/paymob.gateway";
import { StripeGateway } from "./stripe/stripe.gateway";
import { paymentRuntimeFromContext } from "../runtime/payment-runtime";

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Built-in Stripe gateway adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 * Credential checks match PaymentClient fail-fast validation.
 * Capability claims: {@link STRIPE_CAPABILITIES} (shared with StripeGateway).
 */
export function stripeGateway(
  config: StripeConfig,
): GatewayAdapter<"stripe", StripeGateway> {
  if (!nonEmpty(config.secretKey)) {
    throw new InvalidRequestError(
      "stripe.secretKey must be a non-empty string",
    );
  }

  return {
    name: "stripe",
    manifest: {
      name: "stripe",
      displayName: "Stripe",
      version: BUILTIN_ADAPTER_VERSION,
      capabilities: STRIPE_CAPABILITIES,
    },
    create(context) {
      return new StripeGateway(
        config,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}

/**
 * Built-in Moyasar gateway adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 * Credential checks match PaymentClient fail-fast validation.
 * Capability claims: {@link MOYASAR_CAPABILITIES} (shared with MoyasarGateway).
 */
export function moyasarGateway(
  config: MoyasarConfig,
): GatewayAdapter<"moyasar", MoyasarGateway> {
  if (!nonEmpty(config.secretKey)) {
    throw new InvalidRequestError(
      "moyasar.secretKey must be a non-empty string",
    );
  }

  return {
    name: "moyasar",
    manifest: {
      name: "moyasar",
      displayName: "Moyasar",
      version: BUILTIN_ADAPTER_VERSION,
      capabilities: MOYASAR_CAPABILITIES,
    },
    create(context) {
      return new MoyasarGateway(
        config,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}

/**
 * Built-in PayPal gateway adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 * Credential checks match PaymentClient fail-fast validation.
 * Capability claims: {@link PAYPAL_CAPABILITIES} (shared with PayPalGateway).
 */
export function paypalGateway(
  config: PayPalConfig,
): GatewayAdapter<"paypal", PayPalGateway> {
  if (!nonEmpty(config.clientId)) {
    throw new InvalidRequestError(
      "paypal.clientId must be a non-empty string",
    );
  }
  if (!nonEmpty(config.clientSecret)) {
    throw new InvalidRequestError(
      "paypal.clientSecret must be a non-empty string",
    );
  }

  return {
    name: "paypal",
    manifest: {
      name: "paypal",
      displayName: "PayPal",
      version: BUILTIN_ADAPTER_VERSION,
      capabilities: PAYPAL_CAPABILITIES,
    },
    create(context) {
      return new PayPalGateway(
        config,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}

/**
 * Built-in Paymob gateway adapter factory.
 *
 * Closes over credentials; never places secrets on the context or manifest.
 * Credential checks match PaymentClient fail-fast validation
 * (`secretKey` or legacy `apiKey`).
 * Capability claims: {@link PAYMOB_CAPABILITIES} (shared with PaymobGateway).
 */
export function paymobGateway(
  config: PaymobConfig,
): GatewayAdapter<"paymob", PaymobGateway> {
  const hasSecretKey = nonEmpty(config.secretKey);
  const hasApiKey = nonEmpty(config.apiKey);
  if (!hasSecretKey && !hasApiKey) {
    throw new InvalidRequestError(
      "paymob requires secretKey or apiKey as a non-empty string",
    );
  }

  return {
    name: "paymob",
    manifest: {
      name: "paymob",
      displayName: "Paymob",
      version: BUILTIN_ADAPTER_VERSION,
      capabilities: PAYMOB_CAPABILITIES,
    },
    create(context) {
      return new PaymobGateway(
        config,
        context.hooks,
        context.logger,
        paymentRuntimeFromContext(context),
      );
    },
  };
}
