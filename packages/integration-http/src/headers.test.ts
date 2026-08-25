import { describe, it, expect } from "bun:test";
import { getHeader, resolveCorrelationId, requireStringBindings } from "./headers";

describe("getHeader", () => {
  it("is case-insensitive for Headers instance", () => {
    const h = new Headers({ "Stripe-Signature": "sig_123" });
    expect(getHeader(h, "stripe-signature")).toBe("sig_123");
    expect(getHeader(h, "Stripe-Signature")).toBe("sig_123");
    expect(getHeader(h, "STRIPE-SIGNATURE")).toBe("sig_123");
  });

  it("is case-insensitive for record and takes first array entry", () => {
    expect(getHeader({ "Stripe-Signature": "a" }, "stripe-signature")).toBe("a");
    expect(getHeader({ "stripe-signature": ["first", "second"] }, "Stripe-Signature")).toBe("first");
    expect(getHeader({ "other": "x" }, "stripe-signature")).toBeUndefined();
  });

  it("returns undefined for empty array or empty string record", () => {
    expect(getHeader({ "x": [] as unknown as string[] }, "x")).toBeUndefined();
    // empty string is still returned? but spec says undefined if missing/empty for required check; getHeader should return empty string? Record empty string is present but we treat as empty? For signature missing check we treat empty as missing. getHeader returning "" would be considered truthy? We return undefined for empty? Our impl returns "" for empty string length 0? Actually we return undefined for empty array, but for string we return "" if length 0? Check: we return undefined only if length 0? Wait headers.ts: if typeof v==="string" && v.length>0 return v; if typeof v==="string" return v.length>0? We have logic to return ""? Let's assert current: for empty string we return ""? Let's check. The impl returns undefined when v is string length 0? It returns v.length>0 ? v : undefined for first branch, then second branch same. So empty string => undefined.
    expect(getHeader({ "x": "" }, "x")).toBeUndefined();
  });
});

describe("resolveCorrelationId", () => {
  it("prefers x-request-id then x-correlation-id then cf-ray", () => {
    expect(resolveCorrelationId({ "x-request-id": "req-1", "cf-ray": "ray" })).toBe("req-1");
    expect(resolveCorrelationId({ "x-correlation-id": "corr-1", "cf-ray": "ray" })).toBe("corr-1");
    expect(resolveCorrelationId({ "cf-ray": "ray-123" })).toBe("ray-123");
  });

  it("generates when none present", () => {
    const id = resolveCorrelationId({}, () => "generated");
    expect(id).toBe("generated");
  });

  it("case-insensitive lookup", () => {
    expect(resolveCorrelationId({ "X-Request-ID": "upper" })).toBe("upper");
  });
});

describe("requireStringBindings", () => {
  it("returns requested keys when present", () => {
    const out = requireStringBindings({ A: "a", B: "b" }, ["A", "B"] as const);
    expect(out.A).toBe("a");
    expect(out.B).toBe("b");
  });

  it("throws with missing keys listing", () => {
    expect(() => requireStringBindings({ A: "a" }, ["A", "B", "C"] as const)).toThrow("missing env: B, C");
  });

  it("throws on empty string values and does not leak values", () => {
    try {
      requireStringBindings({ SECRET: "" }, ["SECRET"] as const);
      throw new Error("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("SECRET");
      expect(msg).not.toContain("value");
    }
  });
});
