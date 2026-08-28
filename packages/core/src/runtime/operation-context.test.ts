// file: packages/core/src/runtime/operation-context.test.ts

/**
 * Phase 20 — OperationContext builders + redacting telemetry round-trip.
 */
import { describe, it, expect } from "bun:test";
import {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  type OperationContext,
} from "./operation-context";
import {
  createRedactingTelemetrySink,
  type TelemetrySink,
} from "../gateways/gateway-context";

describe.skip("createOperationContext", () => {
  it.skip("requires operationId, gateway, operationType and omits absent optionals", () => {
    const ctx = createOperationContext({
      operationId: "op_1",
      gateway: "stripe",
      operationType: "payment.create",
    });

    expect(ctx).toEqual({
      operationId: "op_1",
      gateway: "stripe",
      operationType: "payment.create",
    });
    expect(Object.keys(ctx).sort()).toEqual([
      "gateway",
      "operationId",
      "operationType",
    ]);
    expect("tenant" in ctx).toBe(false);
    expect("providerRequestId" in ctx).toBe(false);
    expect("durationMs" in ctx).toBe(false);
  });

  it.skip("copies present optional fields without setting undefined keys", () => {
    const ctx = createOperationContext({
      operationId: "op_2",
      gateway: "moyasar",
      operationType: "payment.refund",
      tenant: "acme",
      namespace: "prod",
      internalReference: "ord_99",
      providerObjectId: "pay_abc",
      providerRequestId: "req_xyz",
      attemptNumber: 2,
      retry: true,
      reconciliationRequired: false,
      inboxEventKey: "evt:pay_abc",
    });

    expect(ctx.tenant).toBe("acme");
    expect(ctx.namespace).toBe("prod");
    expect(ctx.internalReference).toBe("ord_99");
    expect(ctx.providerObjectId).toBe("pay_abc");
    expect(ctx.providerRequestId).toBe("req_xyz");
    expect(ctx.attemptNumber).toBe(2);
    expect(ctx.retry).toBe(true);
    expect(ctx.reconciliationRequired).toBe(false);
    expect(ctx.inboxEventKey).toBe("evt:pay_abc");
    expect("durationMs" in ctx).toBe(false);
    expect("normalizedOutcome" in ctx).toBe(false);
  });
});

describe.skip("finalizeOperationContext", () => {
  it.skip("merges patch fields and does not mutate the base context", () => {
    const base = createOperationContext({
      operationId: "op_3",
      gateway: "paypal",
      operationType: "payment.capture",
      providerObjectId: "CAP-1",
    });

    const finalized = finalizeOperationContext(base, {
      durationMs: 42,
      normalizedOutcome: "succeeded",
      providerRequestId: "req_final",
      attemptNumber: 1,
    });

    expect(finalized.durationMs).toBe(42);
    expect(finalized.normalizedOutcome).toBe("succeeded");
    expect(finalized.providerRequestId).toBe("req_final");
    expect(finalized.providerObjectId).toBe("CAP-1");
    expect(finalized.attemptNumber).toBe(1);

    // Base unchanged
    expect("durationMs" in base).toBe(false);
    expect("providerRequestId" in base).toBe(false);
  });

  it.skip("omits absent patch keys (EOPT-safe)", () => {
    const base = createOperationContext({
      operationId: "op_4",
      gateway: "paymob",
      operationType: "payment.void",
    });
    const finalized = finalizeOperationContext(base, {});
    expect(Object.keys(finalized).sort()).toEqual([
      "gateway",
      "operationId",
      "operationType",
    ]);
  });

  it.skip("overwrites existing optional fields from patch", () => {
    const base = createOperationContext({
      operationId: "op_5",
      gateway: "stripe",
      operationType: "payment.create",
      attemptNumber: 1,
      providerRequestId: "req_old",
    });
    const finalized = finalizeOperationContext(base, {
      attemptNumber: 3,
      providerRequestId: "req_new",
      retry: true,
    });
    expect(finalized.attemptNumber).toBe(3);
    expect(finalized.providerRequestId).toBe("req_new");
    expect(finalized.retry).toBe(true);
  });
});

