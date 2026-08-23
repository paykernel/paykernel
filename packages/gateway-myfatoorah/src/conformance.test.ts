import { describe, expect, it } from "bun:test";
import { createDefaultGatewayContext } from "@paykernel/core";
import { runGatewayConformanceSuite } from "@paykernel/testkit";
import { myfatoorahGateway } from "./factory";
import {
  MYFATOORAH_TEST_API_TOKEN,
  MYFATOORAH_TEST_WEBHOOK_SECRET,
  paymentWebhook,
} from "./fixtures/webhooks";
import { canonicalMyFatoorahString, computeMyFatoorahSignature } from "./webhooks";

describe("MyFatoorah gateway conformance (applicable)", () => {
  it("passes structural + offline webhook fixture cases", async () => {
    const payload = paymentWebhook();
    const signature = computeMyFatoorahSignature(
      canonicalMyFatoorahString(payload),
      MYFATOORAH_TEST_WEBHOOK_SECRET,
    );
    const report = await runGatewayConformanceSuite({
      name: "myfatoorah",
      mode: "applicable",
      createGateway: () =>
        myfatoorahGateway({
          apiToken: MYFATOORAH_TEST_API_TOKEN,
          country: "KWT",
          webhookSecret: MYFATOORAH_TEST_WEBHOOK_SECRET,
        }).create(createDefaultGatewayContext()),
      fixtures: {
        webhook: {
          validPayload: payload,
          validSignature: signature,
          invalidSignature: "00".repeat(32),
          malformedPayload: "not-json-{{{",
        },
      },
    });
    expect(report.failed).toEqual([]);
    expect(report.passed).toContain("capabilities_parity");
    expect(report.passed).toContain("claim_method_presence");
    expect(report.passed).toContain("webhook_verification");
    expect(report.passed).toContain("malformed_webhook_rejection");
  });
});
