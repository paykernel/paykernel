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
    expectRejected({ description: "4242-4242-4242-4242" });
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

  it("allows millisecond timestamps on orderId and metadata.orderId", () => {
    expectAllowed({ orderId: 1724123456789 });
    expectAllowed({ orderId: "1724123456789" });
    expectAllowed({ metadata: { orderId: 1724123456789 } });
    expectAllowed({ metadata: { orderId: "1724123456789" } });
    expectAllowed({ orderId: Date.now() });
  });

  it("allows a 13-digit non-Luhn account-ish value on metadata.orderId", () => {
    expectAllowed({ metadata: { orderId: "1234567890123" } });
  });

  it("rejects an embedded Luhn PAN in free text", () => {
    expectRejected({ metadata: { note: "card 4242424242424242 expired" } });
    expectRejected({ metadata: { note: `1724123456789 ${TEST_PAN}` } });
  });

  it("rejects track2 data with a leading semicolon and PAN", () => {
    expectRejected({ metadata: { note: `;${TEST_PAN}=` } });
  });

  it("does not treat a semicolon plus millisecond timestamp as track data", () => {
    expectAllowed({ metadata: { note: "updated;1724123456789" } });
  });

  it("rejects cvv2 and cvc2 as CVC-shaped keys", () => {
    expectRejected({ cvv2: "123" });
    expectRejected({ cvc2: "123" });
    expectRejected({ cardcvc: "123" });
    expectRejected({ card_cvc: "123" });
    expectRejected({ card_cvv: "123" });
  });

  it("allows Moyasar AFT sender.account.number that is not a Luhn PAN", () => {
    expectAllowed({
      sender: {
        account: { funds_source: "CREDIT", number: "1234567890123" },
        first_name: "A",
        last_name: "B",
        address: "Riyadh",
        country_code: "SA",
        id_type: "NTID",
        id: "1",
        phone_number: "0500000000",
      },
    });
    expectAllowed({
      account: { number: "1234567890123456" },
    });
  });

  it("still rejects a Luhn PAN in sender.account.number", () => {
    expectRejected({
      sender: { account: { funds_source: "CREDIT", number: TEST_PAN } },
    });
  });

  it("allows grouped non-Luhn AFT account.number", () => {
    expectAllowed({
      sender: { account: { funds_source: "CREDIT", number: "1234-5678-9012-3" } },
    });
  });

  it("walks moyasarSource when type is missing or unknown", () => {
    expectRejected({ moyasarSource: { number: TEST_PAN } });
    expectRejected({ moyasarSource: { type: "mystery", pan: TEST_PAN } });
  });
});
