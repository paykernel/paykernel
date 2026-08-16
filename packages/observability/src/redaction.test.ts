import { describe, it, expect } from "bun:test";
import type { TelemetrySink } from "@paykernel/core";
import {
  createRedactingTelemetrySink,
  redactAttributeBag,
  redactTelemetryData,
  sanitizeSpanStatusMessage,
} from "./redaction";

describe("createRedactingTelemetrySink (A3)", () => {
  it("never lets secrets reach the underlying TelemetrySink", () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const sink: TelemetrySink = {
      emit(_event, data) {
        seen.push(data);
      },
    };
    const redacting = createRedactingTelemetrySink(sink);
    redacting.emit?.("payment.operation", {
      cardNumber: "4242424242424242",
      token: "tok_secret",
      secretKey: "sk_live_xxx",
      clientSecret: "cs_live",
      authorization: "Bearer x",
      apiKey: "key_xxx",
      password: "hunter2",
      customerEmail: "a@b.com",
    });

    const data = seen[0]!;
    expect(data.cardNumber).toBe("[REDACTED]");
    expect(data.token).toBe("[REDACTED]");
    expect(data.secretKey).toBe("[REDACTED]");
    expect(data.clientSecret).toBe("[REDACTED]");
    expect(data.authorization).toBe("[REDACTED]");
    expect(data.apiKey).toBe("[REDACTED]");
    expect(data.password).toBe("[REDACTED]");
    expect(data.customerEmail).toBe("[REDACTED]");
  });

  it("keeps providerRequestId visible for debugging (A1)", () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const sink: TelemetrySink = {
      emit(_event, data) {
        seen.push(data);
      },
    };
    createRedactingTelemetrySink(sink).emit?.("payment.operation", {
      providerRequestId: "req_debug_visible",
      operationId: "op_1",
      gateway: "stripe",
      operationType: "payment.create",
      attemptNumber: 2,
      namespace: "live",
      inboxEventKey: "inbox:evt_1",
      token: "should_redact",
    });

    const data = seen[0]!;
    expect(data.providerRequestId).toBe("req_debug_visible");
    expect(data.operationId).toBe("op_1");
    expect(data.gateway).toBe("stripe");
    expect(data.operationType).toBe("payment.create");
    expect(data.attemptNumber).toBe(2);
    expect(data.namespace).toBe("live");
    expect(data.inboxEventKey).toBe("inbox:evt_1");
    expect(data.token).toBe("[REDACTED]");
  });

  it("preserves operational authorized flag (core allow-list + package sink)", () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const sink: TelemetrySink = {
      emit(_event, data) {
        seen.push(data);
      },
    };
    createRedactingTelemetrySink(sink).emit?.("payment.operation", {
      authorized: true,
      authorization: "Bearer secret",
      status: "authorized",
    });
    const data = seen[0]!;
    expect(data.authorized).toBe(true);
    expect(data.authorization).toBe("[REDACTED]");
    expect(data.status).toBe("authorized");
  });
});

describe("redactTelemetryData", () => {
  it("redacts nested sensitive keys via core redact()", () => {
    const out = redactTelemetryData({
      providerRequestId: "req_1",
      nested: { cardNumber: "4111", safe: "ok" },
    });
    expect(out.providerRequestId).toBe("req_1");
    expect((out.nested as Record<string, unknown>).cardNumber).toBe(
      "[REDACTED]",
    );
    expect((out.nested as Record<string, unknown>).safe).toBe("ok");
  });

  it("keeps authorized (core SAFE_KEY_ALLOWLIST; restore is defense-in-depth) (OBS-2)", () => {
    const out = redactTelemetryData({
      authorized: false,
      nested: { authorized: true, token: "x" },
    });
    // Core already allow-lists `authorized`; restore is a no-op today.
    expect(out.authorized).toBe(false);
    expect((out.nested as Record<string, unknown>).authorized).toBe(true);
    expect((out.nested as Record<string, unknown>).token).toBe("[REDACTED]");
  });

  it("does not restore authorized when the VALUE is secret-shaped (P20-AUTH-RESTORE)", () => {
    const secretShaped = redactTelemetryData({
      authorized: "sk_live_abc123secret",
    });
    expect(secretShaped.authorized).toBe("[REDACTED]");
    expect(JSON.stringify(secretShaped)).not.toContain("sk_live");

    const operational = redactTelemetryData({
      authorized: false,
    });
    expect(operational.authorized).toBe(false);
  });
});

