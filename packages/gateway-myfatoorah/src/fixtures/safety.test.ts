import { describe, expect, it } from "bun:test";
import { assertFixtureSafe, findSecretLeaks } from "@paykernel/testkit";
import {
  MYFATOORAH_TEST_API_TOKEN,
  MYFATOORAH_TEST_WEBHOOK_SECRET,
  initiatedCreateData,
  paidCreateData,
  paidInvoiceStatusData,
  partialRefundStatusData,
  paymentWebhook,
  refundWebhook,
} from "./webhooks";

describe("fixture safety", () => {
  it("keeps committed MyFatoorah fixtures free of live secrets and raw PANs", () => {
    expect(MYFATOORAH_TEST_WEBHOOK_SECRET.startsWith("whsec_test_")).toBe(true);
    expect(MYFATOORAH_TEST_API_TOKEN.startsWith("test_secret_")).toBe(true);
    assertFixtureSafe({
      payment: paymentWebhook(),
      refund: refundWebhook(),
      createInitiated: initiatedCreateData(),
      createPaid: paidCreateData(),
      invoiceStatus: paidInvoiceStatusData(),
      refundStatus: partialRefundStatusData(),
    });
  });

  it("rejects 13–19 digit unmarked PANs", () => {
    const withPan = {
      Card: { Number: "4111111111111111" },
    };
    expect(findSecretLeaks(withPan).length).toBeGreaterThan(0);
    expect(() => assertFixtureSafe(withPan)).toThrow();
  });

  it("rejects the public MyFatoorah sandbox token shape", () => {
    const withToken = {
      apiToken: "SK_KWT_vVZlnnAqu8jRByOWaRPNId4ShzEDNt256dvnjebuyzo52dXjAfRx2ixW5umjWSUx",
    };
    expect(findSecretLeaks(withToken).length).toBeGreaterThan(0);
    expect(() => assertFixtureSafe(withToken)).toThrow();
  });
});
