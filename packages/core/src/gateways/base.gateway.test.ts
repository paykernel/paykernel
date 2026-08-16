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
  it("create timeout uses orderId when present", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.createPayment({
      amount: 10,
      currency: "USD",
      callbackUrl: "https://example.test/return",
      orderId: "ord_123",
    });
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayId).toBe("ord_123");
    expect(result.reconciliationRequired).toBe(true);
  });

  it("create timeout uses idempotencyKey when no order/payment id exists", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.createPayment({
      amount: 10,
      currency: "USD",
      callbackUrl: "https://example.test/return",
      idempotencyKey: "idem_moyasar_given_id",
    });
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayId).toBe("idem_moyasar_given_id");
  });

  it("OTP timeout uses transactionUrl", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.confirmStcPayOtp({
      transactionUrl: "https://moyasar.test/otp/txn_99",
      otpValue: "1234",
    });
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayId).toBe("https://moyasar.test/otp/txn_99");
  });

  it("create timeout without any identity stays gatewayId unknown", async () => {
    const gw = new TestGateway();
    gw.failWith = postSubmitTimeout();
    const result = await gw.createPayment({
      amount: 10,
      currency: "USD",
      callbackUrl: "https://example.test/return",
    });
    expect(result.outcome).toBe("indeterminate");
    expect(result.gatewayId).toBe("unknown");
  });
});
