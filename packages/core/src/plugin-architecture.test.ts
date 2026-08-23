/**
 * Phase 2 plugin architecture — acceptance runtime tests.
 *
 * Covers third-party adapters through payments/webhooks/hooks/logging/errors,
 * registry builder path, duplicate/replace, immutability, legacy constructor,
 * concurrent usage, hasGateway/configuredGateways, defaultGateway validation,
 * and fail-closed ambiguous config.
 */
import { describe, it, expect } from "bun:test";
import {
  BaseGateway,
  createPaymentClient,
  createGatewayRegistry,
  createDefaultGatewayContext,
  PaymentClient,
  PaymentError,
  InvalidRequestError,
  GatewayNotConfiguredError,
  InvalidWebhookError,
  CardDeclinedError,
  defineGatewayCapabilities,
  type GatewayAdapter,
  type GatewayContext,
  type PaymentGateway,
  type CreatePaymentParams,
  type CaptureParams,
  type RefundParams,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type WebhookEvent,
  type Logger,
} from "./index";

// ─── Test helpers ────────────────────────────────────────────────────────────

function mockPaymentResult(
  gatewayId: string,
  overrides: Partial<GatewayPaymentResult> = {},
): GatewayPaymentResult {
  return {
    success: true,
    gatewayId,
    status: "paid",
    redirectUrl: undefined,
    rawResponse: {},
    amount: 10,
    ...overrides,
  };
}

/**
 * Custom third-party gateway used across acceptance tests.
 * Extends BaseGateway so hooks/logging/errors match first-party behavior.
 */
class CustomGateway extends BaseGateway {
  readonly name = "custom" as const;
  /** Optional inject for failing createPayment with PaymentError subclasses */
  failCreateWith: Error | undefined;

  constructor(config: Record<string, unknown>, hooks: GatewayContext["hooks"], logger?: Logger) {
    // Explicit claims for ops exercised via PaymentClient in Phase 2/3 tests.
    // BaseGateway defaults to all-false (fail-closed) without this.
    super(config, hooks, logger, {
      payments: true,
      immediateCapture: true,
      authorization: true,
      partialCapture: true,
      refunds: true,
      partialRefunds: true,
      voids: false,
    });
  }

  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Log a secret-shaped field so redaction can be asserted
      this.logger.info("custom.createPayment", {
        amount: p.amount,
        secretKey: "sk_live_should_be_redacted",
        apiKey: "api_key_value",
      });
      if (this.failCreateWith) {
        throw this.failCreateWith;
      }
      return mockPaymentResult(`custom_${p.amount}`, {
        amount: p.amount,
        rawResponse: { provider: "custom", orderId: p.orderId },
      });
    });
  }

  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async () =>
      mockPaymentResult(`custom_cap_${params.gatewayPaymentId}`),
    );
  }

  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async () => ({
      success: true,
      gatewayRefundId: `custom_ref_${params.gatewayPaymentId}`,
      status: "completed" as const,
      rawResponse: {},
    }));
  }

  verifyWebhook(
    payload: unknown,
    signature?: string,
    _headers?: Record<string, string>,
  ): boolean {
    if (typeof payload !== "object" || payload === null) return false;
    const body = payload as { signature?: string };
    // Accept matching signature header or body.signature === "valid"
    if (signature === "valid-sig") return true;
    return body.signature === "valid";
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    const body = payload as {
      id?: string;
      paymentId?: string;
      status?: string;
    };
    return {
      id: body.id ?? "evt_custom_1",
      type: "payment_paid",
      gateway: "custom",
      paymentId: body.paymentId,
      gatewayPaymentId: body.paymentId ?? "pay_custom_1",
      status: (body.status as WebhookEvent["status"]) ?? "paid",
      timestamp: new Date(),
      rawPayload: payload,
    };
  }
}

function createCustomAdapter(options?: {
  apiKey?: string;
  name?: "custom";
}): GatewayAdapter<"custom", CustomGateway> {
  const apiKey = options?.apiKey ?? "custom_api_key_test";
  // Close over secrets — never put on context/manifest
  const closed = { apiKey };
  return {
    name: "custom",
    manifest: {
      name: "custom",
      displayName: "Custom Example Gateway",
      version: "0.0.1",
      metadata: { kind: "third-party-test" },
    },
    create(context: GatewayContext) {
      return new CustomGateway(closed, context.hooks, context.logger);
    },
  };
}

