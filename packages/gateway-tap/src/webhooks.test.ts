import { describe, expect, it } from "bun:test";
import { InvalidRequestError } from "@paykernel/core";
import {
  computeTapHashstring,
  extractHashstringHeader,
  hashFieldsFromTapObject,
  verifyTapHashstring,
} from "./webhooks";
import { capturedCharge, TAP_TEST_SECRET } from "./fixtures/charges";
import {
  TAP_DOCS_CHARGE_HASHSTRING,
  TAP_DOCS_EXAMPLE_SECRET,
  tapDocsPostedCharge,
} from "./fixtures/official-hashstring";

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

  it("fails closed when the payload cannot be hashed", () => {
    expect(verifyTapHashstring(null, TAP_TEST_SECRET, "00".repeat(32))).toBe(
      false,
    );
    expect(
      verifyTapHashstring(
        capturedCharge({ transaction: {} }),
        TAP_TEST_SECRET,
        "00".repeat(32),
      ),
    ).toBe(false);
  });

  it("verifies Tap’s published Create-a-Charge hashstring (ISO amount pad is load-bearing)", () => {
    const payload = tapDocsPostedCharge();
    const fields = hashFieldsFromTapObject(payload);
    expect(fields.amount).toBe("1.00");
    expect(fields.created).toBe("1662042581741");
    expect(
      verifyTapHashstring(
        payload,
        TAP_DOCS_EXAMPLE_SECRET,
        TAP_DOCS_CHARGE_HASHSTRING,
      ),
    ).toBe(true);
    expect(
      computeTapHashstring(fields, TAP_DOCS_EXAMPLE_SECRET),
    ).toBe(TAP_DOCS_CHARGE_HASHSTRING);
    const unpadded = { ...fields, amount: "1" };
    expect(computeTapHashstring(unpadded, TAP_DOCS_EXAMPLE_SECRET)).not.toBe(
      TAP_DOCS_CHARGE_HASHSTRING,
    );
    expect(
      verifyTapHashstring(payload, TAP_TEST_SECRET, TAP_DOCS_CHARGE_HASHSTRING),
    ).toBe(false);
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