describe.skip("operationContextToTelemetryData", () => {
  it.skip("includes required fields and present optionals including providerRequestId", () => {
    const ctx = finalizeOperationContext(
      createOperationContext({
        operationId: "op_6",
        gateway: "stripe",
        operationType: "payment.create",
        tenant: "t1",
        providerRequestId: "req_debug_1",
        providerObjectId: "pi_123",
        internalReference: "ord_1",
      }),
      { durationMs: 15, normalizedOutcome: "succeeded" },
    );

    const data = operationContextToTelemetryData(ctx);
    expect(data.operationId).toBe("op_6");
    expect(data.gateway).toBe("stripe");
    expect(data.operationType).toBe("payment.create");
    expect(data.providerRequestId).toBe("req_debug_1");
    expect(data.providerObjectId).toBe("pi_123");
    expect(data.internalReference).toBe("ord_1");
    expect(data.tenant).toBe("t1");
    expect(data.durationMs).toBe(15);
    expect(data.normalizedOutcome).toBe("succeeded");
    expect("namespace" in data).toBe(false);
    expect("retry" in data).toBe(false);
  });
});

describe.skip("OperationContext + createRedactingTelemetrySink", () => {
  it.skip("round-trips providerRequestId and diagnostic keys through redacting sink", () => {
    const emitted: Array<{ event: string; data?: Record<string, unknown> }> =
      [];
    const sink: TelemetrySink = {
      emit(event, data) {
        emitted.push(
          data === undefined ? { event } : { event, data: { ...data } },
        );
      },
    };

    const redacting = createRedactingTelemetrySink(sink);
    const ctx: OperationContext = createOperationContext({
      operationId: "op_7",
      gateway: "stripe",
      operationType: "payment.webhook.process",
      providerRequestId: "req_visible",
      providerObjectId: "evt_1",
      namespace: "live",
      attemptNumber: 1,
      inboxEventKey: "inbox:evt_1",
      tenant: "acme",
    });

    redacting.emit?.(
      "payment.operation",
      operationContextToTelemetryData(
        finalizeOperationContext(ctx, {
          durationMs: 8,
          normalizedOutcome: "succeeded",
        }),
      ),
    );

    expect(emitted).toHaveLength(1);
    const data = emitted[0]!.data!;
    expect(data.providerRequestId).toBe("req_visible");
    expect(data.providerObjectId).toBe("evt_1");
    expect(data.operationId).toBe("op_7");
    expect(data.operationType).toBe("payment.webhook.process");
    expect(data.namespace).toBe("live");
    expect(data.attemptNumber).toBe(1);
    expect(data.inboxEventKey).toBe("inbox:evt_1");
    expect(data.tenant).toBe("acme");
    expect(data.durationMs).toBe(8);
    expect(data.normalizedOutcome).toBe("succeeded");
  });

  it.skip("strips secrets / card / token while keeping allowlisted diagnostics", () => {
    const emitted: Array<Record<string, unknown> | undefined> = [];
    const sink: TelemetrySink = {
      emit(_event, data) {
        emitted.push(data);
      },
    };
    const redacting = createRedactingTelemetrySink(sink);

    redacting.emit?.("payment.operation", {
      providerRequestId: "req_ok",
      cardNumber: "4242424242424242",
      token: "tok_secret",
      secretKey: "sk_live_xxx",
      clientSecret: "cs_live_xxx",
      authorization: "Bearer secret",
      customerEmail: "a@b.com",
      attemptNumber: 2,
      namespace: "staging",
      inboxEventKey: "key:1",
    });

    const data = emitted[0]!;
    expect(data.providerRequestId).toBe("req_ok");
    expect(data.attemptNumber).toBe(2);
    expect(data.namespace).toBe("staging");
    expect(data.inboxEventKey).toBe("key:1");
    expect(data.cardNumber).toBe("[REDACTED]");
    expect(data.token).toBe("[REDACTED]");
    expect(data.secretKey).toBe("[REDACTED]");
    expect(data.clientSecret).toBe("[REDACTED]");
    expect(data.authorization).toBe("[REDACTED]");
    expect(data.customerEmail).toBe("[REDACTED]");
  });

  it.skip("forwards emit without data when data is omitted", () => {
    const events: string[] = [];
    const sawData: boolean[] = [];
    const sink: TelemetrySink = {
      emit(event, data) {
        events.push(event);
        sawData.push(data !== undefined);
      },
    };
    createRedactingTelemetrySink(sink).emit?.("heartbeat");
    expect(events).toEqual(["heartbeat"]);
    expect(sawData).toEqual([false]);
  });
});
