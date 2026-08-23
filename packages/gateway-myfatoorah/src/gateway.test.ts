import { describe, expect, it } from "bun:test";
import {
  HooksManager,
  InvalidRequestError,
  isIndeterminateOutcome,
  isPaidOutcome,
  money,
  NetworkError,
  OperationNotSupportedError,
} from "@paykernel/core";
import { MyFatoorahGateway } from "./gateway";
import {
  MYFATOORAH_TEST_API_TOKEN,
  initiatedCreateData,
  myfatoorahEnvelope,
  paidCreateData,
  paidInvoiceStatusData,
  partialRefundStatusData,
  makeRefundData,
  paymentWebhook,
} from "./fixtures/webhooks";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createGateway(
  queue: Response[],
  calls: FetchCall[],
  config: { webhookUrl?: string; defaultPaymentMethod?: string; timeoutMs?: number } = {},
): MyFatoorahGateway {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected MyFatoorah fetch: ${String(input)}`);
    return next;
  }) as typeof fetch;
  return new MyFatoorahGateway(
    {
      apiToken: MYFATOORAH_TEST_API_TOKEN,
      country: "KWT",
      ...config,
    },
    new HooksManager({}),
    undefined,
    { fetch: fetchImpl },
  );
}

const createParams = {
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/callback",
  idempotencyKey: "idem-create-1",
} as const;

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

describe("MyFatoorahGateway.createPayment", () => {
  it("posts V3 with Idempotency-Key, ISO Order.Amount, and Redirection", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(initiatedCreateData()))], calls);
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("requires_action");
    expect(result.status).toBe("pending");
    expect(result.gatewayId).toBe("915102");
    expect(result.redirectUrl).toBe(initiatedCreateData().PaymentURL);
    expect(calls[0]?.url).toBe("https://apitest.myfatoorah.com/v3/payments");
    expect(String(calls[0]?.init?.headers?.["Idempotency-Key"] ?? "")).toBe("idem-create-1");
    expect(String(calls[0]?.init?.headers?.Authorization ?? "")).toBe(
      `Bearer ${MYFATOORAH_TEST_API_TOKEN}`,
    );
    const rawBody = String(calls[0]?.init?.body);
    expect(rawBody).toContain('"Amount":10.50');
    expect(rawBody).not.toContain('"Amount":"10.50"');
    const body = bodyOf(calls[0]);
    expect(body.Order).toEqual({ Amount: 10.5, Currency: "SAR" });
    expect(body.IntegrationUrls).toEqual({
      Redirection: "https://merchant.example/callback",
    });
    expect(body.PaymentMethod).toBeUndefined();
    expect(body.OperationType).toBeUndefined();
    expect(body.SaveCardOptions).toBeUndefined();
  });

  it("sends config webhookUrl and PaymentMethod / language / customer", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(myfatoorahEnvelope(initiatedCreateData()))],
      calls,
      { webhookUrl: "https://merchant.example/webhook", defaultPaymentMethod: "KNET" },
    );
    await gateway.createPayment({
      ...createParams,
      myfatoorahCustomer: { name: "Ada Lovelace", email: "ada@example.com" },
      myfatoorahLanguage: "EN",
      orderId: "ord_01",
    });
    const body = bodyOf(calls[0]);
    expect(body.PaymentMethod).toBe("KNET");
    expect(body.Language).toBe("EN");
    expect(body.Order).toEqual({
      Amount: 10.5,
      Currency: "SAR",
      ExternalIdentifier: "ord_01",
    });
    expect(body.IntegrationUrls).toEqual({
      Redirection: "https://merchant.example/callback",
      Webhook: "https://merchant.example/webhook",
    });
    expect(body.Customer).toEqual({
      Name: "Ada Lovelace",
      Email: "ada@example.com",
    });
  });

  it("maps PaymentCompleted + paid evidence to succeeded / paid without redirect", async () => {
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(paidCreateData()))], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.outcome).toBe("succeeded");
    expect(result.status).toBe("paid");
    expect(result.redirectUrl).toBeUndefined();
    expect(result.nextAction).toBeUndefined();
    expect(result.amount).toBe(10.5);
    expect(result.currency).toBe("SAR");
  });

  it("returns indeterminate when a mutating 2xx has no InvoiceId", async () => {
    const gateway = createGateway(
      [jsonResponse(myfatoorahEnvelope({ PaymentURL: "https://pay.example" }))],
      [],
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(result.outcome).toBe("indeterminate");
  });

  it("returns indeterminate when a mutating 2xx has neither PaymentURL nor paid evidence", async () => {
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope({ InvoiceId: 915102 }))], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isIndeterminateOutcome(result)).toBe(true);
  });

  it("rejects capture: false with the authorization capability, no fetch", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(gateway.createPayment({ ...createParams, capture: false })).rejects.toThrow(
      OperationNotSupportedError,
    );
    expect(calls.length).toBe(0);
  });

  it("rejects missing idempotencyKey without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(
      gateway.createPayment({ ...createParams, idempotencyKey: undefined }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.length).toBe(0);
  });

  it("rejects a non-HTTPS callbackUrl without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(
      gateway.createPayment({
        ...createParams,
        callbackUrl: "http://merchant.example/callback",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.length).toBe(0);
  });

  it("rejects raw PCI card sources without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(
      gateway.createPayment({
        ...createParams,
        myfatoorahCard: { Number: "4111111111111111" },
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.length).toBe(0);
  });

  it("rejects both myfatoorahSessionId and myfatoorahToken without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(
      gateway.createPayment({
        ...createParams,
        myfatoorahSessionId: "sess-1",
        myfatoorahToken: "tok-1",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.length).toBe(0);
  });

  it("sends SourceOfFund.Token for myfatoorahToken", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(initiatedCreateData()))], calls);
    await gateway.createPayment({ ...createParams, myfatoorahToken: "tok-1" });
    expect(bodyOf(calls[0]).SourceOfFund).toEqual({ Token: "tok-1" });
  });

  it("accepts UDF1..UDF5 string metadata and rejects other keys", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(initiatedCreateData()))], calls);
    await gateway.createPayment({
      ...createParams,
      metadata: { UDF1: "one", UDF5: "five" },
    });
    expect(bodyOf(calls[0]).MetaData).toEqual({ UDF1: "one", UDF5: "five" });
    await expect(
      gateway.createPayment({ ...createParams, metadata: { orderId: "x" } }),
    ).rejects.toThrow(InvalidRequestError);
  });
});

describe("MyFatoorahGateway.getPayment", () => {
  it("POSTs GetPaymentStatus with the InvoiceId key", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData()))],
      calls,
    );
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(calls[0]?.url).toBe("https://apitest.myfatoorah.com/v2/GetPaymentStatus");
    expect(bodyOf(calls[0])).toEqual({ Key: "915102", KeyType: "InvoiceId" });
    expect(result.gatewayId).toBe("915102");
    expect(result.status).toBe("paid");
    expect(result.amount).toBe(10.5);
    expect(result.currency).toBe("SAR");
    expect(result.references?.relatedIds?.paymentId).toBe("07076409988323998875");
  });

  it("keeps a pending invoice pending even when the latest transaction failed", async () => {
    const data = paidInvoiceStatusData();
    data.InvoiceStatus = "Pending";
    data.Transactions = [
      {
        TransactionStatus: "FAILED",
        TransactionId: "t1",
        Currency: "SAR",
      },
    ];
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("pending");
    expect(result.outcome).toBe("requires_action");
  });

  it("maps a paid invoice without a success transaction as paid", async () => {
    const data = paidInvoiceStatusData();
    data.Transactions = [{ TransactionStatus: "FAILED", Currency: "SAR" }];
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("paid");
    expect(result.amount).toBeUndefined();
  });

  it("maps canceled invoices to cancelled / failed outcome", async () => {
    const data = paidInvoiceStatusData();
    data.InvoiceStatus = "Canceled";
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("cancelled");
    expect(result.outcome).toBe("failed");
  });

  it("rejects non-digit gatewayPaymentId without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(gateway.getPayment({ gatewayPaymentId: "abc" })).rejects.toThrow(
      InvalidRequestError,
    );
    expect(calls.length).toBe(0);
  });
});

describe("MyFatoorahGateway.refundPayment", () => {
  function refundQueue() {
    const calls: FetchCall[] = [];
    const queue = [
      jsonResponse(myfatoorahEnvelope(partialRefundStatusData())),
      jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData())),
      jsonResponse(myfatoorahEnvelope(makeRefundData())),
    ];
    return { calls, queue };
  }

  it("posts MakeRefund with ServiceChargeOnCustomer false and ExternalIdentifier", async () => {
    const { calls, queue } = refundQueue();
    const gateway = createGateway(queue, calls);
    const result = await gateway.refundPayment({
      gatewayPaymentId: "915102",
      idempotencyKey: "refund-idem-2",
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://apitest.myfatoorah.com/v2/GetRefundStatus",
      "https://apitest.myfatoorah.com/v2/GetPaymentStatus",
      "https://apitest.myfatoorah.com/v2/MakeRefund",
    ]);
    const body = bodyOf(calls[2]);
    expect(body.KeyType).toBe("InvoiceId");
    expect(body.Key).toBe("915102");
    expect(body.ServiceChargeOnCustomer).toBe(false);
    expect(body.ExternalIdentifier).toBe("refund-idem-2");
    expect(String(calls[2]?.init?.headers?.["Idempotency-Key"] ?? "")).toBe("refund-idem-2");
    expect(body.Amount).toBe(8); // 10.5 − 2.5 already refunded
    // pending — never completed from MakeRefund acceptance
    expect(result.status).toBe("pending");
    expect(result.outcome).toBe("pending");
    expect(result.gatewayRefundId).toBe("22202");
  });

  it("uses the caller amount when provided and under remaining", async () => {
    const { calls, queue } = refundQueue();
    const gateway = createGateway(queue, calls);
    await gateway.refundPayment({
      gatewayPaymentId: "915102",
      idempotencyKey: "refund-idem-2",
      amount: money("3.00", "SAR"),
      currency: "SAR",
    });
    const body = bodyOf(calls[2]);
    expect(String(calls[2]?.init?.body)).toContain('"Amount":3.00');
    expect(body.Amount).toBe(3);
  });

  it("rejects a caller amount over remaining without MakeRefund", async () => {
    const { calls, queue } = refundQueue();
    queue.pop(); // drop the MakeRefund response — it must not be reached
    const gateway = createGateway(queue, calls);
    await expect(
      gateway.refundPayment({
        gatewayPaymentId: "915102",
        idempotencyKey: "refund-idem-2",
        amount: money("9.00", "SAR"),
        currency: "SAR",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("throws for a currency mismatch without MakeRefund", async () => {
    const { calls, queue } = refundQueue();
    queue.pop();
    const gateway = createGateway(queue, calls);
    await expect(
      gateway.refundPayment({
        gatewayPaymentId: "915102",
        idempotencyKey: "refund-idem-2",
        amount: money("3.00", "USD"),
        currency: "USD",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("replays a fully refunded invoice from the nested refund when keyed", async () => {
    const refundStatus = partialRefundStatusData();
    refundStatus.Refunds = [
      {
        RefundId: 22201,
        ExternalIdentifier: "refund-idem-2",
        Comment: null,
        InvoiceId: 915102,
        Amount: 10.5,
        ServiceChargeOnCustomer: 0,
        RefundStatus: "Refunded",
      },
    ];
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [
        jsonResponse(myfatoorahEnvelope(refundStatus)),
        jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData())),
      ],
      calls,
    );
    const result = await gateway.refundPayment({
      gatewayPaymentId: "915102",
      idempotencyKey: "refund-idem-2",
    });
    expect(result.gatewayRefundId).toBe("22201");
    expect(result.status).toBe("completed");
    expect(result.outcome).toBe("succeeded");
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("throws for a fully refunded invoice with no matching nested refund", async () => {
    const refundStatus = partialRefundStatusData();
    refundStatus.Refunds = [
      {
        RefundId: 22201,
        ExternalIdentifier: "refund-idem-1",
        Comment: null,
        InvoiceId: 915102,
        Amount: 10.5,
        ServiceChargeOnCustomer: 0,
        RefundStatus: "Refunded",
      },
    ];
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [
        jsonResponse(myfatoorahEnvelope(refundStatus)),
        jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData())),
      ],
      calls,
    );
    await expect(
      gateway.refundPayment({
        gatewayPaymentId: "915102",
        idempotencyKey: "refund-idem-2",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("returns indeterminate when MakeRefund 2xx is missing RefundId", async () => {
    const { queue } = refundQueue();
    queue[2] = jsonResponse(myfatoorahEnvelope({}));
    const gateway = createGateway(queue, []);
    const result = await gateway.refundPayment({
      gatewayPaymentId: "915102",
      idempotencyKey: "refund-idem-2",
    });
    expect(result.outcome).toBe("indeterminate");
  });

  it("rejects missing idempotencyKey without fetching", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(gateway.refundPayment({ gatewayPaymentId: "915102" })).rejects.toThrow(
      InvalidRequestError,
    );
    expect(calls.length).toBe(0);
  });
});

describe("MyFatoorahGateway.capturePayment / webhooks", () => {
  it("capturePayment throws OperationNotSupportedError with the authorization capability", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(gateway.capturePayment({ gatewayPaymentId: "915102" })).rejects.toThrow(
      OperationNotSupportedError,
    );
    expect(calls.length).toBe(0);
  });

  it("parses a payment webhook into a paid event with related paymentId", () => {
    const gateway = createGateway([], []);
    const event = gateway.parseWebhookEvent(paymentWebhook());
    expect(event.gateway).toBe("myfatoorah");
    expect(event.gatewayPaymentId).toBe("6409988");
    expect(event.paymentId).toBe("asdqwd-f13sdf-fasjkz");
    expect(event.status).toBe("paid");
    expect(event.stableType).toBe("payment.succeeded");
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(
      (event.event as { payment?: { references?: { relatedIds?: Record<string, unknown> } } })
        ?.payment?.references?.relatedIds?.paymentId,
    ).toBe("07076409988323998875");
  });
});
