import { describe, it, expect } from "bun:test";
import type { TelemetrySink } from "@paykernel/core";
import {
  createRedactingTelemetrySink,
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
});
