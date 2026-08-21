import { describe, expect, it } from "bun:test";

import { InvalidRequestError } from "../errors";
import { assertNoRawCardMaterial } from "./raw-card";

const TEST_PAN = "4242424242424242";
const TEST_PAN_NUMBER = 4242424242424;

function expectRejected(params: unknown): void {
  expect(() => assertNoRawCardMaterial(params)).toThrow(InvalidRequestError);
}

function expectAllowed(params: unknown): void {
  expect(() => assertNoRawCardMaterial(params)).not.toThrow();
}

describe("assertNoRawCardMaterial", () => {
  it("rejects PAN-like metadata.pan", () => {
    expectRejected({ metadata: { pan: TEST_PAN } });
  });

  it("rejects PAN-like evidence.uncategorizedText", () => {
    expectRejected({
      disputeId: "dp_1",
      evidence: { uncategorizedText: TEST_PAN },
    });
  });

  it("rejects cvc-only payloads", () => {
    expectRejected({ cvc: "123" });
    expectRejected({ cvv: "123" });
    expectRejected({ cid: "1234" });
    expectRejected({ securityCode: "123" });
    expectRejected({ card: { cvc: "123" } });
  });

  it("rejects a numeric number field that is PAN-like", () => {
    expectRejected({ number: TEST_PAN_NUMBER });
  });

  it("does not reject tokenized pm_ ids", () => {
    expectAllowed({
      customerId: "cus_1",
      paymentMethodId: "pm_1Nxxxx",
    });
  });

  it("does not reject other gateway ids", () => {
    expectAllowed({
      token: "tok_visa",
      customerId: "cus_123",
      paymentIntentId: "pi_123",
      checkoutSessionId: "cs_test_a",
      disputeId: "dp_1",
      chargeId: "ch_1",
      secretKey: "sk_test_123",
      publishableKey: "pk_test_123",
    });
  });

  it("rejects PAN on token / paymentMethodId leaves", () => {
    expectRejected({ token: TEST_PAN });
    expectRejected({ paymentMethodId: TEST_PAN });
  });

  it("rejects PAN-like stripeEvidence values", () => {
    expectRejected({
      evidence: { stripeEvidence: { uncategorized_text: TEST_PAN } },
    });
  });

  it("rejects spaced and dashed PAN leaves", () => {
    expectRejected({ metadata: { pan: "4242 4242 4242 4242" } });
    expectRejected({ metadata: { cardNumber: "4242-4242-4242-4242" } });
  });

  it("keeps source.type === creditcard as raw card material", () => {
    expectRejected({ source: { type: "creditcard" } });
  });

  it("does not reject ordinary amounts, emails, or 3-digit non-CVC keys", () => {
    expectAllowed({
      amount: 10,
      email: "buyer@example.com",
      quantity: 123,
      metadata: { orderId: "ord_1", userId: "u_1" },
    });
  });

  it("does not reject Moyasar applepay DPAN or token CVC on moyasarSource", () => {
    expectAllowed({
      amount: 10,
      currency: "SAR",
      moyasarSource: {
        type: "applepay",
        dpan: TEST_PAN,
        month: 12,
        year: 2030,
        cryptogram: "crypto",
        deviceId: "device01",
      },
    });
    expectAllowed({
      amount: 10,
      currency: "SAR",
      moyasarSource: { type: "token", token: "token_abc", cvc: "123" },
    });
  });

  it("still rejects raw Moyasar creditcard sources and metadata PAN beside a token source", () => {
    expectRejected({
      moyasarSource: {
        type: "creditcard",
        number: TEST_PAN,
        cvc: "123",
      },
    });
    expectRejected({
      moyasarSource: { type: "token", token: "token_abc" },
      metadata: { pan: TEST_PAN },
    });
  });
});
