/**
 * Phase 22.1 acceptance — customers and stored payment methods.
 *
 * Unique coverage (not in Phase 3 claim keys or createPayment stripe* fields):
 * - client.createCustomer / getCustomer gated on `customers`
 * - attach / list / detach gated on `paymentMethods` (claim beats method presence)
 * - create + get + attach + list + detach through a claiming adapter
 * - raw PAN / CVC rejected before the adapter runs
 * - off-session createPayment requires a customer id and a stored method id and still rejects PAN
 *
 * No live provider calls.
 */
import { describe, it, expect } from "bun:test";
import {
  BaseGateway,
  CAPABILITY_OPERATION_MAP,
  InvalidRequestError,
  OperationNotSupportedError,
  buildProviderReferences,
  createPaymentClient,
  type AttachPaymentMethodParams,
  type CaptureParams,
  type CreateCustomerParams,
  type CreatePaymentParams,
  type Customer,
  type CustomerOperationResult,
  type GatewayAdapter,
  type GatewayCapabilities,
  type GatewayContext,
  type GatewayPaymentResult,
  type ListPaymentMethodsResult,
  type PaymentMethodOperationResult,
  type RefundParams,
  type StoredPaymentMethod,
  type WebhookEvent,
} from "./index";

function paidResult(gatewayId: string): GatewayPaymentResult {
  return {
    success: true,
    gatewayId,
    status: "paid",
    rawResponse: {},
  };
}

class VaultGateway extends BaseGateway {
  readonly name = "vault";
  createCustomerCalls = 0;
  attachCalls = 0;
  lastCreatePayment: CreatePaymentParams | undefined;

  private readonly customers = new Map<string, Customer>();
  private readonly methods = new Map<string, StoredPaymentMethod>();

  constructor(
    hooks: GatewayContext["hooks"],
    capabilities?: Partial<GatewayCapabilities>,
  ) {
    super(
      {},
      hooks,
      undefined,
      {
        payments: true,
        customers: true,
        paymentMethods: true,
        ...capabilities,
      },
    );
  }

  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    this.lastCreatePayment = params;
    return paidResult("vault_pay_1");
  }

  async capturePayment(
    _params: CaptureParams,
  ): Promise<GatewayPaymentResult> {
    return paidResult("vault_cap_1");
  }

  async refundPayment(
    _params: RefundParams,
  ): Promise<{
    success: true;
    gatewayRefundId: string;
    status: "completed";
    rawResponse: Record<string, never>;
  }> {
    return {
      success: true,
      gatewayRefundId: "vault_ref_1",
      status: "completed",
      rawResponse: {},
    };
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    return {
      id: "evt_vault",
      type: "payment_paid",
      gateway: this.name,
      paymentId: undefined,
      gatewayPaymentId: "vault_pay_1",
      status: "paid",
      timestamp: new Date(),
      rawPayload: payload,
    };
  }

  async createCustomer(
    params: CreateCustomerParams,
  ): Promise<CustomerOperationResult> {
    this.createCustomerCalls += 1;
    const id = `cus_${this.customers.size + 1}`;
    const customer: Customer = {
      status: "active",
      references: buildProviderReferences({
        gateway: this.name,
        gatewayId: id,
        status: "active",
        customerId: id,
      }),
      rawResponse: { provider: "vault", nativeId: id },
    };
    if (typeof params.email === "string") {
      customer.email = params.email;
    }
    if (typeof params.name === "string") {
      customer.name = params.name;
    }
    this.customers.set(id, customer);
    return { outcome: "succeeded", customer };
  }

  async getCustomer(params: {
    customerId: string;
  }): Promise<CustomerOperationResult> {
    const customer = this.customers.get(params.customerId);
    if (customer === undefined) {
      return {
        outcome: "failed",
        error: {
          name: "ResourceNotFoundError",
          code: "NOT_FOUND",
          message: "customer not found",
        },
      };
    }
    return { outcome: "succeeded", customer };
  }

  async attachPaymentMethod(
    params: AttachPaymentMethodParams,
  ): Promise<PaymentMethodOperationResult> {
    this.attachCalls += 1;
    const customerId = params.customerId;
    const id = params.paymentMethodId ?? `pm_${this.methods.size + 1}`;
    const paymentMethod: StoredPaymentMethod = {
      id,
      customerId,
      type: "card",
      last4: "4242",
      brand: "visa",
      references: buildProviderReferences({
        gateway: this.name,
        gatewayId: id,
        status: "active",
        customerId,
      }),
    };
    this.methods.set(id, paymentMethod);
    return { outcome: "succeeded", paymentMethod };
  }

  async listPaymentMethods(params: {
    customerId: string;
  }): Promise<ListPaymentMethodsResult> {
    return {
      outcome: "succeeded",
      paymentMethods: [...this.methods.values()].filter(
        (method) => method.customerId === params.customerId,
      ),
    };
  }

  async detachPaymentMethod(params: {
    paymentMethodId: string;
  }): Promise<PaymentMethodOperationResult> {
    const paymentMethod = this.methods.get(params.paymentMethodId);
    if (paymentMethod === undefined) {
      return {
        outcome: "failed",
        error: {
          name: "ResourceNotFoundError",
          code: "NOT_FOUND",
          message: "payment method not found",
        },
      };
    }
    this.methods.delete(params.paymentMethodId);
    return { outcome: "succeeded", paymentMethod };
  }
}

