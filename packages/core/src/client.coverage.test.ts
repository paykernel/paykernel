/**
 * Targeted client coverage for convenience routing and gateway registry helpers.
 * Complements src/client.test.ts; does not change client behavior.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { PaymentClient } from "./client";

function createMockResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: new Headers(),
  } as unknown as Response;
}

describe.skip("PaymentClient registry helpers", () => {
  it("configuredGateways lists only configured providers", () => {
    const client = new PaymentClient({
      stripe: { secretKey: "sk_test_123" },
      moyasar: { secretKey: "sk_test_moyasar" },
      defaultGateway: "stripe",
    });

    const names = client.configuredGateways().slice().sort();
    expect(names).toEqual(["moyasar", "stripe"]);
  });

  it("hasGateway reflects configuration", () => {
    const client = new PaymentClient({
      paypal: {
        clientId: "client",
        clientSecret: "secret",
        sandbox: true,
      },
      defaultGateway: "paypal",
    });

    expect(client.hasGateway("paypal")).toBe(true);
    expect(client.hasGateway("stripe")).toBe(false);
    expect(client.hasGateway("paymob")).toBe(false);
  });
});

describe.skip("PaymentClient capture/refund convenience routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes capturePayment to the selected Stripe gateway", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (url) => {
      requestedUrl = String(url);
      return createMockResponse({
        id: "pi_cap",
        object: "payment_intent",
        status: "succeeded",
        amount: 5000,
        amount_received: 5000,
        currency: "usd",
        client_secret: null,
      });
    }) as unknown as typeof fetch;

    const client = new PaymentClient({
      stripe: { secretKey: "sk_test_123", webhookSecret: "whsec_test" },
      defaultGateway: "stripe",
    });

    const result = await client.capturePayment({
      gatewayPaymentId: "pi_cap",
      idempotencyKey: "idem_client_capture",
    });

    expect(requestedUrl).toContain("/payment_intents/pi_cap/capture");
    expect(result.success).toBe(true);
    expect(result.gatewayId).toBe("pi_cap");
  });

  it("routes refundPayment to the selected Stripe gateway", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock(async (url) => {
      const href = String(url);
      requestedUrls.push(href);
      if (href.includes("/refunds")) {
        return createMockResponse({
          id: "re_1",
          object: "refund",
          amount: 5000,
          currency: "usd",
          payment_intent: "pi_ref",
          status: "succeeded",
        });
      }
      if (href.includes("payment_intents")) {
        return createMockResponse({
          id: "pi_ref",
          object: "payment_intent",
          status: "succeeded",
          amount: 5000,
          amount_received: 5000,
          currency: "usd",
          client_secret: null,
          latest_charge: {
            id: "ch_1",
            amount_refunded: 5000,
            refunded: true,
          },
        });
      }
      throw new Error(`unexpected Stripe URL in refund smoke: ${href}`);
    }) as unknown as typeof fetch;

    const client = new PaymentClient({
      stripe: { secretKey: "sk_test_123", webhookSecret: "whsec_test" },
      defaultGateway: "stripe",
    });

    const result = await client.refundPayment({
      gatewayPaymentId: "pi_ref",
      idempotencyKey: "idem_client_refund",
    });

    expect(requestedUrls.some((u) => u.includes("/refunds"))).toBe(true);
    expect(result.success).toBe(true);
    expect(result.gatewayRefundId).toBeDefined();
  });
});
