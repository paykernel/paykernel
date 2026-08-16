import { describe, it, expect } from "bun:test";
import { deriveWebhookEventKey, parseWebhookEventKey } from "./event-key";

describe("deriveWebhookEventKey", () => {
  it("joins gateway and providerEventId with colon", () => {
    expect(deriveWebhookEventKey("stripe", "evt_1")).toBe("stripe:evt_1");
    expect(deriveWebhookEventKey("moyasar", "pay_abc")).toBe("moyasar:pay_abc");
  });

  it("trims whitespace", () => {
    expect(deriveWebhookEventKey("  stripe  ", "  evt_1  ")).toBe("stripe:evt_1");
  });

  it("rejects empty gateway", () => {
    expect(() => deriveWebhookEventKey("", "evt_1")).toThrow(/gateway/);
    expect(() => deriveWebhookEventKey("   ", "evt_1")).toThrow(/gateway/);
  });

  it("rejects empty providerEventId", () => {
    expect(() => deriveWebhookEventKey("stripe", "")).toThrow(/providerEventId/);
    expect(() => deriveWebhookEventKey("stripe", "  ")).toThrow(/providerEventId/);
  });

  it("rejects gateway containing colon (key collision)", () => {
    expect(() => deriveWebhookEventKey("a:b", "c")).toThrow(/colon|separator|:/i);
    expect(() => deriveWebhookEventKey("stripe:live", "evt_1")).toThrow(
      /colon|separator|:/i,
    );
    // a:b + c must not equal a + b:c
    expect(() => deriveWebhookEventKey("a:b", "c")).toThrow();
  });

  it("allows colon in providerEventId only", () => {
    expect(deriveWebhookEventKey("gw", "a:b:c")).toBe("gw:a:b:c");
  });

  it("WEBHOOKS-1: Paymob keys include notification class when provided", () => {
    expect(deriveWebhookEventKey("paymob", "123456789", "TRANSACTION_RESPONSE")).toBe(
      "paymob:TRANSACTION_RESPONSE:123456789",
    );
    expect(deriveWebhookEventKey("paymob", "123456789", "TRANSACTION")).toBe(
      "paymob:TRANSACTION:123456789",
    );
    expect(
      deriveWebhookEventKey("paymob", "123456789", "TRANSACTION_RESPONSE"),
    ).not.toBe(deriveWebhookEventKey("paymob", "123456789", "TRANSACTION"));
  });

  it("WEBHOOKS-1: does not double-qualify an already class-prefixed Paymob id", () => {
    expect(
      deriveWebhookEventKey("paymob", "TRANSACTION:123456789", "TRANSACTION"),
    ).toBe("paymob:TRANSACTION:123456789");
  });

  it("WEBHOOKS-1: :redirect suffix and TRANSACTION_RESPONSE class share one key", () => {
    expect(
      deriveWebhookEventKey("paymob", "123456789:redirect", "TRANSACTION_RESPONSE"),
    ).toBe("paymob:TRANSACTION_RESPONSE:123456789");
    expect(deriveWebhookEventKey("paymob", "123456789:redirect")).toBe(
      "paymob:TRANSACTION_RESPONSE:123456789",
    );
    expect(
      deriveWebhookEventKey("paymob", "123456789", "TRANSACTION_RESPONSE"),
    ).toBe("paymob:TRANSACTION_RESPONSE:123456789");
  });

  it("WEBHOOKS-1: non-Paymob gateways ignore notification class", () => {
    expect(
      deriveWebhookEventKey("stripe", "evt_1", "payment_intent.succeeded"),
    ).toBe("stripe:evt_1");
    expect(deriveWebhookEventKey("paymob", "123456789")).toBe("paymob:123456789");
  });
});

describe("parseWebhookEventKey", () => {
  it("splits gateway:providerEventId", () => {
    expect(parseWebhookEventKey("stripe:evt_1")).toEqual({
      gateway: "stripe",
      providerEventId: "evt_1",
    });
  });

  it("keeps extra colons in providerEventId", () => {
    expect(parseWebhookEventKey("gw:a:b:c")).toEqual({
      gateway: "gw",
      providerEventId: "a:b:c",
    });
  });

  it("returns undefined for invalid keys", () => {
    expect(parseWebhookEventKey("")).toBeUndefined();
    expect(parseWebhookEventKey("nocolon")).toBeUndefined();
    expect(parseWebhookEventKey(":onlyid")).toBeUndefined();
    expect(parseWebhookEventKey("onlygw:")).toBeUndefined();
  });
});
