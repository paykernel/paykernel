/**
 * Phase 22.2 acceptance — hosted checkout typed contracts.
 *
 * No live provider calls.
 */
import { describe, it, expect } from "bun:test";
import {
  BaseGateway,
  OperationNotSupportedError,
  buildProviderReferences,
  createPaymentClient,
  isHostedCheckoutRedirect,
  type CaptureParams,
  type CheckoutSessionOperationResult,
  type CommonCheckoutSessionInput,
  type CreatePaymentParams,
  type GatewayAdapter,
  type GatewayCapabilities,
  type GatewayContext,
  type GatewayPaymentResult,
  type GetCheckoutSessionParams,
  type RefundParams,
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

class HostedGateway extends BaseGateway {
  readonly name = "hosted";
  createCalls = 0;

  constructor(
    hooks: GatewayContext["hooks"],
    capabilities?: Partial<GatewayCapabilities>,
  ) {
    super({}, hooks, undefined, {
      payments: true,
      hostedCheckout: true,
      ...capabilities,
    });
  }

  async createPayment(
    _params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return paidResult("hosted_pay_1");
  }

  async capturePayment(
    _params: CaptureParams,
  ): Promise<GatewayPaymentResult> {
    return paidResult("hosted_cap_1");
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
      gatewayRefundId: "hosted_ref_1",
      status: "completed",
      rawResponse: {},
    };
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    return {
      id: "evt_hosted",
      type: "payment_paid",
      gateway: this.name,
      paymentId: undefined,
      gatewayPaymentId: "hosted_pay_1",
      status: "paid",
      timestamp: new Date(),
      rawPayload: payload,
    };
  }

  async createCheckoutSession(
    params: CommonCheckoutSessionInput,
  ): Promise<CheckoutSessionOperationResult> {
    this.createCalls += 1;
    const id = "cs_hosted_1";
    return {
      outcome: "succeeded",
      session: {
        status: "open",
        url: `https://hosted.test/checkout/${id}`,
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: id,
          status: "open",
        }),
      },
    };
  }

  async getCheckoutSession(
    params: GetCheckoutSessionParams,
  ): Promise<CheckoutSessionOperationResult> {
    return {
      outcome: "succeeded",
      session: {
        status: "open",
        url: `https://hosted.test/checkout/${params.sessionId}`,
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: params.sessionId,
          status: "open",
        }),
      },
    };
  }
}

function hostedAdapter(
  capabilities?: Partial<GatewayCapabilities>,
): GatewayAdapter<"hosted", HostedGateway> {
  return {
    name: "hosted",
    manifest: { name: "hosted", displayName: "Hosted test gateway" },
    create(ctx: GatewayContext) {
      return new HostedGateway(ctx.hooks, capabilities);
    },
  };
}

describe("Phase 22.2 hosted checkout", () => {
  it("createCheckoutSession throws when hostedCheckout is unclaimed even if the method exists", async () => {
    const client = createPaymentClient({
      gateways: { hosted: hostedAdapter({ hostedCheckout: false }) },
      defaultGateway: "hosted",
    });
    const gateway = client.gateway("hosted") as HostedGateway;
    expect(typeof gateway.createCheckoutSession).toBe("function");
    try {
      await client.createCheckoutSession({
        successUrl: "https://merchant.example/success",
      });
      expect.unreachable("unclaimed hostedCheckout must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OperationNotSupportedError);
      expect((error as OperationNotSupportedError).capability).toBe(
        "hostedCheckout",
      );
    }
    expect(gateway.createCalls).toBe(0);
  });

  it("create then get returns a succeeded session with a redirect URL", async () => {
    const client = createPaymentClient({
      gateways: { hosted: hostedAdapter() },
      defaultGateway: "hosted",
    });
    const created = await client.createCheckoutSession({
      successUrl: "https://merchant.example/success",
      amount: 10,
      currency: "USD",
    });
    expect(created.outcome).toBe("succeeded");
    if (created.outcome !== "succeeded") {
      expect.unreachable("createCheckoutSession must succeed");
    }
    // Create success is a hosted redirect, not paid settlement.
    expect(isHostedCheckoutRedirect(created)).toBe(true);
    expect(created.session.status).toBe("open");
    expect(created.session.paymentStatus).not.toBe("paid");
    expect((created as { success?: unknown }).success).not.toBe(true);
    expect("success" in created).toBe(false);
    expect(created.session.references.providerObjectId).toMatch(/^cs_/);
    expect(created.session.url).toContain("https://hosted.test/checkout/");

    const fetched = await client.getCheckoutSession({
      sessionId: created.session.references.providerObjectId,
    });
    expect(fetched.outcome).toBe("succeeded");
  });
});
