/**
 * Stripe Phase 22.5 — Payment Links HTTP. Offline mocked fetch.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { StripeGateway } from "./stripe.gateway";
import { HooksManager } from "../../hooks/hooks.manager";
import type { StripeConfig } from "../../types/config.types";
import { money, NetworkError } from "../../index";

const STRIPE_TEST_CONFIG: StripeConfig = {
  secretKey: "sk_test_123",
  publishableKey: "pk_test_123",
  webhookSecret: "whsec_test_123",
};

function createMockResponse(data: unknown, ok = true, status = 200): Response {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => text,
    headers: new Headers(),
  } as unknown as Response;
}

describe("StripeGateway payment links", () => {
  let gateway: StripeGateway;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    gateway = new StripeGateway(STRIPE_TEST_CONFIG, new HooksManager({}));
    globalThis.fetch = originalFetch;
  });

  it("createPaymentLink POSTs /v1/payment_links", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedKey = "";
    globalThis.fetch = mock(async (url, opts: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(opts.body ?? "");
      capturedKey = new Headers(opts.headers).get("Idempotency-Key") ?? "";
      return createMockResponse({
        id: "plink_123",
        object: "payment_link",
        url: "https://buy.stripe.com/test_123",
        active: true,
      });
    }) as unknown as typeof fetch;

    const result = await gateway.createPaymentLink({
      amount: money("10.00", "USD"),
      currency: "USD",
      description: "Invoice 42",
      idempotencyKey: "idem_plink_1",
    });

    expect(capturedUrl).toBe("https://api.stripe.com/v1/payment_links");
    expect(capturedKey).toBe("idem_plink_1");
    const body = new URLSearchParams(capturedBody);
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1000");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe(
      "Invoice 42",
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("createPaymentLink must succeed");
    }
    expect(result.paymentLink.status).toBe("active");
    expect(result.paymentLink.references.providerNativeStatus).toBe("true");
    expect(result.paymentLink.url).toBe("https://buy.stripe.com/test_123");
    expect(result.paymentLink.references.providerObjectId).toBe("plink_123");
    expect(result.paymentLink.amount).toBe(10);
    expect(result.paymentLink.currency).toBe("USD");
  });

  it.each([
    {
      label: "missing amount",
      params: { idempotencyKey: "idem_x" },
      message: /amount and currency/i,
    },
    {
      label: "missing idempotencyKey",
      params: { amount: 10, currency: "USD" },
      message: /idempotencyKey/i,
    },
  ])("createPaymentLink rejects $label", async ({ params, message }) => {
    await expect(gateway.createPaymentLink(params)).rejects.toThrow(message);
  });

  it("getPaymentLink GETs /v1/payment_links/:id", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url) => {
      capturedUrl = String(url);
      return createMockResponse({
        id: "plink_abc",
        url: "https://buy.stripe.com/abc",
        active: true,
      });
    }) as unknown as typeof fetch;
    const result = await gateway.getPaymentLink({ paymentLinkId: "plink_abc" });
    expect(capturedUrl).toContain("/payment_links/plink_abc");
    expect(capturedUrl).toContain("expand[]=line_items");
    expect(result.outcome).toBe("succeeded");
  });

  it("getPaymentLink 200 body without url throws NetworkError that is not afterProviderSubmit", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "plink_no_url",
        active: true,
      }),
    ) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await gateway.getPaymentLink({ paymentLinkId: "plink_no_url" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NetworkError);
    if (!(thrown instanceof NetworkError)) {
      expect.unreachable("missing url must throw NetworkError");
    }
    expect(thrown.afterProviderSubmit).not.toBe(true);
  });

  it("getPaymentLink expanded single line item publishes amount and currency", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url) => {
      capturedUrl = String(url);
      return createMockResponse({
        id: "plink_priced",
        url: "https://buy.stripe.com/priced",
        active: true,
        line_items: {
          object: "list",
          data: [
            {
              amount_total: 2500,
              currency: "usd",
              quantity: 1,
              price: { unit_amount: 2500, currency: "usd" },
            },
          ],
          has_more: false,
        },
      });
    }) as unknown as typeof fetch;

    const result = await gateway.getPaymentLink({
      paymentLinkId: "plink_priced",
    });
    expect(capturedUrl).toContain("expand[]=line_items");
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getPaymentLink must succeed");
    }
    expect(result.paymentLink.amount).toBe(25);
    expect(result.paymentLink.currency).toBe("USD");
    expect(result.paymentLink.references.providerNativeStatus).toBe("true");
  });

  it("getPaymentLink quantity !== 1 omits amount", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "plink_qty",
        url: "https://buy.stripe.com/qty",
        active: true,
        line_items: {
          object: "list",
          data: [
            {
              amount_total: 5000,
              currency: "usd",
              quantity: 2,
              price: { unit_amount: 2500, currency: "usd" },
            },
          ],
          has_more: false,
        },
      }),
    ) as unknown as typeof fetch;

    const result = await gateway.getPaymentLink({
      paymentLinkId: "plink_qty",
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getPaymentLink must succeed");
    }
    expect(result.paymentLink.amount).toBeUndefined();
    expect(result.paymentLink.currency).toBeUndefined();
  });

  it("getPaymentLink without line items omits amount", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "plink_nolines",
        url: "https://buy.stripe.com/nolines",
        active: true,
      }),
    ) as unknown as typeof fetch;

    const result = await gateway.getPaymentLink({
      paymentLinkId: "plink_nolines",
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getPaymentLink must succeed");
    }
    expect(result.paymentLink.amount).toBeUndefined();
    expect(result.paymentLink.amount).not.toBe(0);
    expect(result.paymentLink.currency).toBeUndefined();
  });

  it("P22R3-URL-SCHEME: javascript: payment link url is omitted", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "plink_js",
        url: "javascript:alert(1)",
        active: true,
      }),
    ) as unknown as typeof fetch;

    const result = await gateway.getPaymentLink({ paymentLinkId: "plink_js" });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getPaymentLink must succeed");
    }
    expect(result.paymentLink.url).toBeUndefined();
  });

  it("deactivatePaymentLink sets active=false", async () => {
    let capturedBody = "";
    globalThis.fetch = mock(async (_url, opts: RequestInit) => {
      capturedBody = String(opts.body ?? "");
      return createMockResponse({
        id: "plink_abc",
        url: "https://buy.stripe.com/abc",
        active: false,
      });
    }) as unknown as typeof fetch;
    const result = await gateway.deactivatePaymentLink({
      paymentLinkId: "plink_abc",
      idempotencyKey: "idem_deact",
    });
    expect(new URLSearchParams(capturedBody).get("active")).toBe("false");
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.paymentLink.status).toBe("inactive");
      expect(result.paymentLink.references.providerNativeStatus).toBe("false");
    }
  });
});
