/**
 * Synthetic MyFatoorah fixtures for tests. No live tokens and no raw PANs.
 * The masked `512345xxxxxx0008` card is MyFatoorah's own docs sample, kept
 * only inside webhook `rawPayload` copies used for signature tests.
 */

export const MYFATOORAH_TEST_API_TOKEN = "test_secret_myfatoorah_api_token";
export const MYFATOORAH_TEST_WEBHOOK_SECRET = "whsec_test_conformance_placeholder";

export function paymentWebhook(overrides: Record<string, unknown> = {}) {
  return {
    Event: {
      Id: "62a39fe1-b3e8-4c66-8b20-9f8cfbe0acda",
      Reference: "WH-626519",
      Name: "PAYMENT_STATUS_CHANGED",
      CreationDate: "2025-02-18T11:21:25.476Z",
    },
    Data: {
      Invoice: {
        Id: 6409988,
        Status: "PAID",
        ExternalIdentifier: "asdqwd-f13sdf-fasjkz",
      },
      Transaction: {
        Status: "SUCCESS",
        PaymentId: "07076409988323998875",
        Card: {
          Number: "512345xxxxxx0008",
          Brand: "Visa",
          AvsCheck: "Unavailable",
        },
        Amount: {
          ValueInBaseCurrency: 500,
          ValueInDisplayCurrency: 500,
        },
        Capture: { Status: "CAPTURED", CapturedAmount: 500 },
        Refund: null,
        PaymentMethod: "CARD",
        Payer: null,
      },
      // Official sibling Amount object (webhook-v2-payment-status-data-model)
      Amount: {
        BaseCurrency: "KWD",
        ValueInBaseCurrency: 500,
        DisplayCurrency: "KWD",
        ValueInDisplayCurrency: 500,
        PayCurrency: "KWD",
        ValueInPayCurrency: 500,
      },
    },
    ...overrides,
  };
}

export function refundWebhook(overrides: Record<string, unknown> = {}) {
  // Official REFUND_STATUS_CHANGED Data has siblings { Refund, Amount, ReferencedInvoice }
  // (https://docs.myfatoorah.com/docs/webhook-v2-refund-data-model)
  // Legacy nested shape under Refund is still supported for back-compat verification.
  return {
    Event: {
      Id: "62a39fe1-b3e8-4c66-8b20-9f8cfbe0acda",
      Reference: "WH-626524",
      Name: "REFUND_STATUS_CHANGED",
      CreationDate: "2025-02-18T11:21:25.476Z",
    },
    Data: {
      Refund: {
        Id: 111147,
        Status: "REFUNDED",
      },
      Amount: {
        BaseCurrency: "KWD",
        ValueInBaseCurrency: 30,
        DisplayCurrency: "KWD",
        ValueInDisplayCurrency: 30,
      },
      ReferencedInvoice: { Id: 5620277 },
    },
    ...overrides,
  };
}

/** V3 create `Data` for a hosted (redirect) payment. */
export function initiatedCreateData(overrides: Record<string, unknown> = {}) {
  return {
    InvoiceId: 915102,
    IsDirectPayment: false,
    PaymentURL:
      "https://sandbox.pg.apitest.myfatoorah.com/Checkout/Gateway/915102/2c7bee7e-9a1f-4d0a-8c3b-testfixture000001",
    CustomerReference: "payref1",
    UserDefinedField: "order_01",
    RecurringId: null,
    ...overrides,
  };
}

/** V3 create `Data` for a directly completed (paid) payment — official nested shape. */
export function paidCreateData(overrides: Record<string, unknown> = {}) {
  return {
    InvoiceId: 915102,
    IsDirectPayment: true,
    PaymentURL:
      "https://sandbox.pg.apitest.myfatoorah.com/payment/result?invoice=915102&result=paid",
    CustomerReference: "payref1",
    UserDefinedField: "order_01",
    RecurringId: null,
    PaymentId: "07076409988323998875",
    PaymentCompleted: true,
    // Official V3 shape only — statuses nested under TransactionDetails.
    // The legacy flat shape (top-level InvoiceStatus + TransactionDetails.Status)
    // has a dedicated regression test that passes both via overrides.
    TransactionDetails: {
      Invoice: { Status: "PAID" },
      Transaction: { Status: "SUCCESS", PaymentId: "07076409988323998875" },
      Amount: { ValueInBaseCurrency: 10.5, ValueInDisplayCurrency: 10.5 },
    },
    ...overrides,
  };
}

