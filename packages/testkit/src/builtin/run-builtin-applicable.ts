/**
 * Offline applicable/structural runners for built-in gateway factories.
 *
 * Never calls live provider APIs. Uses dummy credentials and
 * {@link createDefaultGatewayContext}. Network ops are skipped by the suite
 * in `applicable` / `structural` modes unless a scriptable mock is used.
 */

import {
  createDefaultGatewayContext,
  moyasarGateway,
  paymobGateway,
  paypalGateway,
  stripeGateway,
  type GatewayCapabilities,
  type PaymentGateway,
} from "@paykernel/core";
import { runGatewayConformanceSuite } from "../conformance/gateway-conformance";
import type {
  GatewayConformanceFixtures,
  GatewayConformanceMode,
  GatewayConformanceReport,
} from "../conformance/types";

export type BuiltinGatewayName = "stripe" | "moyasar" | "paypal" | "paymob";

export type RunBuiltinConformanceOptions = {
  /** Display name (defaults to gateway id). */
  name?: string;
  mode?: Extract<GatewayConformanceMode, "applicable" | "structural">;
  fixtures?: GatewayConformanceFixtures;
  /** Override expected capabilities (defaults to factory manifest / instance). */
  capabilities?: GatewayCapabilities;
};

/** Synthetic credentials only — never used online in these runners. */
export const BUILTIN_TEST_CREDENTIALS = {
  stripe: {
    secretKey: "sk_test_conformance_placeholder_not_live",
    webhookSecret: "whsec_test_conformance_placeholder",
  },
  moyasar: {
    secretKey: "sk_test_conformance_placeholder_not_live",
    webhookSecret: "test_webhook_placeholder",
  },
  paypal: {
    clientId: "test_client_placeholder",
    clientSecret: "test_secret_placeholder_not_a_live_key",
    // PayPal validates webhookId as alphanumeric ≤50 (no underscores)
    webhookId: "testWebhookIdPlaceholder01",
  },
  paymob: {
    secretKey: "sk_test_conformance_placeholder_not_live",
    publicKey: "test_public_placeholder",
    hmacSecret: "test_hmac_placeholder",
  },
} as const;

function createBuiltinGateway(name: BuiltinGatewayName): PaymentGateway {
  const ctx = createDefaultGatewayContext();
  switch (name) {
    case "stripe":
      return stripeGateway(BUILTIN_TEST_CREDENTIALS.stripe).create(ctx);
    case "moyasar":
      return moyasarGateway(BUILTIN_TEST_CREDENTIALS.moyasar).create(ctx);
    case "paypal":
      return paypalGateway(BUILTIN_TEST_CREDENTIALS.paypal).create(ctx);
    case "paymob":
      return paymobGateway(BUILTIN_TEST_CREDENTIALS.paymob).create(ctx);
    default: {
      const _exhaustive: never = name;
      throw new Error(`unknown builtin ${_exhaustive}`);
    }
  }
}

/**
 * Run offline applicable (default) or structural conformance for a built-in.
 */
export async function runBuiltinGatewayConformance(
  gateway: BuiltinGatewayName,
  options: RunBuiltinConformanceOptions = {},
): Promise<GatewayConformanceReport> {
  const mode = options.mode ?? "applicable";
  const suiteOpts: Parameters<typeof runGatewayConformanceSuite>[0] = {
    name: options.name ?? `builtin:${gateway}`,
    mode,
    createGateway: () => createBuiltinGateway(gateway),
  };
  if (options.capabilities !== undefined) {
    suiteOpts.capabilities = options.capabilities;
  }
  if (options.fixtures !== undefined) {
    suiteOpts.fixtures = options.fixtures;
  }
  return runGatewayConformanceSuite(suiteOpts);
}

/** All built-in ids for iteration in tests. */
export const BUILTIN_GATEWAY_NAMES: readonly BuiltinGatewayName[] = [
  "stripe",
  "moyasar",
  "paypal",
  "paymob",
] as const;
