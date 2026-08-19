/**
 * BaseGateway post-submit indeterminate identity (CORE-7).
 */
import { describe, it, expect } from "bun:test";
import { BaseGateway } from "./base.gateway";
import { HooksManager } from "../hooks/hooks.manager";
import { NetworkError } from "../errors";
import type {
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "../types/payment.types";
import type { WebhookEvent } from "../types/webhook.types";

class TestGateway extends BaseGateway {
  readonly name = "test";
  failWith: Error | undefined;

  constructor() {
    super({}, new HooksManager(), undefined, {
      payments: true,
      immediateCapture: true,
      refunds: true,
      voids: true,
      hostedCheckout: true,
    });
  }

  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        gatewayId: "pay_ok",
        status: "paid",
        redirectUrl: undefined,
        rawResponse: {},
      };
    });
  }

  async capturePayment(
    params: CaptureParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        gatewayId: params.gatewayPaymentId,
        status: "paid",
        redirectUrl: undefined,
        rawResponse: {},
      };
    });
  }

  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        gatewayRefundId: "re_ok",
        status: "completed" as const,
        rawResponse: {},
      };
    });
  }

  async voidPayment(params: { gatewayPaymentId: string }): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        gatewayId: params.gatewayPaymentId,
        status: "cancelled",
        redirectUrl: undefined,
        rawResponse: {},
      };
    });
  }

  async confirmStcPayOtp(params: {
    transactionUrl: string;
    otpValue: string;
  }): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("confirmStcPayOtp", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        gatewayId: "pay_otp",
        status: "paid",
        redirectUrl: undefined,
        rawResponse: {},
      };
    });
  }

  async createCheckoutSession(params: {
    successUrl: string;
    amount?: number;
    currency?: string;
    idempotencyKey?: string;
  }): Promise<{
    success: boolean;
    sessionId: string;
    url?: string;
    rawResponse: unknown;
    outcome?: string;
    reconciliationRequired?: boolean;
  }> {
    return this.executeWithHooks("createCheckoutSession", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        sessionId: "cs_ok",
        url: "https://checkout.test/pay",
        rawResponse: {},
      };
    });
  }

  async getCheckoutSession(params: { sessionId: string }): Promise<{
    success: boolean;
    sessionId: string;
    paymentIntentId: string | undefined;
    url: string | null;
    status: string;
    paymentStatus: string;
    rawResponse: unknown;
  }> {
    return this.executeWithHooks("getCheckoutSession", params, async () => {
      if (this.failWith) throw this.failWith;
      return {
        success: true,
        sessionId: params.sessionId,
        paymentIntentId: undefined,
        url: null,
        status: "open",
        paymentStatus: "unpaid",
        rawResponse: {},
      };
    });
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhookEvent(): WebhookEvent {
    throw new Error("not used");
  }
}

function postSubmitTimeout(): NetworkError {
  return new NetworkError("timed out after 30000ms", undefined, {
    afterProviderSubmit: true,
  });
}

describe("BaseGateway CORE-7 post-submit identity", () => {
  const createBase = {
    amount: 10,
    currency: "USD",
    callbackUrl: "https://example.test/return",
  };

  it.each([
    {
      label: "create uses orderId when present",
      run: (gw: TestGateway) =>
        gw.createPayment({ ...createBase, orderId: "ord_123" }),
      gatewayId: "ord_123",
    },
    {
      label: "create prefers orderId over idempotencyKey",
      run: (gw: TestGateway) =>
        gw.createPayment({
          ...createBase,
          orderId: "ord_wins",
          idempotencyKey: "idem_ignored",
        }),
      gatewayId: "ord_wins",
    },
    {
      label: "create uses idempotencyKey when no order/payment id exists",
      run: (gw: TestGateway) =>
        gw.createPayment({
          ...createBase,
          idempotencyKey: "idem_moyasar_given_id",
        }),
      gatewayId: "idem_moyasar_given_id",
    },
    {
      label: "OTP uses transactionUrl",
      run: (gw: TestGateway) =>
        gw.confirmStcPayOtp({
          transactionUrl: "https://moyasar.test/otp/txn_99",
          otpValue: "1234",
        }),
      gatewayId: "https://moyasar.test/otp/txn_99",
    },
    {
      label: "create without identity stays unknown",
      run: (gw: TestGateway) => gw.createPayment(createBase),
      gatewayId: "unknown",
    },
    {
      label: "capture uses gatewayPaymentId",
      run: (gw: TestGateway) =>
        gw.capturePayment({ gatewayPaymentId: "pi_cap_1" }),
      gatewayId: "pi_cap_1",
    },
    {
      label: "void uses gatewayPaymentId",
      run: (gw: TestGateway) =>
        gw.voidPayment({ gatewayPaymentId: "pi_void_1" }),
      gatewayId: "pi_void_1",
    },
  ])("post-submit timeout $label", async ({ run, gatewayId }) => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await run(gw);
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayId).toBe(gatewayId);
    expect(result.reconciliationRequired).toBe(true);
  });

  it("refund post-submit timeout is indeterminate with gatewayRefundId", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.refundPayment({
      gatewayPaymentId: "pi_ref_1",
    });
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayRefundId).toBe("pi_ref_1");
    expect(result.reconciliationRequired).toBe(true);
  });

  it("pre-submit network error is not forged as indeterminate", async () => {
    const gw = new TestGateway();
    gw.failWith = new NetworkError("connect reset");
    await expect(gw.createPayment(createBase)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("S19-CKO-TIMEOUT: createCheckoutSession POST timeout is checkout-shaped indeterminate, not a retryable failed-create", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.createCheckoutSession({
      successUrl: "https://example.test/success",
      amount: 10,
      currency: "USD",
      idempotencyKey: "idem_cko_timeout",
    });
    expect(result.success).not.toBe(true);
    expect(result.outcome).toBe("indeterminate");
    expect(result.reconciliationRequired).toBe(true);
    expect(result.sessionId).toBe("idem_cko_timeout");
    expect(result).not.toEqual(
      expect.objectContaining({ status: "processing" }),
    );
    expect(result).not.toEqual(
      expect.objectContaining({ gatewayId: "idem_cko_timeout" }),
    );
  });

  it("S19-CKO-TIMEOUT: getCheckoutSession stays throwing on afterProviderSubmit NetworkError", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    await expect(
      gw.getCheckoutSession({ sessionId: "cs_get_timeout" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
