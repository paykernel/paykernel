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

function createGateway(
  queue: Response[],
  calls: FetchCall[],
  config: { merchantId?: string; autoVoidHours?: number } = {},
): TapGateway {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected Tap fetch: ${String(input)}`);
    return next;
  }) as typeof fetch;
  return new TapGateway(
    {
      secretKey: TAP_TEST_SECRET,
      webhookUrl: "https://merchant.example/post",
      ...config,
    },
    new HooksManager({}),
    undefined,
    { fetch: fetchImpl, randomUUID: () => "minted-idem-key" },
  );
}

const createParams = {
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/callback",
  tapCustomer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
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
    expect(body.customer).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
    });
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

  it("does not treat merchant redirect.url as checkout redirect on CAPTURED charges", async () => {
    const gateway = createGateway([jsonResponse(capturedCharge())], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.redirectUrl).toBeUndefined();
    expect(result.nextAction).toBeUndefined();
  });

  it("does not treat leftover transaction.url as nextAction on CAPTURED charges", async () => {
    const gateway = createGateway(
      [
        jsonResponse(
          capturedCharge({
            transaction: {
              created: "1000000000",
              url: "https://checkout.payments.tap.company/receipt",
            },
          }),
        ),
      ],
      [],
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.redirectUrl).toBeUndefined();
    expect(result.nextAction).toBeUndefined();
  });

  it("does not treat merchant redirect.url as checkout redirect on AUTHORIZED authorize", async () => {
    const gateway = createGateway(
      [
        jsonResponse(
          authorizedObject({
            redirect: { url: "https://merchant.example/callback" },
          }),
        ),
      ],
      [],
    );
    const result = await gateway.createPayment({
      ...createParams,
      capture: false,
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.status).toBe("authorized");
    expect(result.redirectUrl).toBeUndefined();
  });

  it("posts /authorize when capture is false", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(authorizedObject())], calls);
    const result = await gateway.createPayment({ ...createParams, capture: false });
    expect(calls[0]?.url).toContain("/authorize");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      source: { id: string };
      auto?: unknown;
    };
    expect(body.source.id).toBe("src_card");
    expect(body.auto).toBeUndefined();
    expect(result.status).toBe("authorized");
    expect(result.outcome).toBe("succeeded");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("sends auto VOID hours on authorize when autoVoidHours is set", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(authorizedObject())], calls, {
      autoVoidHours: 24,
    });
    await gateway.createPayment({ ...createParams, capture: false });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      auto?: { type: string; time: number };
    };
    expect(body.auto).toEqual({ type: "VOID", time: 24 });
  });

  it("does not send auto on charges even when autoVoidHours is set", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(capturedCharge())], calls, {
      autoVoidHours: 24,
    });
    await gateway.createPayment({ ...createParams });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { auto?: unknown };
    expect(body.auto).toBeUndefined();
  });

  it("rejects auth_ tapSource on createPayment and does not fetch", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    try {
      await gateway.createPayment({
        ...createParams,
        tapSource: { id: "auth_testAuthorize01" },
      });
      expect.unreachable("createPayment must reject auth_ sources");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as Error).message).toMatch(/capturePayment/);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects zero create amounts before fetch", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(
      gateway.createPayment({
        ...createParams,
        amount: money(0, "SAR", { allowZero: true }),
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });

  it("maps DECLINED to declined outcome", async () => {
    const gateway = createGateway([jsonResponse(declinedCharge())], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("declined");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("rejects inline customer with blank lastName", async () => {
    const gateway = createGateway([], []);
    await expect(
      gateway.createPayment({
        amount: 10,
        currency: "SAR",
        callbackUrl: "https://merchant.example/callback",
        tapCustomer: { firstName: "Ada", lastName: "  ", email: "ada@example.com" },
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
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
      }),
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
      { merchantId: "merchant_test01" },
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
      threeDSecure?: boolean;
      customer_initiated?: boolean;
      redirect?: { url?: string };
      post?: { url?: string };
      merchant?: { id?: string };
    };
    expect(body.source.id).toBe("auth_testAuthorize01");
    expect(body.amount).toBe(10.5);
    expect(body.threeDSecure).toBe(true);
    expect(body.customer_initiated).toBe(true);
    expect(body.redirect?.url).toBe("https://merchant.example/callback");
    expect(body.post?.url).toBe("https://merchant.example/post");
    expect(body.merchant?.id).toBe("merchant_test01");
    expect(result.outcome).toBe("succeeded");
  });

  it("prefers tapRedirectUrl over authorize.redirect.url on capture", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject()), jsonResponse(capturedCharge())],
      calls,
    );
    await gateway.capturePayment({
      gatewayPaymentId: "auth_testAuthorize01",
      amount: money("10.50", "SAR"),
      currency: "SAR",
      idempotencyKey: "idem-cap-redirect",
      tapRedirectUrl: "https://merchant.example/capture-return",
    });
    const body = JSON.parse(String(calls[1]?.init?.body)) as {
      redirect?: { url?: string };
    };
    expect(body.redirect?.url).toBe("https://merchant.example/capture-return");
  });

  it("rejects capture when authorize has no redirect.url and tapRedirectUrl is omitted", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject({ redirect: {} }))],
      calls,
    );
    await expect(
      gateway.capturePayment({
        gatewayPaymentId: "auth_testAuthorize01",
        idempotencyKey: "idem-cap-noredirect",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(calls.some((call) => call.url.includes("/charges"))).toBe(false);
  });

  it("rejects capture when the authorize status is VOID", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject({ status: "VOID" }))],
      calls,
    );
    try {
      await gateway.capturePayment({
        gatewayPaymentId: "auth_testAuthorize01",
        idempotencyKey: "idem-cap-void",
      });
      expect.unreachable("capture of VOID authorize must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as Error).message).toMatch(/authorize status/i);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/authorize/auth_testAuthorize01");
    expect(calls.some((call) => call.url.includes("/charges"))).toBe(false);
  });

  it("replays capture via POST /charges when GET authorize is CAPTURED", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [
        jsonResponse(authorizedObject({ status: "CAPTURED" })),
        jsonResponse(capturedCharge()),
      ],
      calls,
    );
    const result = await gateway.capturePayment({
      gatewayPaymentId: "auth_testAuthorize01",
      amount: money("10.50", "SAR"),
      currency: "SAR",
      idempotencyKey: "idem-cap-replay",
    });
    expect(calls[1]?.url).toContain("/charges");
    expect(result.outcome).toBe("succeeded");
    expect(result.status).toBe("paid");
  });

  it("rejects capture when the authorize status is INITIATED", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject({ status: "INITIATED" }))],
      calls,
    );
    try {
      await gateway.capturePayment({
        gatewayPaymentId: "auth_testAuthorize01",
        idempotencyKey: "idem-cap-initiated",
      });
      expect.unreachable("capture of INITIATED authorize must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      expect((error as Error).message).toMatch(/authorize status/i);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/authorize/auth_testAuthorize01");
    expect(calls.some((call) => call.url.includes("/charges"))).toBe(false);
  });

  it("rejects capture when the authorize object omits status", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(authorizedObject({ status: undefined }))],
      calls,
    );
    await expect(
      gateway.capturePayment({
        gatewayPaymentId: "auth_testAuthorize01",
        idempotencyKey: "idem-cap-nostatus",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(calls.some((call) => call.url.includes("/charges"))).toBe(false);
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
    expect(result.outcome).toBe("succeeded");
    expect(result.success).toBe(true);
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
      post?: { url?: string };
    };
    expect(body.charge_id).toBe("chg_testInitiated01");
    expect(body.reason).toBe("requested_by_customer");
    expect(body.post?.url).toBe("https://merchant.example/post");
    expect(result.status).toBe("completed");
    expect(result.outcome).toBe("succeeded");
    expect(result.totalRefunded).toBeUndefined();
  });

  it("sends a free-text refund reason instead of requested_by_customer", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(capturedCharge()), jsonResponse(refundedObject())],
      calls,
    );
    await gateway.refundPayment({
      gatewayPaymentId: "chg_testInitiated01",
      amount: money("10.50", "SAR"),
      currency: "SAR",
      idempotencyKey: "idem-ref-stock",
      reason: "The product is out of stock",
    });
    const body = JSON.parse(String(calls[1]?.init?.body)) as { reason: string };
    expect(body.reason).toBe("The product is out of stock");
  });

  it("maps known refund reasons case-insensitively with spaces to underscore", async () => {
    for (const [reason, expected] of [
      ["duplicate", "duplicate"],
      ["Fraudulent", "fraudulent"],
      ["requested by customer", "requested_by_customer"],
    ] as const) {
      const calls: FetchCall[] = [];
      const gateway = createGateway(
        [jsonResponse(capturedCharge()), jsonResponse(refundedObject())],
        calls,
      );
      await gateway.refundPayment({
        gatewayPaymentId: "chg_testInitiated01",
        amount: money("10.50", "SAR"),
        currency: "SAR",
        idempotencyKey: `idem-ref-${expected}`,
        reason,
      });
      const body = JSON.parse(String(calls[1]?.init?.body)) as { reason: string };
      expect(body.reason).toBe(expected);
    }
  });

  it("does not retry void after a mutating 5xx", async () => {
    const calls: FetchCall[] = [];
    const boom = { errors: [{ code: "9999", description: "boom" }] };
    const gateway = createGateway([jsonResponse(boom, 500)], calls);
    const result = await gateway.voidPayment({
      gatewayPaymentId: "auth_testAuthorize01",
      idempotencyKey: "idem-void-500",
    });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(calls).toHaveLength(1);
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
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(boom, 500), jsonResponse(boom, 500), jsonResponse(boom, 500)],
      calls,
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
    expect(calls).toHaveLength(3);
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

  it("does not treat metadata.udf1 as paymentId", () => {
    const gateway = createGateway([], []);
    const event = gateway.parseWebhookEvent(
      capturedCharge({
        metadata: { udf1: "test_data_1" },
        reference: { order: "ord_01", payment: "payref1" },
      }),
    );
    expect(event.paymentId).toBe("ord_01");
    expect(event.paymentId).not.toBe("test_data_1");
  });

  it("prefers metadata.paymentId over orderId and reference.order", () => {
    const gateway = createGateway([], []);
    const event = gateway.parseWebhookEvent(
      capturedCharge({
        metadata: {
          paymentId: "pay_meta",
          orderId: "ord_meta",
          udf1: "test_data_1",
        },
        reference: { order: "ord_01", payment: "payref1" },
      }),
    );
    expect(event.paymentId).toBe("pay_meta");
  });
});
