import { describe, expect, it } from "bun:test";
import { InvalidRequestError } from "@paykernel/core";
import {
  computeTapHashstring,
  extractHashstringHeader,
  hashFieldsFromTapObject,
  verifyTapHashstring,
} from "./webhooks";
import { capturedCharge } from "./fixtures/charges";
import { TAP_TEST_SECRET } from "./fixtures/charges";

describe("Tap hashstring", () => {
  it("pads amount to ISO scale in the canonical string", () => {
    const fields = hashFieldsFromTapObject(capturedCharge({ amount: 1 }));
    expect(fields.amount).toBe("1.00");
    expect(fields.currency).toBe("SAR");
    expect(fields.gatewayReference).toBe("");
  });

  it("accepts a valid HMAC and rejects tampering / missing header", () => {
    const payload = capturedCharge({ amount: 10.5 });
    const fields = hashFieldsFromTapObject(payload);
    const signature = computeTapHashstring(fields, TAP_TEST_SECRET);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, signature)).toBe(true);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, "00".repeat(32))).toBe(
      false,
    );
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, undefined)).toBe(false);
    const tampered = capturedCharge({ amount: 11 });
    expect(verifyTapHashstring(tampered, TAP_TEST_SECRET, signature)).toBe(false);
  });

  it("fails closed when created is missing", () => {
    expect(() =>
      hashFieldsFromTapObject(capturedCharge({ transaction: {} })),
    ).toThrow(InvalidRequestError);
  });

  it("reads hashstring from headers case-insensitively", () => {
    expect(
      extractHashstringHeader(undefined, { Hashstring: "abc" }),
    ).toBe("abc");
    expect(extractHashstringHeader(" direct ", { hashstring: "hdr" })).toBe(
      "direct",
    );
  });
});
