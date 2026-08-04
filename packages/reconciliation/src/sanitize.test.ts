import { describe, it, expect } from "bun:test";
import {
  sanitizeReconciliationError,
  DEFAULT_SANITIZE_MAX_LENGTH,
} from "./sanitize";

describe("sanitizeReconciliationError", () => {
  it("uses Error.message", () => {
    expect(sanitizeReconciliationError(new Error("boom"))).toBe("boom");
  });

  it("strips sk_live secrets", () => {
    const out = sanitizeReconciliationError(
      new Error("failed with sk_live_abc123XYZ and more"),
    );
    expect(out).not.toContain("sk_live_");
    expect(out).toContain("[REDACTED]");
  });

  it("strips Bearer tokens", () => {
    const out = sanitizeReconciliationError(
      "Bearer eyJhbGciOiJIUzI1NiJ9.payload",
    );
    expect(out).not.toMatch(/Bearer\s+eyJ/);
    expect(out).toContain("[REDACTED]");
  });

  it("strips secret_token assignments", () => {
    const out = sanitizeReconciliationError("secret_token=supersecret123 rest");
    expect(out).not.toContain("supersecret123");
    expect(out).toContain("[REDACTED]");
  });

  it("truncates long messages", () => {
    const long = "x".repeat(2000);
    const out = sanitizeReconciliationError(long, { maxLength: 64 });
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith("…")).toBe(true);
  });

  it("default max length caps unconfigured calls", () => {
    const long = "a".repeat(DEFAULT_SANITIZE_MAX_LENGTH + 200);
    const out = sanitizeReconciliationError(long);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_SANITIZE_MAX_LENGTH);
  });

  it("handles non-error values", () => {
    expect(sanitizeReconciliationError(null)).toBe("Unknown error");
    expect(sanitizeReconciliationError(42)).toBe("42");
  });
});
