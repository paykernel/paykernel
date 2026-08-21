import { describe, expect, it } from "bun:test";
import {
  HooksManager,
  InvalidRequestError,
  isIndeterminateOutcome,
  isPaidOutcome,
  money,
  NetworkError,
} from "@paykernel/core";
import { TapGateway } from "./gateway";
import {
  authorizedObject,
  capturedCharge,
  declinedCharge,
  initiatedCharge,
  refundedObject,
  TAP_TEST_SECRET,
} from "./fixtures/charges";
import { computeTapHashstring, hashFieldsFromTapObject } from "./webhooks";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function emptyResponse(status = 200): Response {
  return new Response("", { status });
}

function queued(response: Response, copies: number): Response[] {
  return Array.from({ length: copies }, () => response.clone());
}

function createGateway(queue: Response[], calls: FetchCall[]): TapGateway {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected Tap fetch: ${String(input)}`);
    return next;
  }) as typeof fetch;
  return new TapGateway(
    { secretKey: TAP_TEST_SECRET, webhookUrl: "https://merchant.example/post" },
    new HooksManager({}),
    undefined,
    { fetch: fetchImpl, randomUUID: () => "minted-idem-key" },
  );
}

const createParams = {
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/callback",
  tapCustomer: { firstName: "Ada", email: "ada@example.com" },
  idempotencyKey: "idem-create-1",
} as const;

describe("TapGateway.createPayment", () => {
  it("posts a charge with ISO major amount, customer, src_all, and idempotent reference", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(capturedCharge())], calls);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.status).toBe("paid");
    expect(result.outcome).toBe("succeeded");
    expect(result.gatewayId).toBe("chg_testInitiated01");
    expect(calls[0]?.url).toContain("/charges");
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.amount).toBe(10.5);
    expect(body.currency).toBe("SAR");
    expect(body.source).toEqual({ id: "src_all" });
    expect(body.redirect).toEqual({ url: "https://merchant.example/callback" });
    expect((body.reference as { idempotent: string }).idempotent).toBe(
      "idem-create-1",
    );
    expect(body.post).toEqual({ url: "https://merchant.example/post" });
    expect(String(calls[0]?.init?.headers?.Authorization ?? "")).toMatch(
      /^Bearer sk_test_/,
    );
  });

  it("maps INITIATED + transaction.url to requires_action", async () => {
    const gateway = createGateway([jsonResponse(initiatedCharge())], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("requires_action");
    expect(result.status).toBe("pending");
    expect(result.redirectUrl).toContain("checkout.payments.tap.company");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("posts /authorize when capture is false", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(authorizedObject())], calls);
    const result = await gateway.createPayment({ ...createParams, capture: false });
    expect(calls[0]?.url).toContain("/authorize");
    expect(result.status).toBe("authorized");
    expect(result.outcome).toBe("succeeded");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("maps DECLINED to declined outcome", async () => {
    const gateway = createGateway([jsonResponse(declinedCharge())], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("declined");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("requires customer and callbackUrl", async () => {
    const gateway = createGateway([], []);
    await expect(
      gateway.createPayment({
        amount: 10,
        currency: "SAR",
        callbackUrl: "https://merchant.example/callback",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      gateway.createPayment({
        amount: 10,
        currency: "SAR",
        callbackUrl: "",
        tapCustomer: { id: "cus_testCustomer01" },
      } as never),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("mints an ephemeral idempotency key when the caller omits one", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(capturedCharge())], calls);
    const { idempotencyKey: _omit, ...rest } = createParams;
    await gateway.createPayment({ ...rest });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      reference: { idempotent: string };
    };
    expect(body.reference.idempotent).toBe("minted-idem-key");
  });
});

describe("TapGateway mutations", () => {
  it("requires idempotencyKey on capture / void / refund", async () => {
    const gateway = createGateway([], []);
    await expect(
      gateway.capturePayment({ gatewayPaymentId: "auth_testAuthorize01" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      gateway.voidPayment({ gatewayPaymentId: "auth_testAuthorize01" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      gateway.refundPayment({ gatewayPaymentId: "chg_testInitiated01" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("captures an authorize via POST /charges with source.id = auth id", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject()), jsonResponse(capturedCharge())],
      calls,
    );
    const result = await gateway.capturePayment({
      gatewayPaymentId: "auth_testAuthorize01",
      amount: money("10.50", "SAR"),
      currency: "SAR",
      idempotencyKey: "idem-cap-1",
    });
    expect(calls[0]?.url).toContain("/authorize/auth_testAuthorize01");
    expect(calls[1]?.url).toContain("/charges");
    const body = JSON.parse(String(calls[1]?.init?.body)) as {
      source: { id: string };
      amount: number;
    };
    expect(body.source.id).toBe("auth_testAuthorize01");
    expect(body.amount).toBe(10.5);
    expect(result.outcome).toBe("succeeded");
  });

  it("voids an authorize", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject({ status: "VOID" }))],
      calls,
    );
    const result = await gateway.voidPayment({
      gatewayPaymentId: "auth_testAuthorize01",
      idempotencyKey: "idem-void-1",
    });
    expect(calls[0]?.url).toContain("/authorize/auth_testAuthorize01/void");
    expect(result.status).toBe("cancelled");
  });

  it("refunds a charge", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(capturedCharge()), jsonResponse(refundedObject())],
      calls,
    );
    const result = await gateway.refundPayment({
      gatewayPaymentId: "chg_testInitiated01",
      amount: money("10.50", "SAR"),
      currency: "SAR",
      idempotencyKey: "idem-ref-1",
    });
    expect(calls[1]?.url).toContain("/refunds");
    const body = JSON.parse(String(calls[1]?.init?.body)) as {
      charge_id: string;
      reason: string;
    };
    expect(body.charge_id).toBe("chg_testInitiated01");
    expect(body.reason).toBe("requested_by_customer");
    expect(result.status).toBe("completed");
    expect(result.outcome).toBe("succeeded");
  });

  it("rejects capture of a charge id and refund of an authorize id", async () => {
    const gateway = createGateway([], []);
    await expect(
      gateway.capturePayment({
        gatewayPaymentId: "chg_testInitiated01",
        idempotencyKey: "k",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      gateway.refundPayment({
        gatewayPaymentId: "auth_testAuthorize01",
        idempotencyKey: "k",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });
});

describe("TapGateway.getPayment and errors", () => {
  it("dispatches chg_ vs auth_ and rejects unknown prefixes", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(capturedCharge()), jsonResponse(authorizedObject())],
      calls,
    );
    await gateway.getPayment({ gatewayPaymentId: "chg_testInitiated01" });
    expect(calls[0]?.url).toContain("/charges/chg_testInitiated01");
    const auth = await gateway.getPayment({
      gatewayPaymentId: "auth_testAuthorize01",
    });
    expect(calls[1]?.url).toContain("/authorize/auth_testAuthorize01");
    expect(auth.status).toBe("authorized");
    await expect(
      gateway.getPayment({ gatewayPaymentId: "pay_other" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("maps post-submit 5xx on create to indeterminate", async () => {
    const boom = { errors: [{ code: "9999", description: "boom" }] };
    const gateway = createGateway(
      [jsonResponse(boom, 500), jsonResponse(boom, 500), jsonResponse(boom, 500)],
      [],
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
  });

  it("maps empty mutating 2xx to indeterminate, not InvalidRequestError", async () => {
    const gateway = createGateway(queued(emptyResponse(), 3), []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
  });

  it("maps mutating HTML 5xx to indeterminate after retries", async () => {
    const gateway = createGateway(
      queued(textResponse("<html>upstream</html>", 500), 3),
      [],
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
  });

  it("GET empty 2xx is a thrown NetworkError, not afterProviderSubmit", async () => {
    const gateway = createGateway(queued(emptyResponse(), 3), []);
    try {
      await gateway.getPayment({ gatewayPaymentId: "chg_testInitiated01" });
      expect.unreachable("empty GET body must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).afterProviderSubmit).not.toBe(true);
    }
  });

  it("maps 401 to AuthenticationError via getPayment (GET throws)", async () => {
    const gateway = createGateway(
      [jsonResponse({ errors: [{ code: "2104", description: "bad key" }] }, 401)],
      [],
    );
    await expect(
      gateway.getPayment({ gatewayPaymentId: "chg_testInitiated01" }),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });
});

describe("TapGateway webhooks", () => {
  it("verifies hashstring and dual-writes a paid event", () => {
    const gateway = createGateway([], []);
    const payload = capturedCharge({ amount: 10.5 });
    const signature = computeTapHashstring(
      hashFieldsFromTapObject(payload),
      TAP_TEST_SECRET,
    );
    expect(gateway.verifyWebhook(payload, signature)).toBe(true);
    expect(gateway.verifyWebhook(payload)).toBe(false);
    const event = gateway.parseWebhookEvent(payload);
    expect(event.gateway).toBe("tap");
    expect(event.status).toBe("paid");
    expect(event.stableType).toBe("payment.succeeded");
    expect(event.payloadHash).toBeDefined();
    expect(event.timestamp.toISOString()).toBe(
      new Date(1_000_000_000 * 1000).toISOString(),
    );
  });

  it("parses 13-digit created values as milliseconds", () => {
    const gateway = createGateway([], []);
    const createdMs = 1_698_392_719_404;
    const event = gateway.parseWebhookEvent(
      capturedCharge({ transaction: { created: createdMs } }),
    );
    expect(event.timestamp.toISOString()).toBe(new Date(createdMs).toISOString());
  });

  it("rejects webhook payloads without a created timestamp", () => {
    const gateway = createGateway([], []);
    expect(() =>
      gateway.parseWebhookEvent(
        capturedCharge({ transaction: { url: "https://checkout.example" } }),
      ),
    ).toThrow(InvalidRequestError);
  });

  it("parses authorize and refund webhooks", () => {
    const gateway = createGateway([], []);
    const auth = gateway.parseWebhookEvent(authorizedObject());
    expect(auth.status).toBe("authorized");
    const refund = gateway.parseWebhookEvent(refundedObject());
    expect(refund.status).toBe("refunded");
    expect(refund.gatewayPaymentId).toBe("chg_testCaptured01");
  });

  it("rejects invoice objects at parse time", () => {
    const gateway = createGateway([], []);
    expect(() =>
      gateway.parseWebhookEvent({ object: "invoice", id: "inv_1", status: "PAID" }),
    ).toThrow(InvalidRequestError);
  });
});
