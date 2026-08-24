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
  refundWebhook,
} from "./fixtures/webhooks";
import type { MyFatoorahCountry } from "./config";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createGateway(
  queue: (Response | Error)[],
  calls: FetchCall[],
  config: {
    country?: MyFatoorahCountry;
    webhookUrl?: string;
    defaultPaymentMethod?: string;
    timeoutMs?: number;
  } = {},
): MyFatoorahGateway {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected MyFatoorah fetch: ${String(input)}`);
    if (next instanceof Error) throw next;
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
      Reference: "ord_01",
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

  it("maps legacy flat paid evidence (InvoiceStatus + TransactionDetails.Status) as paid", async () => {
    const legacy = paidCreateData({
      InvoiceStatus: "PAID",
      TransactionDetails: {
        Status: "SUCCESS",
        Amount: { ValueInBaseCurrency: 10.5, ValueInDisplayCurrency: 10.5 },
      },
    });
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(legacy))], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.status).toBe("paid");
    expect(result.amount).toBe(10.5);
  });

  it("retries post-submit network errors on create only for KWT/SAU", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [
        new TypeError("connect ECONNREFUSED"),
        new TypeError("connect ECONNREFUSED"),
        new TypeError("connect ECONNREFUSED"),
      ],
      calls,
      { country: "KWT" },
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("indeterminate");
    expect(calls.length).toBe(3);
  });

  it("does not retry post-submit network errors on create outside KWT/SAU", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([new TypeError("connect ECONNREFUSED")], calls, {
      country: "BHR",
    });
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("indeterminate");
    expect(calls.length).toBe(1);
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
  it("retries create once without Idempotency-Key on an idempotency validation error", async () => {
    const calls: FetchCall[] = [];
    // KWT honors Idempotency-Key, but provider may still return 2xx IsSuccess:false
    // with ValidationErrors as string body (e.g. FieldsErrors alias). Adapter retries once
    // without header; second request parses as success.
    const gateway = createGateway(
      [
        jsonResponse(
          {
            IsSuccess: false,
            Message: "",
            ValidationErrors: [{ Name: "Idempotency-Key", Error: "Header not supported" }],
          },
          200,
        ),
        jsonResponse(myfatoorahEnvelope(initiatedCreateData())),
      ],
      calls,
      { country: "KWT" },
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("requires_action");
    expect(calls.length).toBe(2);
    expect(String(calls[0]?.init?.headers?.["Idempotency-Key"] ?? "")).toBe("idem-create-1");
    expect(calls[1]?.init?.headers?.["Idempotency-Key"]).toBeUndefined();
  });
  it("retries create once without Idempotency-Key on a 400 ValidationErrors object body", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [
        jsonResponse(
          {
            IsSuccess: false,
            Message: "",
            ValidationErrors: [{ Name: "Idempotency-Key", Error: "Header not supported" }],
          },
          400,
        ),
        jsonResponse(myfatoorahEnvelope(initiatedCreateData())),
      ],
      calls,
      { country: "KWT" },
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("requires_action");
    expect(calls.length).toBe(2);
    expect(calls[1]?.init?.headers?.["Idempotency-Key"]).toBeUndefined();
  });

  it("does not send Idempotency-Key outside KWT/SAU", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(myfatoorahEnvelope(initiatedCreateData()))],
      calls,
      { country: "ARE" },
    );
    const result = await gateway.createPayment({ ...createParams });
    expect(result.outcome).toBe("requires_action");
    expect(calls.length).toBe(1);
    expect(calls[0]?.init?.headers?.["Idempotency-Key"]).toBeUndefined();
  });

  it("picks the currency-matching ValueIn* field on paid create", async () => {
    const paid = paidCreateData({
      TransactionDetails: {
        Invoice: { Status: "PAID" },
        Transaction: { Status: "SUCCESS", PaymentId: "07076409988323998875" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: 64.772,
          DisplayCurrency: "KWD",
          ValueInDisplayCurrency: 800,
          PayCurrency: "SAR",
          ValueInPayCurrency: 800,
        },
      },
    });
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(paid))], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.amount).toBe(800);
    expect(result.currency).toBe("SAR");
  });

  it("omits the paid amount when no ValueIn* field matches the request currency", async () => {
    const paid = paidCreateData({
      TransactionDetails: {
        Invoice: { Status: "PAID" },
        Transaction: { Status: "SUCCESS", PaymentId: "07076409988323998875" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: 64.772,
          DisplayCurrency: "KWD",
          ValueInDisplayCurrency: 64.772,
        },
      },
    });
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(paid))], []);
    const result = await gateway.createPayment({ ...createParams });
    expect(isPaidOutcome(result)).toBe(true);
    expect(result.amount).toBeUndefined();
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
    const failed = [
      {
        TransactionStatus: "FAILED",
        TransactionId: "t1",
        Currency: "SAR",
      },
    ];
    data.Transactions = failed;
    (data as Record<string, unknown>).InvoiceTransactions = failed;
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("pending");
    expect(result.outcome).toBe("requires_action");
  });

  it("maps a paid invoice without a success transaction as paid", async () => {
    const data = paidInvoiceStatusData();
    const failed = [{ TransactionStatus: "FAILED", Currency: "SAR" }];
    data.Transactions = failed;
    (data as Record<string, unknown>).InvoiceTransactions = failed;
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("paid");
    expect(result.amount).toBeUndefined();
  });

  it("normalizes the KD currency alias to KWD from the success transaction", async () => {
    const data = paidInvoiceStatusData({
      Transactions: [
        { TransactionStatus: "Succss", PaymentId: "t1", Currency: "KD", PaidCurrency: "KD" },
      ],
    });
    const gateway = createGateway([jsonResponse(myfatoorahEnvelope(data))], []);
    const result = await gateway.getPayment({ gatewayPaymentId: "915102" });
    expect(result.status).toBe("paid");
    expect(result.currency).toBe("KWD");
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

  it("rejects PaymentId-shaped gatewayPaymentId with the InvoiceId default", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway([], calls);
    await expect(gateway.getPayment({ gatewayPaymentId: "07076409988323998875" })).rejects.toThrow(
      /PaymentId/,
    );
    expect(calls.length).toBe(0);
  });

  it("queries with KeyType PaymentId when requested", async () => {
    const calls: FetchCall[] = [];
    const gateway = createGateway(
      [jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData()))],
      calls,
    );
    const result = await gateway.getPayment({
      gatewayPaymentId: "07076409988323998875",
      myfatoorahKeyType: "PaymentId",
    });
    expect(bodyOf(calls[0])).toEqual({ Key: "07076409988323998875", KeyType: "PaymentId" });
    expect(result.status).toBe("paid");
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

  it("replays a partial refund with same idempotencyKey without posting MakeRefund (MF-CRIT-1)", async () => {
    // Existing partial refund with same ExternalIdentifier should be returned before any MakeRefund,
    // even though remaining > 0 (idempotent retry after partial).
    const refundStatus = partialRefundStatusData({
      Refunds: [
        {
          RefundId: 22201,
          ExternalIdentifier: "refund-idem-2",
          Comment: null,
          InvoiceId: 915102,
          Amount: 2.5,
          ServiceChargeOnCustomer: 0,
          RefundStatus: "Pending",
        },
      ],
    });
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
      amount: money("2.50", "SAR"),
      currency: "SAR",
    });
    expect(result.gatewayRefundId).toBe("22201");
    expect(result.status).toBe("pending");
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("replays a fully refunded invoice from the nested refund when keyed", async () => {
    const refundStatus = partialRefundStatusData({
      Refunds: [
        {
          RefundId: 22201,
          ExternalIdentifier: "refund-idem-2",
          Comment: null,
          InvoiceId: 915102,
          Amount: 10.5,
          ServiceChargeOnCustomer: 0,
          RefundStatus: "Refunded",
        },
      ],
    });
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
    const refundStatus = partialRefundStatusData({
      Refunds: [
        {
          RefundId: 22201,
          ExternalIdentifier: "refund-idem-1",
          Comment: null,
          InvoiceId: 915102,
          Amount: 10.5,
          ServiceChargeOnCustomer: 0,
          RefundStatus: "Refunded",
        },
      ],
    });
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

  it("throws on an unparseable refund list even with an explicit amount", async () => {
    const refundStatus = {
      Refunds: [{ RefundId: 22201, RefundStatus: "Refunded" }],
    };
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
        amount: money("3.00", "SAR"),
        currency: "SAR",
      }),
    ).rejects.toThrow(InvalidRequestError);
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
  });

  it("throws on a GetRefundStatus 500 instead of returning indeterminate", async () => {
    const calls: FetchCall[] = [];
    const queue: (Response | Error)[] = [];
    for (let i = 0; i < 3; i += 1) {
      queue.push(jsonResponse({ IsSuccess: false, Message: "boom" }, 500));
    }
    queue.push(jsonResponse(myfatoorahEnvelope(paidInvoiceStatusData())));
    const gateway = createGateway(queue, calls);
    let caught: unknown;
    try {
      await gateway.refundPayment({
        gatewayPaymentId: "915102",
        idempotencyKey: "refund-idem-2",
      });
      expect.unreachable("must throw");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    expect((caught as NetworkError).afterProviderSubmit).toBe(false);
    expect(calls.map((c) => c.url)).not.toContain("https://apitest.myfatoorah.com/v2/MakeRefund");
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
    expect(event.amount).toBe(500);
    expect(event.currency).toBe("KWD");
    expect(
      (event.event as { payment?: { references?: { relatedIds?: Record<string, unknown> } } })
        ?.payment?.references?.relatedIds?.paymentId,
    ).toBe("07076409988323998875");
  });

  it("parses a refund webhook into a refunded event with money and invoice identity", () => {
    const gateway = createGateway([], []);
    const event = gateway.parseWebhookEvent(refundWebhook());
    expect(event.gateway).toBe("myfatoorah");
    expect(event.gatewayPaymentId).toBe("5620277");
    expect(event.gatewayObjectId).toBe("111147");
    expect(event.status).toBe("refunded");
    expect(event.stableType).toBe("refund.completed");
    expect(event.amount).toBe(30);
    expect(event.currency).toBe("KWD");
    expect(event.type).toBe("refund.REFUNDED");
  });
});
