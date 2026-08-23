import { describe, expect, it } from "bun:test";
import { hmacSha256Hex, InvalidRequestError } from "@paykernel/core";
import {
  canonicalTapHashstring,
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

function invoiceHashPayload(overrides: Record<string, unknown> = {}) {
  return {
    object: "invoice",
    id: "inv_testInvoice01",
    amount: 1,
    currency: "SAR",
    status: "PAID",
    created: "1000000000",
    updated: "1000000001",
    ...overrides,
  };
}

const INVOICE_CANONICAL =
  "x_idinv_testInvoice01" +
  "x_amount1.00" +
  "x_currencySAR" +
  "x_updated1000000001" +
  "x_statusPAID" +
  "x_created1000000000";

const INVOICE_AS_CHARGE_CANONICAL =
  "x_idinv_testInvoice01" +
  "x_amount1.00" +
  "x_currencySAR" +
  "x_gateway_reference" +
  "x_payment_reference" +
  "x_statusPAID" +
  "x_created1000000000";

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

  it("hashes invoices with x_updated and not x_gateway_reference", () => {
    const payload = invoiceHashPayload();
    const fields = hashFieldsFromTapObject(payload);
    const canonical = canonicalTapHashstring(fields);
    expect(canonical).toBe(INVOICE_CANONICAL);
    expect(canonical).toContain("x_updated");
    expect(canonical).not.toContain("x_gateway_reference");
    expect(fields.updated).toBe("1000000001");
    const invoiceSig = hmacSha256Hex(TAP_TEST_SECRET, INVOICE_CANONICAL);
    expect(computeTapHashstring(fields, TAP_TEST_SECRET)).toBe(invoiceSig);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, invoiceSig)).toBe(
      true,
    );
    const chargeSig = hmacSha256Hex(TAP_TEST_SECRET, INVOICE_AS_CHARGE_CANONICAL);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, chargeSig)).toBe(
      false,
    );
  });

  it("accepts numeric invoice updated", () => {
    const numeric = invoiceHashPayload({ updated: 1000000001 });
    expect(hashFieldsFromTapObject(numeric).updated).toBe("1000000001");
    expect(
      verifyTapHashstring(
        numeric,
        TAP_TEST_SECRET,
        hmacSha256Hex(TAP_TEST_SECRET, INVOICE_CANONICAL),
      ),
    ).toBe(true);
  });

  it.each([
    ["empty updated", invoiceHashPayload({ updated: "" })],
    [
      "omitted updated",
      {
        object: "invoice",
        id: "inv_testInvoice01",
        amount: 1,
        currency: "SAR",
        status: "PAID",
        created: "1000000000",
      },
    ],
  ] as const)("fails closed when invoice %s", (_label, payload) => {
    expect(() => hashFieldsFromTapObject(payload)).toThrow(InvalidRequestError);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, "00".repeat(32))).toBe(
      false,
    );
  });

  it.each([
    [
      "missing object",
      {
        id: "chg_testInitiated01",
        amount: 10.5,
        currency: "SAR",
        status: "CAPTURED",
        created: "1000000000",
      },
    ],
    [
      "customer object",
      {
        object: "customer",
        id: "cus_testCustomer01",
        amount: 10.5,
        currency: "SAR",
        status: "CAPTURED",
        created: "1000000000",
      },
    ],
  ] as const)("does not verify a %s payload", (_label, payload) => {
    expect(() => hashFieldsFromTapObject(payload)).toThrow(InvalidRequestError);
    expect(verifyTapHashstring(payload, TAP_TEST_SECRET, "00".repeat(32))).toBe(
      false,
    );
  });
});
