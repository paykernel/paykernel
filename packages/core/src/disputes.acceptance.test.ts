/**
 * Phase 22.3 acceptance — disputes capability gating + typed results.
 */
import { describe, it, expect } from "bun:test";
import {
  BaseGateway,
  InvalidRequestError,
  OperationNotSupportedError,
  buildProviderReferences,
  createPaymentClient,
  webhookEventToPaymentEvent,
  type CaptureParams,
  type CreatePaymentParams,
  type DisputeOperationResult,
  type GatewayAdapter,
  type GatewayCapabilities,
  type GatewayContext,
  type GatewayPaymentResult,
  type GetDisputeParams,
  type ListDisputesParams,
  type ListDisputesResult,
  type RefundParams,
  type SubmitDisputeEvidenceParams,
  type WebhookEvent,
} from "./index";

class DisputeGateway extends BaseGateway {
  readonly name = "dsp";
  submitCalls = 0;

  constructor(
    hooks: GatewayContext["hooks"],
    capabilities?: Partial<GatewayCapabilities>,
  ) {
    super({}, hooks, undefined, {
      payments: true,
      disputes: true,
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
      id: "evt_dsp",
      type: "payment_paid",
      gateway: this.name,
      paymentId: undefined,
      gatewayPaymentId: "pay_1",
      status: "paid",
      timestamp: new Date(),
      rawPayload: payload,
    };
  }

  async getDispute(
    params: GetDisputeParams,
  ): Promise<DisputeOperationResult> {
    return {
      outcome: "succeeded",
      dispute: {
        status: "needs_response",
        evidenceDueBy: "2026-08-21T00:00:00.000Z",
        dashboardUrl: "https://dashboard.example/disputes/dp_1",
        references: buildProviderReferences({
          gateway: this.name,
          gatewayId: params.disputeId,
          status: "needs_response",
        }),
      },
    };
  }

  async listDisputes(
    _params: ListDisputesParams,
  ): Promise<ListDisputesResult> {
    return { outcome: "succeeded", disputes: [] };
  }

  async submitDisputeEvidence(
    params: SubmitDisputeEvidenceParams,
  ): Promise<DisputeOperationResult> {
    this.submitCalls += 1;
    return this.getDispute({ disputeId: params.disputeId });
  }
}

function disputeAdapter(
  capabilities?: Partial<GatewayCapabilities>,
): GatewayAdapter<"dsp", DisputeGateway> {
  return {
    name: "dsp",
    manifest: { name: "dsp" },
    create(ctx: GatewayContext) {
      return new DisputeGateway(ctx.hooks, capabilities);
    },
  };
}

describe("Phase 22.3 disputes", () => {
  it("getDispute throws when disputes is unclaimed", async () => {
    const client = createPaymentClient({
      gateways: { dsp: disputeAdapter({ disputes: false }) },
      defaultGateway: "dsp",
    });
    await expect(
      client.getDispute({ disputeId: "dp_1" }),
    ).rejects.toBeInstanceOf(OperationNotSupportedError);
  });

  it("getDispute returns deadline and dashboard URL", async () => {
    const client = createPaymentClient({
      gateways: { dsp: disputeAdapter() },
      defaultGateway: "dsp",
    });
    const result = await client.getDispute({ disputeId: "dp_1" });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getDispute must succeed");
    }
    expect(result.dispute.evidenceDueBy).toBe("2026-08-21T00:00:00.000Z");
    expect(result.dispute.dashboardUrl).toContain("/disputes/dp_1");
  });

  it("enriches dispute.opened from a Stripe dispute raw payload", () => {
    const event = webhookEventToPaymentEvent({
      id: "evt_1",
      type: "charge.dispute.created",
      gateway: "stripe",
      paymentId: undefined,
      gatewayPaymentId: "pi_1",
      gatewayObjectId: "dp_1",
      status: "needs_response",
      timestamp: new Date(),
      livemode: false,
      rawPayload: {
        id: "evt_1",
        type: "charge.dispute.created",
        data: {
          object: {
            id: "dp_1",
            object: "dispute",
            status: "needs_response",
            reason: "fraudulent",
            charge: "ch_1",
            payment_intent: "pi_1",
            livemode: false,
            evidence_details: { due_by: 1782000000 },
          },
        },
      },
    });
    expect(event.type).toBe("dispute.opened");
    if (event.type !== "dispute.opened") {
      expect.unreachable("must be dispute.opened");
    }
    expect(event.dispute.status).toBe("needs_response");
    expect(event.dispute.reason).toBe("fraudulent");
    expect(event.dispute.evidenceDueBy).toBeDefined();
    expect(event.dispute.dashboardUrl).toContain("/test/payments/ch_1");
    expect(event.dispute.references.providerObjectId).toBe("dp_1");
  });

  it("submitDisputeEvidence rejects PAN-like uncategorizedText before the adapter runs", async () => {
    const client = createPaymentClient({
      gateways: { dsp: disputeAdapter() },
      defaultGateway: "dsp",
    });
    const gateway = client.gateway("dsp") as DisputeGateway;
    try {
      await client.submitDisputeEvidence({
        disputeId: "dp_1",
        evidence: { uncategorizedText: "4242424242424242" },
      });
      expect.unreachable("uncategorizedText PAN must not submit");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
    }
    expect(gateway.submitCalls).toBe(0);
  });

  it("submitDisputeEvidence rejects PAN-like stripeEvidence values before the adapter runs", async () => {
    const client = createPaymentClient({
      gateways: { dsp: disputeAdapter() },
      defaultGateway: "dsp",
    });
    const gateway = client.gateway("dsp") as DisputeGateway;
    try {
      await client.submitDisputeEvidence({
        disputeId: "dp_1",
        evidence: {
          stripeEvidence: { uncategorized_text: "4242424242424242" },
        },
      });
      expect.unreachable("stripeEvidence PAN must not submit");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
    }
    expect(gateway.submitCalls).toBe(0);
  });

  it("submitDisputeEvidence accepts tokenized file ids", async () => {
    const client = createPaymentClient({
      gateways: { dsp: disputeAdapter() },
      defaultGateway: "dsp",
    });
    const gateway = client.gateway("dsp") as DisputeGateway;
    const result = await client.submitDisputeEvidence({
      disputeId: "dp_1",
      evidence: {
        uncategorizedText: "customer emailed support",
        stripeEvidence: { receipt: "file_1", uncategorized_file: "file_2" },
      },
    });
    expect(result.outcome).toBe("succeeded");
    expect(gateway.submitCalls).toBe(1);
  });
});
