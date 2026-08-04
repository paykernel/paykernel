import { describe, it, expect } from "bun:test";
import {
  sanitizeWebhookError,
  DEFAULT_SANITIZE_MAX_LENGTH,
} from "./sanitize";

describe("sanitizeWebhookError", () => {
  it("uses Error.message", () => {
    expect(sanitizeWebhookError(new Error("boom"))).toBe("boom");
  });

  it("strips sk_live secrets", () => {
    const out = sanitizeWebhookError(
      new Error("failed with sk_live_abc123XYZ and more"),
    );
    expect(out).not.toContain("sk_live_");
    expect(out).toContain("[REDACTED]");
  });

  it("strips whsec_ secrets", () => {
    const out = sanitizeWebhookError("sig whsec_supersecret value");
    expect(out).not.toContain("whsec_");
    expect(out).toContain("[REDACTED]");
  });

  it("strips Bearer tokens", () => {
    const out = sanitizeWebhookError("Bearer eyJhbGciOiJIUzI1NiJ9.payload");
    expect(out).not.toMatch(/Bearer\s+eyJ/);
    expect(out).toContain("[REDACTED]");
  });

  it("strips secret_token assignments", () => {
    const out = sanitizeWebhookError("secret_token=supersecret123 rest");
    expect(out).not.toContain("supersecret123");
    expect(out).toContain("[REDACTED]");
  });

  it("truncates long messages", () => {
    const long = "x".repeat(2000);
    const out = sanitizeWebhookError(long, { maxLength: 64 });
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith("…")).toBe(true);
  });

  it("default max length caps unconfigured calls", () => {
    const long = "a".repeat(DEFAULT_SANITIZE_MAX_LENGTH + 200);
    const out = sanitizeWebhookError(long);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_SANITIZE_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles non-error values", () => {
    expect(sanitizeWebhookError(null)).toBe("Unknown error");
    expect(sanitizeWebhookError(42)).toBe("42");
  });
});
