import { describe, it, expect } from "bun:test";
import type { TelemetrySink } from "@paykernel/core";
import {
  createRedactingTelemetrySink,
  redactAttributeBag,
  redactTelemetryData,
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
});

describe("redactAttributeBag", () => {
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