function vaultAdapter(
  capabilities?: Partial<GatewayCapabilities>,
): GatewayAdapter<"vault", VaultGateway> {
  return {
    name: "vault",
    manifest: { name: "vault", displayName: "Vault test gateway" },
    create(ctx: GatewayContext) {
      return new VaultGateway(ctx.hooks, capabilities);
    },
  };
}

function vaultClient(capabilities?: Partial<GatewayCapabilities>) {
  const client = createPaymentClient({
    gateways: { vault: vaultAdapter(capabilities) },
    defaultGateway: "vault",
  });
  return {
    client,
    payments: client,
    gateway: client.gateway("vault") as VaultGateway,
  };
}

async function expectUnsupported(
  run: () => Promise<unknown>,
  operation: string,
  capability: "customers" | "paymentMethods",
  gatewayName: string,
): Promise<void> {
  try {
    await run();
    expect.unreachable(`${operation} should throw`);
  } catch (error) {
    expect(error).toBeInstanceOf(OperationNotSupportedError);
    const err = error as OperationNotSupportedError;
    expect(err.capability).toBe(capability);
    expect(err.claimedSupport).toBe(false);
    expect(err.operation).toBe(operation);
    expect(err.gatewayName).toBe(gatewayName);
    expect(err.code).toBe("OPERATION_NOT_SUPPORTED");
  }
}

