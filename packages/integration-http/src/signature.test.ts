import { describe, it, expect } from "bun:test";
import { extractWebhookSignature, GATEWAY_WEBHOOK_SIGNATURE } from "./signature";

describe("GATEWAY_WEBHOOK_SIGNATURE", () => {
  it("has expected stripe/tap/myfatoorah/paypal/paymob/moyasar profiles", () => {
    expect(GATEWAY_WEBHOOK_SIGNATURE.stripe).toEqual({ kind: "header", header: "stripe-signature", required: true });
    expect(GATEWAY_WEBHOOK_SIGNATURE.tap).toEqual({ kind: "header", header: "hashstring", required: true });
    expect(GATEWAY_WEBHOOK_SIGNATURE.myfatoorah).toEqual({ kind: "header", header: "MyFatoorah-Signature", required: true });
    expect(GATEWAY_WEBHOOK_SIGNATURE.moyasar).toEqual({ kind: "payload" });
    expect(GATEWAY_WEBHOOK_SIGNATURE.paymob).toEqual({ kind: "header_or_query", header: "hmac", query: "hmac" });
    expect(GATEWAY_WEBHOOK_SIGNATURE.paypal.kind).toBe("headers");
  });
});

describe("extractWebhookSignature", () => {
  it("extracts stripe/tap/myfatoorah required header case-insensitive", () => {
    expect(extractWebhookSignature("stripe", { "Stripe-Signature": "sig" })).toBe("sig");
    expect(extractWebhookSignature("tap", { hashstring: "hs" })).toBe("hs");
    expect(extractWebhookSignature("myfatoorah", { "MyFatoorah-Signature": "mfsig" })).toBe("mfsig");
    expect(extractWebhookSignature("stripe", {})).toBeUndefined();
  });

  it("paypal returns lowercased keys record", () => {
    const headers = {
      "Paypal-Transmission-Id": "id1",
      "PAYPAL-TRANSMISSION-TIME": "time",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "url",
      "paypal-auth-algo": "algo",
    };
    const out = extractWebhookSignature("paypal", headers);
    expect(out).toEqual({
      "paypal-transmission-id": "id1",
      "paypal-transmission-time": "time",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "url",
      "paypal-auth-algo": "algo",
    });
  });

  it("paypal returns undefined when none found", () => {
    expect(extractWebhookSignature("paypal", {})).toBeUndefined();
  });

  it("paymob header wins, then query", () => {
    expect(extractWebhookSignature("paymob", { hmac: "header_hmac" }, { hmac: "query_hmac" })).toBe("header_hmac");
    expect(extractWebhookSignature("paymob", {}, { hmac: "query_hmac" })).toBe("query_hmac");
    expect(extractWebhookSignature("paymob", {}, { HMAC: "upper_query" })).toBe("upper_query");
    expect(extractWebhookSignature("paymob", {})).toBeUndefined();
  });

  it("moyasar payload returns undefined", () => {
    expect(extractWebhookSignature("moyasar", { hmac: "x" })).toBeUndefined();
  });

  it("unknown gateway returns undefined", () => {
    expect(extractWebhookSignature("unknown", { hmac: "x" })).toBeUndefined();
  });

  it("override profile is used instead of gateway default", () => {
    expect(
      extractWebhookSignature("stripe", { "custom": "val" }, undefined, { kind: "header", header: "custom", required: true }),
    ).toBe("val");
  });
});
