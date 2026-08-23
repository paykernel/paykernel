import { describe, expect, it } from "bun:test";
import {
  canonicalMyFatoorahPaymentString,
  canonicalMyFatoorahRefundString,
  computeMyFatoorahSignature,
  extractMyFatoorahSignatureHeader,
  myFatoorahWebhookKind,
  verifyMyFatoorahSignature,
} from "./webhooks";
import { MYFATOORAH_TEST_WEBHOOK_SECRET, paymentWebhook, refundWebhook } from "./fixtures/webhooks";
import { MyFatoorahGateway } from "./gateway";
import { HooksManager } from "@paykernel/core";
import { MYFATOORAH_TEST_API_TOKEN } from "./fixtures/webhooks";

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
});