function createNamedAdapter<N extends string>(
  name: N,
): GatewayAdapter<N, PaymentGateway<N>> {
  // Named adapters create payments in these tests — claim payments:true so
  // createAll fail-closed defaults do not block client.createPayment.
  const capabilities = defineGatewayCapabilities({ payments: true });
  return {
    name,
    manifest: { name, displayName: name },
    create() {
      return {
        name,
        capabilities,
        supports(capability) {
          return capabilities[capability] === true;
        },
        async createPayment() {
          return mockPaymentResult(`${name}_pay`);
        },
        async capturePayment() {
          return mockPaymentResult(`${name}_cap`);
        },
        async refundPayment() {
          return {
            success: true,
            gatewayRefundId: `${name}_ref`,
            status: "completed" as const,
            rawResponse: {},
          };
        },
        verifyWebhook() {
          return true;
        },
        parseWebhookEvent(payload: unknown): WebhookEvent {
          return {
            id: "evt",
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
    },
  };
}

const baseCreateParams: CreatePaymentParams = {
  amount: 42.5,
  currency: "USD",
  callbackUrl: "https://example.com/callback",
  orderId: "ord_plugin_1",
};

// ─── 1) Third-party custom gateway via gateways map ──────────────────────────

describe("Phase 2: third-party gateway via createPaymentClient({ gateways })", () => {
  it("createPayment returns a normalized GatewayPaymentResult", async () => {
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
    });

    const result = await client.createPayment(baseCreateParams);

    expect(result.success).toBe(true);
    expect(result.gatewayId).toBe("custom_42.5");
    expect(result.status).toBe("paid");
    expect(result.amount).toBe(42.5);
    expect(result.rawResponse).toMatchObject({ provider: "custom" });
  });

  it("handleWebhook verifies + parses; onWebhookVerified runs", async () => {
    const verifiedEvents: WebhookEvent[] = [];
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
      hooks: {
        onWebhookVerified: (event) => {
          verifiedEvents.push(event);
        },
      },
    });

    const event = await client.handleWebhook(
      "custom",
      { id: "evt_1", paymentId: "pay_99", signature: "valid" },
      "valid-sig",
    );

    expect(event.gateway).toBe("custom");
    expect(event.gatewayPaymentId).toBe("pay_99");
    expect(event.status).toBe("paid");
    expect(verifiedEvents).toHaveLength(1);
    expect(verifiedEvents[0]!.id).toBe("evt_1");
  });

  it("rejects invalid webhook signatures with InvalidWebhookError", async () => {
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
    });

    await expect(
      client.handleWebhook("custom", { signature: "bad" }, "wrong-sig"),
    ).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("hooks beforeCreatePayment fires with gateway name 'custom'", async () => {
    const seenGateways: string[] = [];
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
      hooks: {
        beforeCreatePayment: (ctx) => {
          seenGateways.push(ctx.gateway);
          return { proceed: true };
        },
      },
    });

    await client.createPayment(baseCreateParams);
    expect(seenGateways).toEqual(["custom"]);
  });

  it("logger receives redacted logs when gateway logs secrets", async () => {
    const infoCalls: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    const sink: Logger = {
      debug() {},
      info(message, context) {
        infoCalls.push({ message, context });
      },
      warn() {},
      error() {},
    };

    // Client + BaseGateway must leave the sink free of cleartext secrets.
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter({ apiKey: "super_secret_key" }) },
      defaultGateway: "custom",
      logger: sink,
    });

    await client.createPayment(baseCreateParams);

    const customLog = infoCalls.find((c) =>
      c.message.includes("custom.createPayment"),
    );
    expect(customLog).toBeDefined();
    expect(customLog!.context).toBeDefined();
    const ctxStr = JSON.stringify(customLog!.context);
    expect(ctxStr).not.toContain("sk_live_should_be_redacted");
    expect(ctxStr).not.toContain("api_key_value");
    // Amount is not sensitive and should survive redaction (or be present as number)
    expect(customLog!.context).toMatchObject({ amount: 42.5 });
  });

  it("PaymentError subclasses thrown by the gateway still propagate", async () => {
    const adapter: GatewayAdapter<"custom", CustomGateway> = {
      name: "custom",
      manifest: { name: "custom" },
      create(context) {
        const gw = new CustomGateway({}, context.hooks, context.logger);
        gw.failCreateWith = new CardDeclinedError("card was declined");
        return gw;
      },
    };

    const client = createPaymentClient({
      gateways: { custom: adapter },
      defaultGateway: "custom",
    });

    try {
      await client.createPayment(baseCreateParams);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CardDeclinedError);
      expect(err).toBeInstanceOf(PaymentError);
      expect((err as CardDeclinedError).message).toMatch(/declined/i);
    }
  });

  it("gateway('custom') returns the concrete CustomGateway instance", () => {
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
    });
    const gw = client.gateway("custom");
    expect(gw).toBeInstanceOf(CustomGateway);
    expect(gw.name).toBe("custom");
  });
});

