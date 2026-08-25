import { describe, expect, it } from "bun:test";
import { HooksManager, InvalidRequestError } from "@paykernel/core";
import {
  MYFATOORAH_TEST_API_TOKEN,
  MYFATOORAH_TEST_WEBHOOK_SECRET,
  paymentWebhook,
  refundWebhook,
} from "./fixtures/webhooks";
import { MyFatoorahGateway } from "./gateway";
import { resolveMyFatoorahCustomerReference } from "./sources";
import {
  canonicalMyFatoorahPaymentString,
  canonicalMyFatoorahRefundString,
  computeMyFatoorahSignature,
  extractMyFatoorahSignatureHeader,
  myFatoorahWebhookKind,
  verifyMyFatoorahSignature,
} from "./webhooks";
import {
  parseMyFatoorahPaymentWebhookEvent,
  parseMyFatoorahRefundWebhookEvent,
} from "./webhook-map";

function gateway() {
  return new MyFatoorahGateway(
    {
      apiToken: MYFATOORAH_TEST_API_TOKEN,
      country: "KWT",
      webhookSecret: MYFATOORAH_TEST_WEBHOOK_SECRET,
    },
    new HooksManager({}),
  );
}

describe("myfatoorah webhook signatures", () => {
  it("locks the official payment canonical string", () => {
    expect(canonicalMyFatoorahPaymentString(paymentWebhook())).toBe(
      "Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=07076409988323998875,Invoice.ExternalIdentifier=asdqwd-f13sdf-fasjkz",
    );
  });

  it("locks the official refund canonical string", () => {
    expect(canonicalMyFatoorahRefundString(refundWebhook())).toBe(
      "Refund.Id=111147,Refund.Status=REFUNDED,Amount.ValueInBaseCurrency=30,ReferencedInvoice.Id=5620277",
    );
  });

  it("null canonical fields become empty strings", () => {
    const payload = paymentWebhook();
    payload.Data.Transaction.PaymentId = null;
    payload.Data.Invoice.ExternalIdentifier = null;
    expect(canonicalMyFatoorahPaymentString(payload)).toBe(
      "Invoice.Id=6409988,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=,Invoice.ExternalIdentifier=",
    );
  });

  it("verifies a valid signature", () => {
    const payload = paymentWebhook();
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahPaymentString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    expect(verifyMyFatoorahSignature(payload, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      true,
    );
    expect(gateway().verifyWebhook(payload, signature)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const payload = paymentWebhook();
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahPaymentString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    const tampered = paymentWebhook();
    tampered.Data.Invoice.Status = "PENDING";
    expect(verifyMyFatoorahSignature(tampered, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      false,
    );
  });

  it("fails closed without a secret or header", () => {
    const payload = paymentWebhook();
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahPaymentString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    expect(verifyMyFatoorahSignature(payload, undefined, signature)).toBe(false);
    expect(verifyMyFatoorahSignature(payload, "", signature)).toBe(false);
    expect(verifyMyFatoorahSignature(payload, MYFATOORAH_TEST_WEBHOOK_SECRET, undefined)).toBe(
      false,
    );
    const withoutSecret = new MyFatoorahGateway(
      { apiToken: MYFATOORAH_TEST_API_TOKEN, country: "KWT" },
      new HooksManager({}),
    );
    expect(withoutSecret.verifyWebhook(payload, signature)).toBe(false);
  });

  it("rejects invalid Base64 and unknown events", () => {
    const payload = paymentWebhook();
    expect(verifyMyFatoorahSignature(payload, MYFATOORAH_TEST_WEBHOOK_SECRET, "not-base64!")).toBe(
      false,
    );
    const unknown = {
      Event: { Name: "OTHER_EVENT", Reference: "WH-1" },
      Data: {},
    };
    const signature = computeMyFatoorahSignature("", MYFATOORAH_TEST_WEBHOOK_SECRET);
    expect(verifyMyFatoorahSignature(unknown, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      false,
    );
    expect(() => myFatoorahWebhookKind(unknown)).toThrow();
  });

  it("unsupported webhook codes 3-7 (BALANCE_TRANSFERRED etc) verify false but parse throws unsupported", () => {
    // https://docs.myfatoorah.com/docs/webhook-v2 — codes 3-7 are not payment/refund
    for (const code of [3, 4, 5, 6, 7, "3", "7"]) {
      const payload = {
        Event: { Code: code, Reference: `WH-${code}`, CreationDate: "2025-02-18T11:21:25.476Z" },
        Data: {},
      };
      const sig = computeMyFatoorahSignature("", MYFATOORAH_TEST_WEBHOOK_SECRET);
      expect(verifyMyFatoorahSignature(payload, MYFATOORAH_TEST_WEBHOOK_SECRET, sig)).toBe(false);
      expect(() => myFatoorahWebhookKind(payload)).toThrow(InvalidRequestError);
      expect(() => myFatoorahWebhookKind(payload)).toThrow(/Unsupported/);
      // gateway parse also throws unsupported (not signature failure)
      expect(() => gateway().parseWebhookEvent(payload)).toThrow(InvalidRequestError);
    }
    // Name authoritative: BALANCE_TRANSFERRED with Code 1 still unsupported
    const named = {
      Event: { Name: "BALANCE_TRANSFERRED", Code: 1, Reference: "WH-BAL", CreationDate: "2025-02-18T11:21:25.476Z" },
      Data: {},
    };
    expect(verifyMyFatoorahSignature(named, MYFATOORAH_TEST_WEBHOOK_SECRET, "abcd")).toBe(false);
    expect(() => myFatoorahWebhookKind(named)).toThrow(/Unsupported/);
  });

  it("extracts the signature header case-insensitively", () => {
    expect(
      extractMyFatoorahSignatureHeader(undefined, {
        "MyFatoorah-Signature": "sig1",
      }),
    ).toBe("sig1");
    expect(
      extractMyFatoorahSignatureHeader(undefined, {
        "myfatoorah-signature": "sig2",
      }),
    ).toBe("sig2");
    expect(extractMyFatoorahSignatureHeader("explicit")).toBe("explicit");
    expect(extractMyFatoorahSignatureHeader()).toBeUndefined();
  });

  it("verifies the refund event shape", () => {
    const payload = refundWebhook();
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahRefundString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    expect(verifyMyFatoorahSignature(payload, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      true,
    );
  });

  it("verifies raw JSON string payloads and fails closed on bad JSON", () => {
    const payload = paymentWebhook();
    const raw = JSON.stringify(payload);
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahPaymentString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    // raw string succeeds
    expect(verifyMyFatoorahSignature(raw, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(true);
    expect(verifyMyFatoorahSignature(`  ${raw}  `, MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      true,
    );
    expect(gateway().verifyWebhook(raw, signature)).toBe(true);
    // bad JSON fails closed (false, not throw)
    expect(verifyMyFatoorahSignature("not-json{", MYFATOORAH_TEST_WEBHOOK_SECRET, signature)).toBe(
      false,
    );
    expect(verifyMyFatoorahSignature("{", MYFATOORAH_TEST_WEBHOOK_SECRET, "abcd")).toBe(false);
    // canonical helpers throw InvalidRequestError on bad JSON
    expect(() => canonicalMyFatoorahPaymentString("not-json{")).toThrow(InvalidRequestError);
    expect(() => myFatoorahWebhookKind("not-json{")).toThrow(InvalidRequestError);
  });

  it("canonical helpers parse raw JSON string (payment/refund)", () => {
    const pay = paymentWebhook();
    const payRaw = JSON.stringify(pay);
    expect(canonicalMyFatoorahPaymentString(payRaw)).toBe(canonicalMyFatoorahPaymentString(pay));
    const refund = refundWebhook();
    const refundRaw = JSON.stringify(refund);
    expect(canonicalMyFatoorahRefundString(refundRaw)).toBe(
      canonicalMyFatoorahRefundString(refund),
    );
  });
});

describe("myfatoorah customer reference", () => {
  it("prefers explicit myfatoorahCustomer.reference over orderId", () => {
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "ord_123",
        myfatoorahCustomerReference: "explicit_ref",
      }),
    ).toBe("explicit_ref");
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "  ord_123  ",
        myfatoorahCustomerReference: "explicit_ref",
      }),
    ).toBe("explicit_ref");
  });

  it("falls back to trimmed orderId", () => {
    expect(resolveMyFatoorahCustomerReference({ orderId: "ord_123" })).toBe("ord_123");
    expect(resolveMyFatoorahCustomerReference({ orderId: "  ord_trim  " })).toBe("ord_trim");
  });

  it("returns undefined for missing or blank inputs", () => {
    expect(resolveMyFatoorahCustomerReference({})).toBeUndefined();
    expect(resolveMyFatoorahCustomerReference({ orderId: "  " })).toBeUndefined();
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "ord_123",
        myfatoorahCustomerReference: "  ",
      }),
    ).toBe("ord_123");
    expect(
      resolveMyFatoorahCustomerReference({ myfatoorahCustomerReference: "", orderId: "" }),
    ).toBeUndefined();
    expect(
      resolveMyFatoorahCustomerReference({ myfatoorahCustomerReference: "   ", orderId: "   " }),
    ).toBeUndefined();
  });
});

