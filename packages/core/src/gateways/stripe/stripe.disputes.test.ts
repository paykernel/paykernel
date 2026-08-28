/**
 * Stripe Phase 22.3 — disputes HTTP + mapping. Offline mocked fetch.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { StripeGateway } from "./stripe.gateway";
import { HooksManager } from "../../hooks/hooks.manager";
import type { StripeConfig } from "../../types/config.types";
import { InvalidRequestError, money, NetworkError } from "../../index";

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

describe("StripeGateway disputes", () => {
  let gateway: StripeGateway;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    gateway = new StripeGateway(STRIPE_TEST_CONFIG, new HooksManager({}));
    globalThis.fetch = originalFetch;
  });

  it("getDispute GETs /v1/disputes/:id and maps deadline + dashboard URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url) => {
      capturedUrl = String(url);
      return createMockResponse({
        id: "dp_123",
        object: "dispute",
        amount: 1000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        charge: "ch_123",
        payment_intent: "pi_123",
        livemode: false,
        evidence_details: { due_by: 1782000000 },
      });
    }) as unknown as typeof fetch;

    const result = await gateway.getDispute({ disputeId: "dp_123" });
    expect(capturedUrl).toBe("https://api.stripe.com/v1/disputes/dp_123");
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getDispute must succeed");
    }
    expect(result.dispute.status).toBe("needs_response");
    expect(result.dispute.reason).toBe("fraudulent");
    expect(result.dispute.amount).toEqual(money("10.00", "USD"));
    expect(result.dispute.currency).toBe("USD");
    expect(result.dispute.evidenceDueBy).toBe(
      new Date(1782000000 * 1000).toISOString(),
    );
    expect(result.dispute.dashboardUrl).toBe(
      "https://dashboard.stripe.com/test/payments/ch_123",
    );
    expect(result.dispute.references.relatedIds?.chargeId).toBe("ch_123");
    expect(result.dispute.references.relatedIds?.paymentIntentId).toBe("pi_123");
  });

  it.each([
    {
      native: "warning_needs_response",
      expected: "warning_needs_response",
      providerStatus: "warning_needs_response",
    },
    {
      native: "prevented",
      expected: "warning_closed",
      providerStatus: "prevented",
    },
  ])(
    "getDispute maps $native to $expected",
    async ({ native, expected, providerStatus }) => {
      globalThis.fetch = mock(async () =>
        createMockResponse({
          id: "dp_map",
          object: "dispute",
          status: native,
          currency: "usd",
          amount: 500,
        }),
      ) as unknown as typeof fetch;
      const result = await gateway.getDispute({ disputeId: "dp_map" });
      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") {
        expect.unreachable("getDispute must succeed");
      }
      expect(result.dispute.status).toBe(expected);
      expect(result.dispute.providerStatus).toBe(providerStatus);
    },
  );

  it("P22R3-DSP-INVENT: GET body without status is not needs_response", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        id: "dp_nostatus",
        object: "dispute",
        currency: "usd",
        amount: 1000,
      }),
    ) as unknown as typeof fetch;

    const result = await gateway.getDispute({ disputeId: "dp_nostatus" });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("getDispute must succeed");
    }
    expect(result.dispute.status).toBe("unknown");
    expect(result.dispute.status).not.toBe("needs_response");
    expect(result.dispute.providerStatus).toBeUndefined();
  });

  it("P22-GET-FLAG-2: GET 200 dispute body without id is not afterProviderSubmit", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        object: "dispute",
        status: "needs_response",
        currency: "usd",
        amount: 1000,
      }),
    ) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await gateway.getDispute({ disputeId: "dp_noid" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NetworkError);
    if (!(thrown instanceof NetworkError)) {
      expect.unreachable("GET missing id must throw NetworkError");
    }
    expect(thrown.afterProviderSubmit).not.toBe(true);
  });

  it("listDisputes requires a pi_ or ch_ bound", async () => {
    await expect(gateway.listDisputes({})).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it.each([
    { paymentId: "pi_abc", query: "payment_intent=pi_abc" },
    { paymentId: "ch_abc", query: "charge=ch_abc" },
  ])("listDisputes binds $paymentId as $query", async ({ paymentId, query }) => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url) => {
      capturedUrl = String(url);
      return createMockResponse({ data: [] });
    }) as unknown as typeof fetch;
    const result = await gateway.listDisputes({ paymentId });
    expect(capturedUrl).toContain("/disputes?");
    expect(capturedUrl).toContain(query);
    expect(capturedUrl).toContain("limit=100");
    expect(result.outcome).toBe("succeeded");
  });

  it("P22R3-LIST-DSP: listDisputes pages while has_more is true", async () => {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url) => {
      urls.push(String(url));
      if (String(url).includes("starting_after=dp_1")) {
        return createMockResponse({
          object: "list",
          data: [
            {
              id: "dp_2",
              object: "dispute",
              status: "under_review",
              currency: "usd",
              amount: 500,
            },
          ],
          has_more: false,
        });
      }
      return createMockResponse({
        object: "list",
        data: [
          {
            id: "dp_1",
            object: "dispute",
            status: "needs_response",
            currency: "usd",
            amount: 1000,
          },
        ],
        has_more: true,
      });
    }) as unknown as typeof fetch;

    const result = await gateway.listDisputes({ paymentId: "pi_abc" });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/disputes?");
    expect(urls[0]).toContain("payment_intent=pi_abc");
    expect(urls[0]).toContain("limit=100");
    expect(urls[0]).not.toContain("starting_after");
    expect(urls[1]).toContain("limit=100");
    expect(urls[1]).toContain("starting_after=dp_1");
    expect(urls[1]).toContain("payment_intent=pi_abc");
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") {
      expect.unreachable("paged list must succeed");
    }
    expect(result.disputes.map((d) => d.references.providerObjectId)).toEqual([
      "dp_1",
      "dp_2",
    ]);
  });

  it("P22R3-LIST-DSP: has_more without a last id throws NetworkError", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse({
        object: "list",
        data: [{ object: "dispute", status: "needs_response" }],
        has_more: true,
      }),
    ) as unknown as typeof fetch;

    await expect(
      gateway.listDisputes({ paymentId: "pi_abc" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("P22R3-LIST-404: listDisputes 404 is failed", async () => {
    globalThis.fetch = mock(async () =>
      createMockResponse(
        {
          error: {
            message: "No such payment_intent: pi_missing",
            type: "invalid_request_error",
          },
        },
        false,
        404,
      ),
    ) as unknown as typeof fetch;

    const result = await gateway.listDisputes({ paymentId: "pi_missing" });
    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") {
      expect.unreachable("404 must be failed");
    }
    expect(result.error.code).toBe("GATEWAY_API_ERROR");
    expect(result).not.toEqual(expect.objectContaining({ disputes: [] }));
  });

  it("submitDisputeEvidence requires a caller idempotencyKey", async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(async () => {
      fetchCalls += 1;
      return createMockResponse({ id: "dp_123" });
    }) as unknown as typeof fetch;
    await expect(
      gateway.submitDisputeEvidence({
        disputeId: "dp_123",
        evidence: { uncategorizedText: "receipt attached" },
      }),
    ).rejects.toThrow(/idempotencyKey/i);
    expect(fetchCalls).toBe(0);
  });

  it("submitDisputeEvidence POSTs common fields and stripeEvidence", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    globalThis.fetch = mock(async (url, opts: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(opts.body ?? "");
      return createMockResponse({
        id: "dp_123",
        object: "dispute",
        status: "under_review",
        currency: "usd",
        amount: 1000,
      });
    }) as unknown as typeof fetch;

    const result = await gateway.submitDisputeEvidence({
      disputeId: "dp_123",
      evidence: {
        uncategorizedText: "receipt attached",
        stripeEvidence: { receipt: "file_123" },
      },
      idempotencyKey: "idem_ev_1",
    });
    expect(capturedUrl).toBe("https://api.stripe.com/v1/disputes/dp_123");
    const body = new URLSearchParams(capturedBody);
    expect(body.get("submit")).toBe("true");
    expect(body.get("evidence[uncategorized_text]")).toBe("receipt attached");
    expect(body.get("evidence[receipt]")).toBe("file_123");
    expect(result.outcome).toBe("succeeded");
  });

  it("P22R3-EVIDENCE-EMPTY: empty evidence {} does not fetch", async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(async () => {
      fetchCalls += 1;
      return createMockResponse({ id: "dp_123" });
    }) as unknown as typeof fetch;

    await expect(
      gateway.submitDisputeEvidence({
        disputeId: "dp_123",
        evidence: {},
        idempotencyKey: "idem_ev_empty",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchCalls).toBe(0);
  });

  it("rejects malformed dispute ids before fetch", async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(async () => {
      fetchCalls += 1;
      return createMockResponse({});
    }) as unknown as typeof fetch;
    await expect(
      gateway.getDispute({ disputeId: "not_a_dispute" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchCalls).toBe(0);
  });
});