describe("redactAttributeBag", () => {
  it("redacts cs_live_ / client-secret values on allow-listed keys (OBS-2)", () => {
    const out = redactAttributeBag({
      internalReference: "cs_live_checkout_secret_abc",
      providerObjectId: "cs_test_session_secret_xyz",
      providerRequestId: "req_ok",
      gateway: "stripe",
    });
    expect(out?.internalReference).toBe("[REDACTED]");
    expect(out?.providerObjectId).toBe("[REDACTED]");
    expect(out?.providerRequestId).toBe("req_ok");
    expect(out?.gateway).toBe("stripe");
    expect(JSON.stringify(out)).not.toContain("cs_live_");
    expect(JSON.stringify(out)).not.toContain("cs_test_");
    expect(JSON.stringify(out)).not.toContain("checkout_secret");

    const piSecret = redactAttributeBag({
      providerObjectId: "pi_3N3xYZ_secret_abc123def",
      operationId: "op_1",
    });
    expect(piSecret?.providerObjectId).toBe("[REDACTED]");
    expect(piSecret?.operationId).toBe("op_1");
    expect(JSON.stringify(piSecret)).not.toContain("_secret_");
  });

  it("redacts sensitive labels and keeps authorized/gateway", () => {
    const out = redactAttributeBag({
      gateway: "stripe",
      authorized: true,
      token: "tok_secret",
      cardNumber: "4111",
      latencyMs: 12,
    });
    expect(out).toEqual({
      gateway: "stripe",
      authorized: true,
      token: "[REDACTED]",
      cardNumber: "[REDACTED]",
      latencyMs: 12,
    });
  });

  it("returns undefined for undefined input", () => {
    expect(redactAttributeBag(undefined)).toBeUndefined();
  });
});

describe("sanitizeSpanStatusMessage (OBS-1)", () => {
  it("drops whole-string secrets and redacts embedded credentials", () => {
    expect(sanitizeSpanStatusMessage("sk_live_abc123secret")).toBeUndefined();
    expect(sanitizeSpanStatusMessage("cs_live_checkout_secret")).toBeUndefined();
    expect(sanitizeSpanStatusMessage("capture failed sk_live_abc123secret")).toBe(
      "capture failed [REDACTED]",
    );
    expect(sanitizeSpanStatusMessage("failed")).toBe("failed");
    expect(sanitizeSpanStatusMessage("Error")).toBe("Error");
    expect(sanitizeSpanStatusMessage(undefined)).toBeUndefined();
    expect(sanitizeSpanStatusMessage("   ")).toBeUndefined();
  });

  it("drops embedded PANs in span status messages (NEW-OBS-1)", () => {
    expect(sanitizeSpanStatusMessage("4242424242424242")).toBeUndefined();
    expect(sanitizeSpanStatusMessage("4111 1111 1111 1111")).toBeUndefined();
    expect(
      sanitizeSpanStatusMessage("charge failed 4242424242424242"),
    ).toBe("charge failed [REDACTED]");
    expect(
      sanitizeSpanStatusMessage("card 4242-4242-4242-4242 declined"),
    ).toBe("card [REDACTED] declined");
    expect(sanitizeSpanStatusMessage("amount 12345")).toBe("amount 12345");
    expect(sanitizeSpanStatusMessage("failed")).toBe("failed");
    const scrubbed = sanitizeSpanStatusMessage(
      "capture failed 4242424242424242",
    );
    expect(scrubbed).not.toMatch(/\d{13,19}/);
    expect(scrubbed).not.toContain("4242424242424242");
  });
});
