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

  it("redacts secret keys on plain object throws before stringify", () => {
    const out = sanitizeReconciliationError({
      code: "boom",
      password: "hunter2",
      api_key: "rk_live_should_not_persist",
      client_secret: "cs_live_abc",
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload",
      nested: { password: "nested-secret", ok: true },
    });
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("rk_live_should_not_persist");
    expect(out).not.toContain("cs_live_abc");
    expect(out).not.toContain("Bearer eyJ");
    expect(out).not.toContain("nested-secret");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("boom");
    expect(out).toContain("ok");
  });

  it.each([
    {
      name: "cs_live checkout session",
      input: "failed cs_live_checkout_secret_abc leftover",
      forbidden: ["cs_live_checkout_secret_abc"],
    },
    {
      name: "api_key and client_secret assignments",
      input: "api_key=pk_secret_value client_secret=cs_value rest",
      forbidden: ["pk_secret_value", "cs_value"],
    },
    {
      name: "password and authorization assignments",
      input: "password=hunter2 authorization=tok_supersecret rest",
      forbidden: ["hunter2", "tok_supersecret"],
    },
    {
      name: "Basic auth credentials",
      input: "Basic dXNlcjpwYXNz",
      forbidden: ["dXNlcjpwYXNz"],
    },
  ])("strips $name", ({ input, forbidden }) => {
    const out = sanitizeReconciliationError(input);
    for (const secret of forbidden) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });

  it("redacts 13-19 digit PAN runs (S19-RECON-PAN)", () => {
    const pan = sanitizeReconciliationError("card 4111111111111111 charged");
    expect(pan).not.toContain("4111111111111111");
    expect(pan).toContain("[REDACTED]");

    const dashed = sanitizeReconciliationError("pan 4111-1111-1111-1111 used");
    expect(dashed).not.toContain("4111-1111-1111-1111");
    expect(dashed).toContain("[REDACTED]");

    const spaced = sanitizeReconciliationError("pan 4111 1111 1111 1111 used");
    expect(spaced).not.toContain("4111 1111 1111 1111");
    expect(spaced).toContain("[REDACTED]");

    const short = sanitizeReconciliationError("ref 1234567890 leftover");
    expect(short).toContain("1234567890");
    expect(short).not.toContain("[REDACTED]");
  });
});
