import { describe, expect, it } from "bun:test";
import { InvalidRequestError } from "@paykernel/core";
import {
  canonicalMyFatoorahPaymentString,
  canonicalMyFatoorahRefundString,
  computeMyFatoorahSignature,
  extractMyFatoorahSignatureHeader,
  myFatoorahWebhookKind,
  verifyMyFatoorahSignature,
} from "./webhooks";
import {
  MYFATOORAH_TEST_WEBHOOK_SECRET,
  paymentWebhook,
  refundWebhook,
} from "./fixtures/webhooks";
import { MyFatoorahGateway } from "./gateway";
import { HooksManager } from "@paykernel/core";
import { MYFATOORAH_TEST_API_TOKEN } from "./fixtures/webhooks";
import { resolveMyFatoorahCustomerReference } from "./sources";

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
  it("prefers explicit myfatoorahCustomer.reference, then orderId, never customerId", () => {
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "ord_123",
        myfatoorahCustomerReference: "explicit_ref",
        customerId: "cust_999",
      }),
    ).toBe("explicit_ref");
    expect(
      resolveMyFatoorahCustomerReference({ orderId: "ord_123", customerId: "cust_999" }),
    ).toBe("ord_123");
    expect(resolveMyFatoorahCustomerReference({ customerId: "cust_999" })).toBeUndefined();
    expect(
      resolveMyFatoorahCustomerReference({ orderId: "  ", customerId: "cust_999" }),
    ).toBeUndefined();
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "ord_123",
        myfatoorahCustomerReference: "  ",
        customerId: "cust_999",
      }),
    ).toBe("ord_123");
    expect(
      resolveMyFatoorahCustomerReference({
        orderId: "  ord_123  ",
        myfatoorahCustomerReference: "  explicit  ",
      }),
    ).toBe("explicit");
    expect(resolveMyFatoorahCustomerReference({ orderId: "  ord_trim  " })).toBe("ord_trim");
  });

  it("trims and ignores empty strings", () => {
    expect(
      resolveMyFatoorahCustomerReference({ myfatoorahCustomerReference: "", orderId: "" }),
    ).toBeUndefined();
    expect(
      resolveMyFatoorahCustomerReference({ myfatoorahCustomerReference: "   ", orderId: "   " }),
    ).toBeUndefined();
  });
});
