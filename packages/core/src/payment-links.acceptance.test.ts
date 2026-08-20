/**
 * Phase 22.5 acceptance — payment links capability gating.
 */
import { describe, it, expect } from "bun:test";
import {
  BaseGateway,
  InvalidRequestError,
  OperationNotSupportedError,
  buildProviderReferences,
  createPaymentClient,
  type CaptureParams,
  type CreatePaymentLinkParams,
  type CreatePaymentParams,
  type GatewayAdapter,
  type GatewayCapabilities,
  type GatewayContext,
  type GatewayPaymentResult,
  type PaymentLinkOperationResult,
  type RefundParams,
  type WebhookEvent,
} from "./index";

class LinkGateway extends BaseGateway {
  readonly name = "links";
  createCalls = 0;

  constructor(
    hooks: GatewayContext["hooks"],
    capabilities?: Partial<GatewayCapabilities>,
  ) {
    super({}, hooks, undefined, {
      payments: true,
      paymentLinks: true,
      ...capabilities,
    });
  }

  async createPayment(
    _params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return { success: true, gatewayId: "pay_1", status: "paid", rawResponse: {} };
  }
  async capturePayment(
    _params: CaptureParams,
  ): Promise<GatewayPaymentResult> {
    return { success: true, gatewayId: "pay_1", status: "paid", rawResponse: {} };
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
      gatewayRefundId: "ref_1",
      status: "completed",
      rawResponse: {},
    };
  }
  verifyWebhook(): boolean {
    return true;
  }
  parseWebhookEvent(payload: unknown): WebhookEvent {
    return {
      id: "evt_link",
      type: "payment_paid",
      gateway: this.name,
      paymentId: undefined,
      gatewayPaymentId: "pay_1",
      status: "paid",
      timestamp: new Date(),
      rawPayload: payload,
    };
  }

  async createPaymentLink(
    params: CreatePaymentLinkParams,
  ): Promise<PaymentLinkOperationResult> {
    this.createCalls += 1;
    const id = "plink_1";
    return {
      outcome: "succeeded",
      paymentLink: {
        status: "active",
        url: `https://links.test/${id}`,
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: id,
          status: "active",
        }),
      },
    };
  }

  async getPaymentLink(params: {
    paymentLinkId: string;
  }): Promise<PaymentLinkOperationResult> {
    return {
      outcome: "succeeded",
      paymentLink: {
        status: "active",
        url: `https://links.test/${params.paymentLinkId}`,
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: params.paymentLinkId,
          status: "active",
        }),
      },
    };
  }

  async deactivatePaymentLink(params: {
    paymentLinkId: string;
  }): Promise<PaymentLinkOperationResult> {
    return {
      outcome: "succeeded",
      paymentLink: {
        status: "inactive",
        url: `https://links.test/${params.paymentLinkId}`,
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: params.paymentLinkId,
          status: "inactive",
        }),
      },
    };
  }
}

function linkAdapter(
  capabilities?: Partial<GatewayCapabilities>,
): GatewayAdapter<"links", LinkGateway> {
  return {
    name: "links",
    manifest: { name: "links" },
    create(ctx: GatewayContext) {
      return new LinkGateway(ctx.hooks, capabilities);
    },
  };
}

describe("Phase 22.5 payment links", () => {
  it("createPaymentLink throws when paymentLinks is unclaimed", async () => {
    const client = createPaymentClient({
      gateways: { links: linkAdapter({ paymentLinks: false }) },
      defaultGateway: "links",
    });
    const gateway = client.gateway("links") as LinkGateway;
    await expect(
      client.createPaymentLink({ amount: 10, currency: "USD" }),
    ).rejects.toBeInstanceOf(OperationNotSupportedError);
    expect(gateway.createCalls).toBe(0);
  });

  it("create, get, and deactivate a payment link", async () => {
    const client = createPaymentClient({
      gateways: { links: linkAdapter() },
      defaultGateway: "links",
    });
    const created = await client.createPaymentLink({
      amount: 10,
      currency: "USD",
      description: "Invoice",
    });
    expect(created.outcome).toBe("succeeded");
    if (created.outcome !== "succeeded") {
      expect.unreachable("createPaymentLink must succeed");
    }
    expect(created.paymentLink.url).toContain("https://links.test/");
    expect(created.paymentLink.status).toBe("active");

    const fetched = await client.getPaymentLink({
      paymentLinkId: created.paymentLink.references.providerObjectId,
    });
    expect(fetched.outcome).toBe("succeeded");

    const deactivated = await client.deactivatePaymentLink({
      paymentLinkId: created.paymentLink.references.providerObjectId,
    });
    expect(deactivated.outcome).toBe("succeeded");
    if (deactivated.outcome !== "succeeded") {
      expect.unreachable("deactivate must succeed");
    }
    expect(deactivated.paymentLink.status).toBe("inactive");
  });

  it("createPaymentLink rejects raw card material before the adapter runs", async () => {
    const client = createPaymentClient({
      gateways: { links: linkAdapter() },
      defaultGateway: "links",
    });
    const gateway = client.gateway("links") as LinkGateway;
    await expect(
      client.createPaymentLink({
        amount: 10,
        currency: "USD",
        number: "4242424242424242",
        cvc: "123",
      } as CreatePaymentLinkParams),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(gateway.createCalls).toBe(0);
  });
});
