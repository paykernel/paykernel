import { describe, expect, it } from "bun:test";
import { createDefaultGatewayContext } from "@paykernel/core";
import { runGatewayConformanceSuite } from "@paykernel/testkit";
import { tapGateway } from "./factory";
import { capturedCharge, TAP_TEST_SECRET } from "./fixtures/charges";
import { computeTapHashstring, hashFieldsFromTapObject } from "./webhooks";

describe("Tap gateway conformance (applicable)", () => {
  it("passes structural + offline webhook fixture cases", async () => {
    const payload = capturedCharge({ amount: 10.5 });
    const signature = computeTapHashstring(
      hashFieldsFromTapObject(payload),
      TAP_TEST_SECRET,
    );
    const report = await runGatewayConformanceSuite({
      name: "tap",
      mode: "applicable",
      createGateway: () =>
        tapGateway({ secretKey: TAP_TEST_SECRET }).create(
          createDefaultGatewayContext(),
        ),
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
