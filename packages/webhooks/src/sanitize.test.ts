import { describe, it, expect } from "bun:test";
import {
  sanitizeWebhookError,
  redactOpaquePayloadRefString,
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

  it("redacts secret keys on plain object throws before stringify", () => {
    const out = sanitizeWebhookError({
      code: "boom",
      secret_token: "supersecret123",
      client_secret: "cs_live_abc",
      nested: { password: "hunter2", ok: true },
    });
    expect(out).not.toContain("supersecret123");
    expect(out).not.toContain("cs_live_abc");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("boom");
  });

  it.each([
    {
      name: "api_key and client_secret assignments",
      input: "api_key=pk_secret_value client_secret=cs_value rest",
      forbidden: ["pk_secret_value", "cs_value"],
    },
    {
      name: "Basic auth credentials",
      input: "Basic dXNlcjpwYXNz",
      forbidden: ["dXNlcjpwYXNz"],
    },
  ])("strips $name", ({ input, forbidden }) => {
    const out = sanitizeWebhookError(input);
    for (const secret of forbidden) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });
});

describe("redactOpaquePayloadRefString (WEBHOOKS-6)", () => {
  it("redacts known secret patterns; passes plain opaque refs through", () => {
    expect(redactOpaquePayloadRefString("opaque-ref-token")).toBe(
      "opaque-ref-token",
    );
    const out = redactOpaquePayloadRefString(
      "Bearer sk_live_abc123xyz payload",
    );
    expect(out).not.toContain("sk_live_abc123xyz");
    expect(out).toContain("[REDACTED]");
  });
});

describe("I11 residual secret / PAN scrub (observability parity)", () => {
  const paypalA21AA =
    "A21AAFEpjF0wAHLmN8s7xKzExamplePayPalAccessTokenValueXYZ123456";

  it.each([
    {
      name: "cs_live_",
      input: "checkout cs_live_checkout_secret_abc leftover",
      forbidden: ["cs_live_checkout_secret_abc", "cs_live_"],
    },
    {
      name: "cs_test_",
      input: "session cs_test_abc123XYZ leftover",
      forbidden: ["cs_test_abc123XYZ"],
    },
    {
      name: "csk_live_",
      input: "paymob csk_live_abc123 leftover",
      forbidden: ["csk_live_abc123"],
    },
    {
      name: "pi_…_secret_",
      input: "client_secret=pi_3N3xYZ_secret_abc123def leftover",
      forbidden: ["pi_3N3xYZ_secret_abc123def"],
    },
    {
      name: "seti_…_secret_",
      input: "setup seti_1Abc_secret_xyz789 leftover",
      forbidden: ["seti_1Abc_secret_xyz789"],
    },
    {
      name: "PayPal A21AA",
      input: `oauth failed ${paypalA21AA}`,
      forbidden: [paypalA21AA, "A21AAFEpj"],
    },
    {
      name: "PAN digit run",
      input: "card 4111111111111111 charged",
      forbidden: ["4111111111111111"],
    },
    {
      name: "PAN with dashes",
      input: "pan 4111-1111-1111-1111 used",
      forbidden: ["4111-1111-1111-1111"],
    },
  ])("strips $name", ({ input, forbidden }) => {
    const out = sanitizeWebhookError(input);
    for (const secret of forbidden) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });

  it("does not treat short A21AA as a PayPal token", () => {
    expect(sanitizeWebhookError("id A21AA leftover")).toContain("A21AA");
  });

  it("redactOpaquePayloadRefString strips residual secrets and PAN", () => {
    const out = redactOpaquePayloadRefString(
      `cs_live_abc pi_1x_secret_yyy ${paypalA21AA} 4111111111111111`,
    );
    expect(out).not.toContain("cs_live_abc");
    expect(out).not.toContain("pi_1x_secret_yyy");
    expect(out).not.toContain(paypalA21AA);
    expect(out).not.toContain("4111111111111111");
    expect(out).toContain("[REDACTED]");
  });
});