/** V2 GetPaymentStatus `Data` for a paid invoice with one success transaction. */
export function paidInvoiceStatusData(overrides: Record<string, unknown> = {}) {
  const tx = {
    TransactionDate: "2025-02-18T11:20:00.000Z",
    PaymentGateway: "card",
    ReferenceId: "1310001",
    TrackId: null,
    TransactionId: "07076409988323998875",
    PaymentId: "07076409988323998875",
    AuthorizationId: null,
    TransactionStatus: "Succss",
    TransationValue: "10.500",
    CustomerServiceCharge: "0",
    DueValue: "0",
    PaidCurrency: "SAR",
    PaidCurrencyValue: "10.500",
    IpAddress: null,
    Country: null,
    Currency: "SAR",
    Error: null,
    CardNumber: null,
    ErrorCode: null,
  };
  const base: Record<string, unknown> = {
    InvoiceId: 915102,
    InvoiceStatus: "Paid",
    InvoiceReference: "1310001",
    CreatedDate: "2025-02-18T11:00:00.000Z",
    ExpiryDate: "2025-02-25T11:00:00.000Z",
    InvoiceValue: 10.5,
    Comments: null,
    CustomerName: "Ada Lovelace",
    CustomerMobile: "96550000000",
    CustomerEmail: "ada@example.com",
    UserDefinedField: "order_01",
    InvoiceDisplayValue: "10.500",
    InvoiceItems: [],
    InvoiceTransactions: [tx],
    Transactions: [tx],
  };
  const merged = { ...base, ...overrides };
  // Keep InvoiceTransactions and Transactions in sync when only one is overridden
  if ("Transactions" in overrides && !("InvoiceTransactions" in overrides)) {
    merged.InvoiceTransactions = overrides.Transactions as unknown;
  }
  if ("InvoiceTransactions" in overrides && !("Transactions" in overrides)) {
    merged.Transactions = overrides.InvoiceTransactions as unknown;
  }
  return merged;
}

/** V2 GetRefundStatus `Data` for a partially refunded invoice — provides both official and legacy shapes. */
export function partialRefundStatusData(overrides: Record<string, unknown> = {}) {
  const legacyRefund = {
    RefundId: 22201,
    ExternalIdentifier: "refund-idem-1",
    Comment: null,
    InvoiceId: 915102,
    Amount: 2.5,
    ServiceChargeOnCustomer: 0,
    RefundStatus: "Refunded",
  };
  const officialRefund = {
    RefundId: 22201,
    RefundStatus: "Refunded",
    Amount: 2.5,
    BaseCurrency: "KWD",
    ExternalIdentifier: "refund-idem-1",
    InvoiceId: 915102,
    ServiceChargeOnCustomer: 0,
    RefundAmount: 2.5,
  };
  const base: Record<string, unknown> = {
    InvoiceId: 915102,
    InvoiceStatus: "PARTIALLY_REFUNDED",
    InvoiceAmount: 10.5,
    RefundStatusResult: [officialRefund],
    Refunds: [legacyRefund],
  };
  const merged = { ...base, ...overrides };
  // Keep RefundStatusResult and Refunds in sync when only one is overridden
  if ("Refunds" in overrides && !("RefundStatusResult" in overrides)) {
    const refunds = overrides.Refunds as unknown[];
    merged.RefundStatusResult = refunds.map((r) => {
      if (r !== null && typeof r === "object" && !Array.isArray(r)) {
        const rec = r as Record<string, unknown>;
        return {
          RefundId: rec.RefundId ?? rec.Id,
          RefundStatus: rec.RefundStatus ?? rec.Status ?? "Refunded",
          Amount: rec.Amount,
          BaseCurrency: rec.BaseCurrency ?? "KWD",
          ExternalIdentifier: rec.ExternalIdentifier,
          InvoiceId: rec.InvoiceId ?? 915102,
          RefundAmount: rec.Amount,
        };
      }
      return r;
    });
  }
  if ("RefundStatusResult" in overrides && !("Refunds" in overrides)) {
    const result = overrides.RefundStatusResult as unknown[];
    merged.Refunds = result.map((r) => {
      if (r !== null && typeof r === "object" && !Array.isArray(r)) {
        const rec = r as Record<string, unknown>;
        return {
          RefundId: rec.RefundId ?? rec.Id,
          RefundStatus: rec.RefundStatus ?? rec.Status,
          Amount: rec.Amount ?? rec.RefundAmount,
          ExternalIdentifier: rec.ExternalIdentifier,
          InvoiceId: rec.InvoiceId,
        };
      }
      return r;
    });
  }
  return merged;
}

/** V2 MakeRefund `Data`. */
export function makeRefundData(overrides: Record<string, unknown> = {}) {
  return {
    RefundId: 22202,
    ...overrides,
  };
}

export function myfatoorahEnvelope(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    IsSuccess: true,
    Message: "Ok",
    ValidationErrors: null,
    Data: data,
    ...overrides,
  };
}