// ─── 2) Registry builder path end-to-end ─────────────────────────────────────

describe("Phase 2: createPaymentClient({ registry }) end-to-end", () => {
  it("builds from createGatewayRegistry().register().build() and runs payments", async () => {
    const registry = createGatewayRegistry()
      .register(createCustomAdapter())
      .register(createNamedAdapter("alpha"))
      .build();

    const client = createPaymentClient({
      registry,
      defaultGateway: "custom",
    });

    expect(client.hasGateway("custom")).toBe(true);
    expect(client.hasGateway("alpha")).toBe(true);
    expect(client.configuredGateways().sort()).toEqual(
      ["alpha", "custom"].sort(),
    );

    const customResult = await client.createPayment(baseCreateParams, "custom");
    expect(customResult.gatewayId).toBe("custom_42.5");

    const alphaResult = await client.createPayment(baseCreateParams, "alpha");
    expect(alphaResult.gatewayId).toBe("alpha_pay");
  });
});

// ─── 3) Duplicate register throws; replace works ─────────────────────────────

describe("Phase 2: registry duplicate / replace", () => {
  it("duplicate register throws InvalidRequestError", () => {
    const builder = createGatewayRegistry().register(createCustomAdapter());
    expect(() => builder.register(createCustomAdapter())).toThrow(
      InvalidRequestError,
    );
  });

  it("replace overwrites adapter and preserves registration order", async () => {
    const first: GatewayAdapter<"custom", PaymentGateway<"custom">> = {
      name: "custom",
      manifest: { name: "custom", displayName: "First" },
      create: () =>
        createNamedAdapter("custom").create(createDefaultGatewayContext()),
    };
    const second = createCustomAdapter();

    const registry = createGatewayRegistry()
      .register(first)
      .register(createNamedAdapter("alpha"))
      .replace(second)
      .build();

    expect(registry.names()).toEqual(["custom", "alpha"]);
    expect(registry.getAdapter("custom")?.manifest.displayName).toBe(
      "Custom Example Gateway",
    );

    const client = createPaymentClient({
      registry,
      defaultGateway: "custom",
    });
    const result = await client.createPayment(baseCreateParams);
    expect(result.gatewayId).toBe("custom_42.5");
  });
});

// ─── 4) Built registry is immutable ──────────────────────────────────────────

describe("Phase 2: built registry immutability", () => {
  it("has no register method; Object.isFrozen where applied", () => {
    const registry = createGatewayRegistry()
      .register(createCustomAdapter())
      .build();

    expect(Object.isFrozen(registry)).toBe(true);
    expect(
      (registry as unknown as { register?: unknown }).register,
    ).toBeUndefined();
    expect(typeof registry.createAll).toBe("function");

    const names = registry.names();
    expect(Object.isFrozen(names)).toBe(true);
    expect(() => {
      (names as string[]).push("hacked");
    }).toThrow();

    const [manifest] = registry.manifests();
    expect(manifest).toBeDefined();
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(() => {
      (manifest as { name: string }).name = "mutated";
    }).toThrow();
  });

  it("further builder.register does not mutate an already-built registry", () => {
    const builder = createGatewayRegistry().register(createNamedAdapter("a"));
    const frozen = builder.build();
    const next = builder.register(createNamedAdapter("b")).build();

    expect(frozen.names()).toEqual(["a"]);
    expect(next.names()).toEqual(["a", "b"]);
  });
});

// ─── 5) Legacy PaymentClient still constructs ────────────────────────────────

describe("Phase 2: legacy new PaymentClient path", () => {
  it("still constructs with moyasar config and defaultGateway", () => {
    const client = new PaymentClient({
      moyasar: { secretKey: "sk_test_x" },
      defaultGateway: "moyasar",
    });
    expect(client).toBeInstanceOf(PaymentClient);
    expect(client.hasGateway("moyasar")).toBe(true);
    expect(client.configuredGateways()).toEqual(["moyasar"]);
    expect(client.gateway("moyasar").name).toBe("moyasar");
  });
});

// ─── 6) Concurrent usage without mid-flight registry swap ────────────────────