describe("Phase 22.1 customers and stored payment methods", () => {
  it("maps customer and payment-method operations onto capability keys", () => {
    expect(CAPABILITY_OPERATION_MAP.customers).toBe("createCustomer");
    expect(CAPABILITY_OPERATION_MAP.paymentMethods).toBe("attachPaymentMethod");
  });

  it("createCustomer throws OperationNotSupportedError when customers is unclaimed even if the method exists", async () => {
    const { client, gateway } = vaultClient({ customers: false });
    expect(gateway.supports("customers")).toBe(false);
    expect(typeof gateway.createCustomer).toBe("function");

    await expectUnsupported(
      () => client.createCustomer({ email: "buyer@example.com" }),
      "createCustomer",
      "customers",
      "vault",
    );
    expect(gateway.createCustomerCalls).toBe(0);
  });

  it("attach, list, and detach throw OperationNotSupportedError when paymentMethods is unclaimed", async () => {
    const { client, gateway } = vaultClient({ paymentMethods: false });
    expect(gateway.supports("paymentMethods")).toBe(false);
    expect(typeof gateway.attachPaymentMethod).toBe("function");

    await expectUnsupported(
      () =>
        client.attachPaymentMethod({
          customerId: "cus_1",
          paymentMethodId: "pm_1",
        }),
      "attachPaymentMethod",
      "paymentMethods",
      "vault",
    );
    await expectUnsupported(
      () => client.listPaymentMethods({ customerId: "cus_1" }),
      "listPaymentMethods",
      "paymentMethods",
      "vault",
    );
    await expectUnsupported(
      () => client.detachPaymentMethod({ paymentMethodId: "pm_1" }),
      "detachPaymentMethod",
      "paymentMethods",
      "vault",
    );
    expect(gateway.attachCalls).toBe(0);
  });

  it("createCustomer then getCustomer returns a succeeded snapshot with provider references", async () => {
    const { client } = vaultClient();

    const created = await client.createCustomer({
      email: "buyer@example.com",
      name: "Buyer",
      metadata: { userId: "u_1" },
      idempotencyKey: "cus_idem_1",
    });

    expect(created.outcome).toBe("succeeded");
    if (created.outcome !== "succeeded") {
      expect.unreachable("createCustomer must succeed on a claiming adapter");
    }
    expect(created.customer.status).toBe("active");
    expect(created.customer.email).toBe("buyer@example.com");
    expect(created.customer.name).toBe("Buyer");
    expect(created.customer.references.gateway).toBe("vault");
    expect(created.customer.references.providerObjectId).toMatch(/^cus_/);
    expect(created.customer.references.relatedIds?.customerId).toBe(
      created.customer.references.providerObjectId,
    );
    expect(created.customer.rawResponse).toMatchObject({ provider: "vault" });

    const fetched = await client.getCustomer({
      customerId: created.customer.references.providerObjectId,
    });
    expect(fetched).toEqual(created);
  });

  it("attach, list, and detach tokenized payment methods for a customer", async () => {
    const { client } = vaultClient();
    const created = await client.createCustomer({ email: "buyer@example.com" });
    if (created.outcome !== "succeeded") {
      expect.unreachable("createCustomer must succeed");
    }
    const customerId = created.customer.references.providerObjectId;

    const attached = await client.attachPaymentMethod({
      customerId,
      paymentMethodId: "pm_tokenized_1",
      idempotencyKey: "pm_idem_1",
    });
    expect(attached.outcome).toBe("succeeded");
    if (attached.outcome !== "succeeded") {
      expect.unreachable("attachPaymentMethod must succeed");
    }
    expect(attached.paymentMethod.id).toBe("pm_tokenized_1");
    expect(attached.paymentMethod.customerId).toBe(customerId);
    expect(attached.paymentMethod.last4).toBe("4242");
    expect(attached.paymentMethod.brand).toBe("visa");
    expect(attached.paymentMethod.references.providerObjectId).toBe(
      "pm_tokenized_1",
    );

    const listed = await client.listPaymentMethods({ customerId });
    expect(listed.outcome).toBe("succeeded");
    if (listed.outcome !== "succeeded") {
      expect.unreachable("listPaymentMethods must succeed");
    }
    expect(listed.paymentMethods).toHaveLength(1);
    expect(listed.paymentMethods[0]?.id).toBe("pm_tokenized_1");

    const detached = await client.detachPaymentMethod({
      paymentMethodId: "pm_tokenized_1",
      customerId,
    });
    expect(detached.outcome).toBe("succeeded");

    const after = await client.listPaymentMethods({ customerId });
    expect(after.outcome).toBe("succeeded");
    if (after.outcome !== "succeeded") {
      expect.unreachable("list after detach must succeed");
    }
    expect(after.paymentMethods).toEqual([]);
  });

  it.each([
    {
      label: "number+cvc",
      params: { email: "buyer@example.com", number: "4242424242424242", cvc: "123" },
    },
    {
      label: "pan",
      params: { email: "buyer@example.com", pan: "4242424242424242" },
    },
    {
      label: "nested card",
      params: {
        email: "buyer@example.com",
        card: { number: "4242424242424242", cvc: "123" },
      },
    },
    {
      label: "creditcard source",
      params: {
        email: "buyer@example.com",
        source: {
          type: "creditcard",
          number: "4242424242424242",
          cvc: "123",
        },
      },
    },
    {
      label: "metadata pan",
      params: {
        email: "buyer@example.com",
        metadata: { pan: "4242424242424242" },
      },
    },
    {
      label: "cvc only",
      params: { email: "buyer@example.com", cvc: "123" },
    },
    {
      label: "numeric number",
      params: { email: "buyer@example.com", number: 4242424242424 },
    },
  ])(
    "createCustomer rejects raw card material ($label) before the adapter runs",
    async ({ params }) => {
      const { client, gateway } = vaultClient();
      try {
        await client.createCustomer(params as CreateCustomerParams);
        expect.unreachable("raw card material must not create a customer");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRequestError);
        expect((error as InvalidRequestError).message.toLowerCase()).toMatch(
          /card|pan|cvc|pci/,
        );
      }
      expect(gateway.createCustomerCalls).toBe(0);
    },
  );

  it.each([
    { label: "number+cvc", extra: { number: "4242424242424242", cvc: "123" } },
    {
      label: "nested card",
      extra: { card: { number: "4242424242424242", cvc: "123" } },
    },
    { label: "token pan", extra: { token: "4242424242424242" } },
  ])(
    "attachPaymentMethod rejects raw card material ($label) before the adapter runs",
    async ({ extra }) => {
      const { client, gateway } = vaultClient();
      try {
        await client.attachPaymentMethod({
          customerId: "cus_1",
          ...extra,
        } as AttachPaymentMethodParams);
        expect.unreachable("raw card material must not attach");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRequestError);
      }
      expect(gateway.attachCalls).toBe(0);
    },
  );

  it("off-session createPayment forwards customerId and paymentMethodId to the adapter", async () => {
    const { payments, gateway } = vaultClient();
    const result = await payments.createPayment({
      amount: 10,
      currency: "SAR",
      callbackUrl: "https://merchant.example/callback",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      offSession: true,
    });

    expect(result.success).toBe(true);
    expect(gateway.lastCreatePayment).toMatchObject({
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      offSession: true,
    });
  });

  it("off-session createPayment without a stored payment method id throws InvalidRequestError", async () => {
    const { payments, gateway } = vaultClient();
    try {
      await payments.createPayment({
        amount: 10,
        currency: "SAR",
        callbackUrl: "https://merchant.example/callback",
        customerId: "cus_1",
        offSession: true,
      });
      expect.unreachable("off-session without a stored method must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as InvalidRequestError).message.toLowerCase()).toMatch(
        /payment method|off.?session/,
      );
    }
    expect(gateway.lastCreatePayment).toBeUndefined();
  });

  it("off-session createPayment accepts stripeCustomerId as the customer id", async () => {
    const { payments, gateway } = vaultClient();
    const result = await payments.createPayment({
      amount: 10,
      currency: "SAR",
      callbackUrl: "https://merchant.example/callback",
      stripeCustomerId: "cus_1",
      paymentMethodId: "pm_1",
      offSession: true,
    });

    expect(result.success).toBe(true);
    expect(gateway.lastCreatePayment).toMatchObject({
      stripeCustomerId: "cus_1",
      paymentMethodId: "pm_1",
      offSession: true,
    });
  });

  it.each([
    { label: "omitted", extra: {} },
    { label: "blank", extra: { customerId: "   " } },
  ])(
    "off-session createPayment without a customer id throws InvalidRequestError ($label)",
    async ({ extra }) => {
      const { payments, gateway } = vaultClient();
      try {
        await payments.createPayment({
          amount: 10,
          currency: "SAR",
          callbackUrl: "https://merchant.example/callback",
          paymentMethodId: "pm_1",
          offSession: true,
          ...extra,
        });
        expect.unreachable("off-session without a customer must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRequestError);
        expect((error as InvalidRequestError).message.toLowerCase()).toMatch(
          /customer|off.?session/,
        );
      }
      expect(gateway.lastCreatePayment).toBeUndefined();
    },
  );

  it("off-session createPayment with raw PAN is rejected before the adapter runs", async () => {
    const { payments, gateway } = vaultClient();
    try {
      await payments.createPayment({
        amount: 10,
        currency: "SAR",
        callbackUrl: "https://merchant.example/callback",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        offSession: true,
        number: "4242424242424242",
        cvc: "123",
      } as CreatePaymentParams);
      expect.unreachable("off-session raw PAN must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
    }
    expect(gateway.lastCreatePayment).toBeUndefined();
  });
});