describe("myfatoorah webhook amount mapping (base drift + aliases)", () => {
  it("prefers ValueInBaseCurrency over display/pay (base drift)", () => {
    const payload = paymentWebhook({
      Data: {
        Invoice: { Id: 6409988, Status: "PAID", ExternalIdentifier: "order_1" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay1" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: 10,
          DisplayCurrency: "SAR",
          ValueInDisplayCurrency: 20,
          PayCurrency: "SAR",
          ValueInPayCurrency: 30,
        },
      },
    });
    const event = parseMyFatoorahPaymentWebhookEvent(payload);
    expect(event.amount).toBe(10);
    expect(event.currency).toBe("KWD");
  });

  it("aliases KD → KWD and SR → SAR in webhook amounts", () => {
    const kdPayload = paymentWebhook({
      Data: {
        Invoice: { Id: 1, Status: "PAID", ExternalIdentifier: "order_kd" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay_kd" },
        Amount: {
          BaseCurrency: "KD",
          ValueInBaseCurrency: "12,345.000",
          DisplayCurrency: "KD",
          ValueInDisplayCurrency: "12,345.000",
        },
      },
    });
    const kdEvent = parseMyFatoorahPaymentWebhookEvent(kdPayload);
    expect(kdEvent.currency).toBe("KWD");
    expect(kdEvent.amount).toBe(12345);

    const srPayload = refundWebhook({
      Data: {
        Refund: { Id: 111, Status: "REFUNDED" },
        Amount: {
          BaseCurrency: "SR",
          ValueInBaseCurrency: 30,
          DisplayCurrency: "SR",
          ValueInDisplayCurrency: 30,
        },
        ReferencedInvoice: { Id: 5620277, ExternalIdentifier: "order_sr" },
      },
    });
    const srEvent = parseMyFatoorahRefundWebhookEvent(srPayload);
    expect(srEvent.currency).toBe("SAR");
    expect(srEvent.amount).toBe(30);
  });

  it("falls back to display when base missing, and does not use top-level Amount as pay", () => {
    const displayOnly = paymentWebhook({
      Data: {
        Invoice: { Id: 2, Status: "PAID", ExternalIdentifier: "order_disp" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay_disp" },
        Amount: {
          DisplayCurrency: "KWD",
          ValueInDisplayCurrency: 7.5,
          PayCurrency: "SAR",
          ValueInPayCurrency: 90,
        },
      },
    });
    const dispEvent = parseMyFatoorahPaymentWebhookEvent(displayOnly);
    expect(dispEvent.amount).toBe(7.5);
    expect(dispEvent.currency).toBe("KWD");

    // Fallback legacy Value should not be mistaken for pay when base/display/pay are missing
    const legacy = paymentWebhook({
      Data: {
        Invoice: { Id: 3, Status: "PAID", ExternalIdentifier: "order_legacy" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay_legacy" },
        Amount: {
          Value: 999,
          Currency: "KWD",
        },
      },
    });
    const legacyEvent = parseMyFatoorahPaymentWebhookEvent(legacy);
    expect(legacyEvent.amount).toBe(999);
    expect(legacyEvent.currency).toBe("KWD");

    // When ValueInBaseCurrency exists, legacy Value is ignored (base wins)
    const withBaseAndLegacy = paymentWebhook({
      Data: {
        Invoice: { Id: 4, Status: "PAID", ExternalIdentifier: "order_both" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay_both" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: 11,
          Value: 999,
          Currency: "SAR",
        },
      },
    });
    const bothEvent = parseMyFatoorahPaymentWebhookEvent(withBaseAndLegacy);
    expect(bothEvent.amount).toBe(11);
    expect(bothEvent.currency).toBe("KWD");
  });

  it("handles comma thousand-separated amounts in webhook Amount", () => {
    const payload = paymentWebhook({
      Data: {
        Invoice: { Id: 5, Status: "PAID", ExternalIdentifier: "order_comma" },
        Transaction: { Status: "SUCCESS", PaymentId: "pay_comma" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: "12,345.000",
        },
      },
    });
    const event = parseMyFatoorahPaymentWebhookEvent(payload);
    expect(event.amount).toBe(12345);
    expect(event.currency).toBe("KWD");
  });

  it("PAID webhook is paid regardless of Transaction FAILED (KNET duplicate)", () => {
    const payload = paymentWebhook({
      Data: {
        Invoice: { Id: 6409988, Status: "PAID", ExternalIdentifier: "order_knet" },
        Transaction: { Status: "FAILED", PaymentId: "pay_knet_dup" },
        Amount: {
          BaseCurrency: "KWD",
          ValueInBaseCurrency: 500,
        },
      },
    });
    const event = parseMyFatoorahPaymentWebhookEvent(payload);
    expect(event.status).toBe("paid");
  });
});