describe("Phase 2: concurrent usage", () => {
  it("Promise.all createPayment on two gateways uses stable instances", async () => {
    const client = createPaymentClient({
      gateways: {
        custom: createCustomAdapter(),
        alpha: createNamedAdapter("alpha"),
      },
      defaultGateway: "custom",
    });

    const customRef = client.gateway("custom");
    const alphaRef = client.gateway("alpha");

    const [r1, r2, r3, r4] = await Promise.all([
      client.createPayment(baseCreateParams, "custom"),
      client.createPayment(baseCreateParams, "alpha"),
      client.createPayment({ ...baseCreateParams, amount: 1 }, "custom"),
      client.createPayment({ ...baseCreateParams, amount: 2 }, "alpha"),
    ]);

    // Same instances after concurrent ops (no mid-flight replace)
    expect(client.gateway("custom")).toBe(customRef);
    expect(client.gateway("alpha")).toBe(alphaRef);

    expect(r1.gatewayId).toBe("custom_42.5");
    expect(r2.gatewayId).toBe("alpha_pay");
    expect(r3.gatewayId).toBe("custom_1");
    expect(r4.gatewayId).toBe("alpha_pay");

    // No public way to add gateways mid-flight
    expect(
      (client as unknown as { registerGateway?: unknown }).registerGateway,
    ).toBeUndefined();
    expect(
      (client as unknown as { unregisterGateway?: unknown }).unregisterGateway,
    ).toBeUndefined();
  });
});

// ─── 7) hasGateway / configuredGateways reflect registry ─────────────────────

describe("Phase 2: hasGateway / configuredGateways", () => {
  it("reflect registered names only", () => {
    const registry = createGatewayRegistry()
      .register(createNamedAdapter("one"))
      .register(createNamedAdapter("two"))
      .build();

    const client = createPaymentClient({ registry });

    expect(client.hasGateway("one")).toBe(true);
    expect(client.hasGateway("two")).toBe(true);
    expect(client.hasGateway("three")).toBe(false);
    expect(client.configuredGateways()).toEqual(["one", "two"]);
  });
});

// ─── 8) defaultGateway validation ────────────────────────────────────────────

describe("Phase 2: defaultGateway validation", () => {
  it("fails when defaultGateway is not in the registry/map", () => {
    expect(() =>
      createPaymentClient({
        gateways: { custom: createCustomAdapter() },
        // @ts-expect-error — not a registered name (runtime still validates)
        defaultGateway: "missing",
      }),
    ).toThrow(InvalidRequestError);

    try {
      createPaymentClient({
        gateways: { custom: createCustomAdapter() },
        defaultGateway: "missing" as "custom",
      });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRequestError);
      expect((err as Error).message).toMatch(/defaultGateway.*not configured/i);
    }
  });

  it("throws when ops omit gateway and no default is set on a multi-gateway client", async () => {
    const client = createPaymentClient({
      gateways: {
        custom: createCustomAdapter(),
        alpha: createNamedAdapter("alpha"),
      },
    });

    await expect(client.createPayment(baseCreateParams)).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("uses the sole configured gateway when defaultGateway is omitted", async () => {
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
    });

    const result = await client.createPayment(baseCreateParams);
    expect(result.success).toBe(true);
    expect(result.gatewayId).toBe("custom_42.5");
  });

  it("uses the sole registry gateway when defaultGateway is omitted", async () => {
    const client = createPaymentClient({
      registry: createGatewayRegistry().register(createCustomAdapter()).build(),
    });

    const result = await client.createPayment(baseCreateParams);
    expect(result.success).toBe(true);
    expect(result.gatewayId).toBe("custom_42.5");
  });
});

// ─── 9) Ambiguous config fails closed ────────────────────────────────────────

describe("Phase 2: ambiguous / invalid createPaymentClient config", () => {
  it("rejects both registry and gateways", () => {
    const registry = createGatewayRegistry()
      .register(createCustomAdapter())
      .build();

    expect(() =>
      createPaymentClient({
        registry,
        gateways: { custom: createCustomAdapter() },
      } as never),
    ).toThrow(InvalidRequestError);
  });

  it("rejects neither registry nor gateways", () => {
    expect(() => createPaymentClient({} as never)).toThrow(InvalidRequestError);
  });

  it("throws GatewayNotConfiguredError for unknown names at runtime", () => {
    const client = createPaymentClient({
      gateways: { custom: createCustomAdapter() },
      defaultGateway: "custom",
    });
    expect(() => client.gateway("nope" as "custom")).toThrow(
      GatewayNotConfiguredError,
    );
  });
});
