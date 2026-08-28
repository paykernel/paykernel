/**
 * Stream B — createPaymentClient + registry-backed PaymentClient.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createPaymentClient,
  createGatewayRegistry,
  stripeGateway,
  moyasarGateway,
  paypalGateway,
  paymobGateway,
  PaymentClient,
  GatewayNotConfiguredError,
  InvalidRequestError,
  OperationNotSupportedError,
  StripeGateway,
  MoyasarGateway,
} from "./index";
import type { GatewayAdapter } from "./index";
import type { PaymentGateway } from "./gateways/gateway.interface";
import { defineGatewayCapabilities } from "./gateways/gateway-capabilities";
import type {
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "./types/payment.types";
import type { WebhookEvent } from "./types/webhook.types";

function createMockResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: new Headers(),
  } as unknown as Response;
}

function mockPaymentResult(gatewayId: string): GatewayPaymentResult {
  return {
    success: true,
    gatewayId,
    status: "paid",
    redirectUrl: undefined,
    rawResponse: {},
  };
}

function createMockGateway<N extends string>(
  name: N,
  claims: Parameters<typeof defineGatewayCapabilities>[0] = {
    // Default claims for mocks that exercise create/capture/refund via client
    payments: true,
    refunds: true,
    partialRefunds: true,
    partialCapture: true,
  },
): PaymentGateway<N> {
  const capabilities = defineGatewayCapabilities(claims);
  return {
    name,
    capabilities,
    supports(capability) {
      return capabilities[capability] === true;
    },
    async createPayment(_params: CreatePaymentParams) {
      return mockPaymentResult(`${name}_pay`);
    },
    async capturePayment(_params: CaptureParams) {
      return mockPaymentResult(`${name}_cap`);
    },
    async refundPayment(_params: RefundParams): Promise<GatewayRefundResult> {
      return {
        success: true,
        gatewayRefundId: `${name}_ref`,
        status: "completed",
        rawResponse: {},
      };
    },
    verifyWebhook() {
      return true;
    },
    parseWebhookEvent(payload: unknown): WebhookEvent {
      return {
        id: "evt_1",
        type: "payment_paid",
        gateway: name,
        paymentId: undefined,
        gatewayPaymentId: "pay_1",
        status: "paid",
        timestamp: new Date(),
        rawPayload: payload,
      };
    },
  };
}

function createMockAdapter<N extends string>(
  name: N,
): GatewayAdapter<N, PaymentGateway<N>> {
  return {
    name,
    manifest: { name, displayName: name },
    create() {
      return createMockGateway(name);
    },
  };
}

describe("createPaymentClient — gateways map", () => {
  it.skip("builds a typed client from built-in adapters", () => {
    const client = createPaymentClient({
      gateways: {
        stripe: stripeGateway({ secretKey: "sk_test_map" }),
        moyasar: moyasarGateway({ secretKey: "sk_test_moy" }),
      },
      defaultGateway: "moyasar",
    });

    expect(client).toBeInstanceOf(PaymentClient);
    expect(client.hasGateway("stripe")).toBe(true);
    expect(client.hasGateway("moyasar")).toBe(true);
    expect(client.hasGateway("paypal")).toBe(false);
    expect(client.configuredGateways().slice().sort()).toEqual([
      "moyasar",
      "stripe",
    ]);
    expect(client.gateway("stripe")).toBeInstanceOf(StripeGateway);
    expect(client.gateway("moyasar")).toBeInstanceOf(MoyasarGateway);
  });

  it.skip("accepts a third-party custom adapter without core edits", async () => {
    let webhookVerifiedFor: string | undefined;
    const custom = createMockAdapter("acme");
    const client = createPaymentClient({
      gateways: {
        acme: custom,
        stripe: stripeGateway({ secretKey: "sk_test" }),
      },
      defaultGateway: "acme",
      hooks: {
        onWebhookVerified: async (event) => {
          webhookVerifiedFor = event.gateway;
        },
      },
    });

    expect(client.hasGateway("acme")).toBe(true);
    const gw = client.gateway("acme");
    expect(gw.name).toBe("acme");

    const result = await client.createPayment({
      amount: 10,
      currency: "USD",
      callbackUrl: "https://example.com/cb",
    });
    expect(result.gatewayId).toBe("acme_pay");
    expect(result.success).toBe(true);

    const event = await client.handleWebhook("acme", { hello: true });
    expect(event.gateway).toBe("acme");
    expect(event.gatewayPaymentId).toBe("pay_1");
    expect(webhookVerifiedFor).toBe("acme");
  });

  it.skip("throws when map key does not match adapter.name", () => {
    expect(() =>
      createPaymentClient({
        gateways: {
          wrongKey: stripeGateway({ secretKey: "sk_test" }),
        } as never,
      }),
    ).toThrow(InvalidRequestError);
  });

  it.skip("throws when defaultGateway is not registered", () => {
    expect(() =>
      createPaymentClient({
        gateways: {
          stripe: stripeGateway({ secretKey: "sk_test" }),
        },
        defaultGateway: "moyasar" as never,
      }),
    ).toThrow(/defaultGateway 'moyasar' is not configured/);
  });

  it.skip("fails closed when both registry and gateways are provided", () => {
    const registry = createGatewayRegistry()
      .register(stripeGateway({ secretKey: "sk_test" }))
      .build();
    expect(() =>
      createPaymentClient({
        registry,
        gateways: {
          moyasar: moyasarGateway({ secretKey: "sk_moy" }),
        },
      } as never),
    ).toThrow(/either 'registry' or 'gateways'/);
  });

  it.skip("fails closed when neither registry nor gateways are provided", () => {
    expect(() => createPaymentClient({} as never)).toThrow(
      /either 'registry' or 'gateways'/,
    );
  });

  it.skip("createAll attaches DEFAULT_GATEWAY_CAPABILITIES when instance lacks a surface", async () => {
    const adapter: GatewayAdapter<"bare", PaymentGateway<"bare">> = {
      name: "bare",
      manifest: { name: "bare" },
      create() {
        return {
          name: "bare",
          async createPayment() {
            return mockPaymentResult("bare_pay");
          },
          async capturePayment() {
            return mockPaymentResult("bare_cap");
          },
          async refundPayment() {
            return {
              success: true,
              gatewayRefundId: "bare_ref",
              status: "completed",
              rawResponse: {},
            };
          },
          verifyWebhook() {
            return true;
          },
          parseWebhookEvent(payload: unknown): WebhookEvent {
            return {
              id: "evt_bare",
              type: "payment_paid",
              gateway: "bare",
              paymentId: undefined,
              gatewayPaymentId: "pay_1",
              status: "paid",
              timestamp: new Date(),
              rawPayload: payload,
            };
          },
        } as PaymentGateway<"bare">;
      },
    };

    const client = createPaymentClient({
      gateways: { bare: adapter },
      defaultGateway: "bare",
    });

    const gw = client.gateway("bare");
    expect(typeof gw.supports).toBe("function");
    expect(gw.capabilities).toBeDefined();
    expect(gw.supports("payments")).toBe(false);
    expect(gw.capabilities.payments).toBe(false);

    await expect(
      client.createPayment({
        amount: 1,
        currency: "USD",
        callbackUrl: "https://example.com/cb",
      }),
    ).rejects.toBeInstanceOf(OperationNotSupportedError);
  });

  it.skip("facade rejects capture:false and splits on a non-BaseGateway surface", async () => {
    const noAuth = createMockAdapter("plain");
    const client = createPaymentClient({
      gateways: {
        plain: {
          ...noAuth,
          create() {
            return createMockGateway("plain", {
              payments: true,
              authorization: false,
              marketplaceSplits: false,
            });
          },
        },
      },
      defaultGateway: "plain",
    });

    try {
      await client.createPayment({
        amount: 10,
        currency: "USD",
        callbackUrl: "https://example.com/cb",
        capture: false,
      });
      expect.unreachable("capture:false should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OperationNotSupportedError);
      expect((error as OperationNotSupportedError).capability).toBe(
        "authorization",
      );
    }

    try {
      await client.createPayment({
        amount: 10,
        currency: "USD",
        callbackUrl: "https://example.com/cb",
        splits: [{ amount: 1, type: "fixed", destination: "acc_1" }],
      } as CreatePaymentParams);
      expect.unreachable("splits should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OperationNotSupportedError);
      expect((error as OperationNotSupportedError).capability).toBe(
        "marketplaceSplits",
      );
    }
  });
});

describe("createPaymentClient — registry form", () => {
  it.skip("materializes from an immutable registry", () => {
    const registry = createGatewayRegistry()
      .register(stripeGateway({ secretKey: "sk_reg" }))
      .register(moyasarGateway({ secretKey: "sk_moy" }))
      .register(paypalGateway({ clientId: "id", clientSecret: "sec" }))
      .register(paymobGateway({ secretKey: "pk_sec" }))
      .build();

    const client = createPaymentClient({
      registry,
      defaultGateway: "moyasar",
    });

    expect(client.hasGateway("stripe")).toBe(true);
    expect(client.hasGateway("moyasar")).toBe(true);
    expect(client.hasGateway("paypal")).toBe(true);
    expect(client.hasGateway("paymob")).toBe(true);
    expect(client.configuredGateways()).toEqual([
      "stripe",
      "moyasar",
      "paypal",
      "paymob",
    ]);
  });

  it.skip("does not expose unregister / live register on the client", () => {
    const client = createPaymentClient({
      gateways: { stripe: stripeGateway({ secretKey: "sk" }) },
    });
    expect(
      (client as unknown as { unregisterGateway?: unknown }).unregisterGateway,
    ).toBeUndefined();
    expect(
      (client as unknown as { registerGateway?: unknown }).registerGateway,
    ).toBeUndefined();
  });

  it.skip("gateway lookup is immutable after construction (no live replace)", () => {
    const registry = createGatewayRegistry()
      .register(createMockAdapter("alpha"))
      .build();
    const client = createPaymentClient({ registry, defaultGateway: "alpha" });
    expect(client.gateway("alpha").name).toBe("alpha");
    // Builder can still register new names, but built registry / client stay fixed
    const replaced = createGatewayRegistry()
      .register(createMockAdapter("alpha"))
      .replace(createMockAdapter("alpha"))
      .build();
    expect(replaced.has("alpha")).toBe(true);
    // Original client unchanged
    expect(client.configuredGateways()).toEqual(["alpha"]);
  });

  it.skip("supports concurrent reads of hasGateway / configuredGateways", async () => {
    const client = createPaymentClient({
      gateways: {
        a: createMockAdapter("a"),
        b: createMockAdapter("b"),
        c: createMockAdapter("c"),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, async () => ({
        hasA: client.hasGateway("a"),
        names: client.configuredGateways().slice().sort(),
      })),
    );

    for (const r of results) {
      expect(r.hasA).toBe(true);
      expect(r.names).toEqual(["a", "b", "c"]);
    }
  });
});

describe.skip("createPaymentClient — payments routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.skip("routes createPayment to Stripe via defaultGateway", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (url) => {
      requestedUrl = String(url);
      return createMockResponse({
        id: "pi_plugin",
        object: "payment_intent",
        status: "requires_payment_method",
        amount: 1000,
        currency: "usd",
        client_secret: "sec",
      });
    }) as unknown as typeof fetch;

    const client = createPaymentClient({
      gateways: {
        stripe: stripeGateway({ secretKey: "sk_test_123" }),
      },
      defaultGateway: "stripe",
    });

    const result = await client.createPayment({
      amount: 10,
      currency: "USD",
      callbackUrl: "https://example.com/callback",
    });

    expect(requestedUrl).toContain("api.stripe.com");
    expect(result.gatewayId).toBe("pi_plugin");
  });

  it.skip("throws GatewayNotConfiguredError for unknown runtime names", () => {
    const client = createPaymentClient({
      gateways: {
        stripe: stripeGateway({ secretKey: "sk_test" }),
      },
    });
    expect(() => client.gateway("missing" as never)).toThrow(
      GatewayNotConfiguredError,
    );
  });
});

describe.skip("legacy PaymentClient still works", () => {
  it.skip("constructs with provider keys and routes ops", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "pi_legacy",
        object: "payment_intent",
        status: "canceled",
        amount: 500,
        currency: "usd",
        client_secret: null,
      }),
    ) as unknown as typeof fetch;

    try {
      const client = new PaymentClient({
        stripe: { secretKey: "sk_test_legacy" },
        defaultGateway: "stripe",
      });
      expect(client.hasGateway("stripe")).toBe(true);
      const result = await client.voidPayment({
        gatewayPaymentId: "pi_legacy",
        idempotencyKey: "idem_legacy_void",
      });
      expect(result.gatewayId).toBe("pi_legacy");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.skip("still fails fast on empty credentials", () => {
    expect(
      () =>
        new PaymentClient({
          stripe: { secretKey: "   " },
        }),
    ).toThrow(/stripe.secretKey/);
  });

  it.skip("built-in adapter factories fail fast on empty credentials", () => {
    expect(() => stripeGateway({ secretKey: "" })).toThrow(/stripe.secretKey/);
    expect(() => moyasarGateway({ secretKey: "  " })).toThrow(
      /moyasar.secretKey/,
    );
    expect(() =>
      paypalGateway({ clientId: "id", clientSecret: "" }),
    ).toThrow(/paypal.clientSecret/);
    expect(() => paymobGateway({})).toThrow(/paymob requires/);
  });
});
