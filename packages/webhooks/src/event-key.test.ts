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
