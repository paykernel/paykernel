import { describe, expect, it } from "bun:test";
import {
  assertFixtureSafe,
  findSecretLeaks,
  FIXTURE_SCHEMA_VERSION,
  redactSecretsFromFixture,
  sanitizeFixture,
  REDACTED,
} from "../index";

describe("fixture safety", () => {
  it("assertFixtureSafe throws on sk_live_", () => {
    expect(() =>
      assertFixtureSafe({ key: "sk_live_abcdefghijklmnopqrstuv" }),
    ).toThrow(/sk_live_|secret pattern|fixture safety/i);
  });

  it("assertFixtureSafe rejects short sk_live_ / pk_live_ / rk_live_ bodies", () => {
    // Must not require 8+ chars after the prefix (regression: sk_live_short slipped through).
    expect(() => assertFixtureSafe({ key: "sk_live_short" })).toThrow(
      /sk_live_|secret pattern|fixture safety/i,
    );
    expect(() => assertFixtureSafe({ key: "sk_live_x" })).toThrow();
    expect(() => assertFixtureSafe({ key: "pk_live_ab" })).toThrow();
    expect(() => assertFixtureSafe({ key: "rk_live_z" })).toThrow();
  });

  it("assertFixtureSafe throws on rk_live_ and live whsec_", () => {
    expect(() =>
      assertFixtureSafe({ key: "rk_live_RestrictedKeyValue01" }),
    ).toThrow();
    expect(() =>
      assertFixtureSafe({ secret: "whsec_liveLookingWebhookSecretValue" }),
    ).toThrow();
  });

  it("assertFixtureSafe allows sk_test_ and pk_test_", () => {
    expect(() =>
      assertFixtureSafe({
        secretKey: "sk_test_51ExampleTestKeyOnly",
        publishableKey: "pk_test_51ExampleTestKeyOnly",
      }),
    ).not.toThrow();
  });

  it("assertFixtureSafe allows whsec_test_ and test_secret placeholders", () => {
    expect(() =>
      assertFixtureSafe({
        webhookSecret: "whsec_test_placeholder_only",
        password: "test_secret",
        token: "test_secret_token",
      }),
    ).not.toThrow();
  });

  it("assertFixtureSafe rejects PAN-like card numbers as strings", () => {
    expect(() =>
      assertFixtureSafe({ note: "4242424242424242" }),
    ).toThrow();
  });

  it("redactSecretsFromFixture removes Authorization headers", () => {
    const out = redactSecretsFromFixture({
      amount: 10,
      currency: "USD",
      headers: {
        Authorization: "Bearer sk_live_shouldNeverAppearInLogs",
        "Content-Type": "application/json",
      },
      Authorization: "Bearer sk_live_topLevel",
    });
    expect(out.Authorization).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers["Content-Type"]).toBe("application/json");
    expect(out.amount).toBe(10);
  });

  it("redacts sensitive keys including card numbers", () => {
    const out = redactSecretsFromFixture({
      amount: 10,
      cardNumber: "4242424242424242",
      currency: "USD",
    });
    expect(out.cardNumber).toBe(REDACTED);
    expect(out.amount).toBe(10);
  });

  it("redacts secret-pattern values nested under non-sensitive keys", () => {
    const out = redactSecretsFromFixture({
      providerKey: "sk_live_abcdefghijklmnopqrstuv",
      ok: "hello",
    });
    expect(out.providerKey).toBe(REDACTED);
    expect(out.ok).toBe("hello");
  });

  it("sanitizeFixture sets schemaVersion and redacted flag", () => {
    const env = sanitizeFixture(
      { amount: 10, currency: "SAR", note: "ok" },
      { id: "fx1", gateway: "mock" },
    );
    expect(env.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
    expect(env.redacted).toBe(true);
    expect(env.id).toBe("fx1");
    expect(env.gateway).toBe("mock");
    expect(env.data.amount).toBe(10);
    assertFixtureSafe(env);
  });

  it("sanitizeFixture scrubs secrets then passes safety", () => {
    const env = sanitizeFixture({
      amount: 10,
      Authorization: "Bearer sk_live_abcdefghijklmnopqrstuv",
      cardNumber: "4242424242424242",
    });
    expect(env.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
    expect(env.data.Authorization).toBe(REDACTED);
    expect(env.data.cardNumber).toBe(REDACTED);
    assertFixtureSafe(env);
  });

  it("findSecretLeaks returns paths of leaks", () => {
    const leaks = findSecretLeaks({
      nested: { key: "sk_live_abcdefghijklmnopqrstuv" },
      Authorization: "Bearer real_token_value_here",
    });
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some((p) => p.includes("nested") || p.includes("key"))).toBe(
      true,
    );
  });

  it("findSecretLeaks is empty for safe fixtures", () => {
    expect(
      findSecretLeaks({
        gateway: "stripe",
        status: "paid",
        amount: 10,
        currency: "USD",
        secretKey: "sk_test_only",
      }),
    ).toEqual([]);
  });

  it("allows operational allowlisted keys", () => {
    expect(() =>
      assertFixtureSafe({
        gateway: "stripe",
        status: "paid",
        amount: 10,
        currency: "USD",
      }),
    ).not.toThrow();
  });
});
