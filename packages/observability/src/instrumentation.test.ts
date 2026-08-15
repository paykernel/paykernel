import { describe, it, expect } from "bun:test";
import type { Clock, TelemetrySink } from "@paykernel/core";
import {
  createOperationContext,
  createInMemoryPaymentMetrics,
  createNoopTracer,
  METRIC_NAMES,
  recordPaymentOperation,
  sanitizeExceptionForSpan,
  withPaymentOperation,
  type PaymentSpan,
  type PaymentTracer,
} from "./index";

function fakeClock(sequence: number[]): Clock {
  let i = 0;
  return {
    now: () => new Date(sequence[Math.min(i, sequence.length - 1)]!),
    nowMs: () => {
      const v = sequence[Math.min(i, sequence.length - 1)]!;
      i += 1;
      return v;
    },
  };
}

function recordingTracer(): {
  tracer: PaymentTracer;
  spans: Array<{
    name: string;
    attributes: Record<string, string | number | boolean>;
    status?: { code: string; message?: string };
  }>;
} {
  const spans: Array<{
    name: string;
    attributes: Record<string, string | number | boolean>;
    status?: { code: string; message?: string };
  }> = [];
  const tracer: PaymentTracer = {
    startSpan(name, attributes) {
      const rec = {
        name,
        attributes: { ...(attributes ?? {}) },
        status: undefined as { code: string; message?: string } | undefined,
      };
      spans.push(rec);
      const span: PaymentSpan = {
        end(status) {
          if (status !== undefined) {
            rec.status = status.message !== undefined
              ? { code: status.code, message: status.message }
              : { code: status.code };
          }
        },
        setAttribute(k, v) {
          rec.attributes[k] = v;
        },
        recordException() {},
      };
      return span;
    },
  };
  return { tracer, spans };
}

describe("withPaymentOperation", () => {
  it("records latency histogram + outcome counter", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const ctx = createOperationContext({
      operationId: "op_1",
      gateway: "stripe",
      operationType: "payment.create",
    });

    const { result, durationMs, context } = await withPaymentOperation(
      {
        context: ctx,
        metrics,
        clock: fakeClock([1000, 1042]),
        tracer: createNoopTracer(),
      },
      async () => ({
        result: { id: "pi_1" },
        contextPatch: {
          normalizedOutcome: "succeeded",
          providerObjectId: "pi_1",
          providerRequestId: "req_abc",
        },
      }),
    );

    expect(result).toEqual({ id: "pi_1" });
    expect(durationMs).toBe(42);
    expect(context.durationMs).toBe(42);
    expect(context.normalizedOutcome).toBe("succeeded");
    expect(context.providerRequestId).toBe("req_abc");

    const snap = metrics.snapshot();
    expect(snap.histograms[METRIC_NAMES.providerLatencyMs]).toEqual([42]);
    const outcomes = snap.samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.attributes).toEqual({
      gateway: "stripe",
      operationType: "payment.create",
      outcome: "succeeded",
    });
  });

  it("counts indeterminate separately and keeps outcome label", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_ind",
      gateway: "paymob",
      operationType: "payment.create",
    });

    await withPaymentOperation(
      { context: ctx, metrics, tracer, clock: fakeClock([0, 5]) },
      async () => ({
        result: null,
        contextPatch: {
          normalizedOutcome: "indeterminate",
          reconciliationRequired: true,
        },
      }),
    );

    const snap = metrics.snapshot();
    const outcomes = snap.samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes[0]!.attributes?.outcome).toBe("indeterminate");
    expect(snap.counters[METRIC_NAMES.indeterminateOperations]).toBe(1);
    // OBS-3: create + reconRequired is not proven money drift — no drift count
    expect(snap.counters[METRIC_NAMES.reconciliationDrift] ?? 0).toBe(0);
    // Must not collapse indeterminate into a synthetic "failed" only label
    expect(
      outcomes.every((o) => o.attributes?.outcome !== "failed"),
    ).toBe(true);
    // OBS-1: non-throw indeterminate must not end span OK
    expect(spans[0]!.status?.code).toBe("error");
    expect(spans[0]!.status?.message).toBe("indeterminate");
  });

  it("counts reconciliationDrift only on proven money recon path (OBS-3)", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const ctx = createOperationContext({
      operationId: "op_recon_drift",
      gateway: "stripe",
      operationType: "payment.reconcile",
    });

    await withPaymentOperation(
      {
        context: ctx,
        metrics,
        clock: fakeClock([0, 3]),
        countReconciliationDrift: true,
      },
      async () => ({
        result: { drifted: true },
        contextPatch: {
          normalizedOutcome: "succeeded",
          reconciliationRequired: true,
        },
      }),
    );

    expect(metrics.snapshot().counters[METRIC_NAMES.reconciliationDrift]).toBe(
      1,
    );

    // Same flag on create still does not count as money drift
    const metrics2 = createInMemoryPaymentMetrics();
    await withPaymentOperation(
      {
        context: createOperationContext({
          operationId: "op_create_recon",
          gateway: "stripe",
          operationType: "payment.create",
        }),
        metrics: metrics2,
        clock: fakeClock([0, 1]),
        countReconciliationDrift: true,
      },
      async () => ({
        result: true,
        contextPatch: {
          normalizedOutcome: "indeterminate",
          reconciliationRequired: true,
        },
      }),
    );
    expect(
      metrics2.snapshot().counters[METRIC_NAMES.reconciliationDrift] ?? 0,
    ).toBe(0);
  });

  it("ends span error when normalizedOutcome is omitted (OBS-1)", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_no_outcome",
      gateway: "stripe",
      operationType: "payment.create",
    });

    await withPaymentOperation(
      { context: ctx, metrics, tracer, clock: fakeClock([0, 2]) },
      async () => ({ result: { id: "pi_x" } }),
    );

    expect(spans[0]!.status?.code).toBe("error");
    expect(spans[0]!.status?.message).toBe("unknown");
    const outcomes = metrics.snapshot().samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes[0]!.attributes?.outcome).toBe("unknown");
  });

  it("ends span error for non-throw failed outcomes (OBS-1)", async () => {
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_fail_span",
      gateway: "stripe",
      operationType: "payment.capture",
    });

    await withPaymentOperation(
      { context: ctx, tracer, clock: fakeClock([0, 2]) },
      async () => ({
        result: { ok: false },
        contextPatch: { normalizedOutcome: "failed" },
      }),
    );

    expect(spans[0]!.status?.code).toBe("error");
    expect(spans[0]!.status?.message).toBe("failed");

    const { tracer: t2, spans: s2 } = recordingTracer();
    await withPaymentOperation(
      {
        context: createOperationContext({
          operationId: "op_ok_span",
          gateway: "stripe",
          operationType: "payment.create",
        }),
        tracer: t2,
        clock: fakeClock([0, 1]),
      },
      async () => ({
        result: true,
        contextPatch: { normalizedOutcome: "succeeded" },
      }),
    );
    expect(s2[0]!.status?.code).toBe("ok");

    // requires_action is not a failure — still OK
    const { tracer: t3, spans: s3 } = recordingTracer();
    await withPaymentOperation(
      {
        context: createOperationContext({
          operationId: "op_ra_span",
          gateway: "stripe",
          operationType: "payment.create",
        }),
        tracer: t3,
        clock: fakeClock([0, 1]),
      },
      async () => ({
        result: true,
        contextPatch: { normalizedOutcome: "requires_action" },
      }),
    );
    expect(s3[0]!.status?.code).toBe("ok");
  });

  it("emits redacted telemetry including providerRequestId", async () => {
    const emitted: Array<{ event: string; data?: Record<string, unknown> }> =
      [];
    const telemetry: TelemetrySink = {
      emit(event, data) {
        emitted.push(
          data === undefined ? { event } : { event, data: { ...data } },
        );
      },
    };

    const ctx = createOperationContext({
      operationId: "op_tel",
      gateway: "stripe",
      operationType: "payment.capture",
    });

    await withPaymentOperation(
      {
        context: ctx,
        telemetry,
        clock: fakeClock([10, 20]),
      },
      async () => ({
        result: true,
        contextPatch: {
          normalizedOutcome: "succeeded",
          providerRequestId: "req_visible",
        },
      }),
    );

    // Also verify secrets on contextPatch path would be scrubbed if someone
    // stuffed them into telemetry via operationContextToTelemetryData only —
    // here we emit context fields only (no secrets).
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe("payment.operation");
    expect(emitted[0]!.data?.providerRequestId).toBe("req_visible");
    expect(emitted[0]!.data?.operationId).toBe("op_tel");
    expect(emitted[0]!.data?.durationMs).toBe(10);
  });

  it("emits errorName on failure without error.message (secret-safe)", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const telemetry: TelemetrySink = {
      emit(_e, data) {
        seen.push(data);
      },
    };
    const ctx = createOperationContext({
      operationId: "op_err_tel",
      gateway: "stripe",
      operationType: "payment.refund",
    });
    await expect(
      withPaymentOperation(
        { context: ctx, telemetry, clock: fakeClock([0, 1]) },
        async () => {
          throw new Error("sk_live_should_never_land_in_telemetry");
        },
      ),
    ).rejects.toThrow(/sk_live/);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.errorName).toBe("Error");
    expect(seen[0]?.errorMessage).toBeUndefined();
    expect(JSON.stringify(seen[0])).not.toContain("sk_live");
    // OBS-2: throws default to indeterminate (transport-ambiguous), not failed
    expect(seen[0]?.normalizedOutcome).toBe("indeterminate");
  });

  it("redacts secret-shaped internalReference before custom tracers see span attrs (P20-TRACER)", async () => {
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_secret_ref",
      gateway: "stripe",
      operationType: "payment.create",
      internalReference: "sk_live_abc123secret",
    });

    await withPaymentOperation(
      { context: ctx, tracer, clock: fakeClock([0, 1]) },
      async () => ({
        result: true,
        contextPatch: { normalizedOutcome: "succeeded" },
      }),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes.internalReference).toBe("[REDACTED]");
    expect(JSON.stringify(spans[0]!.attributes)).not.toContain("sk_live");
    expect(JSON.stringify(spans[0]!.attributes)).not.toContain("abc123secret");
  });

  it("starts span with operation type name and ends ok", async () => {
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_span",
      gateway: "stripe",
      operationType: "payment.webhook.process",
      providerRequestId: "req_w",
    });

    await withPaymentOperation(
      { context: ctx, tracer, clock: fakeClock([0, 3]) },
      async () => ({
        result: "ok",
        contextPatch: { normalizedOutcome: "succeeded" },
      }),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("payment.webhook.process");
    expect(spans[0]!.status?.code).toBe("ok");
    expect(spans[0]!.attributes.providerRequestId).toBe("req_w");
    expect(spans[0]!.attributes.durationMs).toBe(3);
  });

  it("re-throws errors, marks span error, outcome indeterminate", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_err",
      gateway: "stripe",
      operationType: "payment.void",
    });

    await expect(
      withPaymentOperation(
        { context: ctx, metrics, tracer, clock: fakeClock([0, 9]) },
        async () => {
          throw new Error("provider down");
        },
      ),
    ).rejects.toThrow("provider down");

    expect(spans[0]!.status?.code).toBe("error");
    const outcomes = metrics.snapshot().samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes[0]!.attributes?.outcome).toBe("indeterminate");
    expect(metrics.snapshot().counters[METRIC_NAMES.indeterminateOperations]).toBe(
      1,
    );
    // OBS-3: transport-ambiguous throw sets reconRequired but does not count
    // money drift (void is not payment.reconcile).
    expect(
      metrics.snapshot().counters[METRIC_NAMES.reconciliationDrift] ?? 0,
    ).toBe(0);
  });

  it("classifies CardDeclinedError throw as declined not indeterminate (OBS-2)", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const { tracer, spans } = recordingTracer();
    const ctx = createOperationContext({
      operationId: "op_decline",
      gateway: "stripe",
      operationType: "payment.create",
    });

    class CardDeclinedError extends Error {
      constructor() {
        super("card declined");
        this.name = "CardDeclinedError";
      }
    }

    await expect(
      withPaymentOperation(
        { context: ctx, metrics, tracer, clock: fakeClock([0, 4]) },
        async () => {
          throw new CardDeclinedError();
        },
      ),
    ).rejects.toThrow(/card declined/);

    expect(spans[0]!.status?.code).toBe("error");
    const outcomes = metrics.snapshot().samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes[0]!.attributes?.outcome).toBe("declined");
    // Definitive decline must not increment indeterminate counter
    expect(
      metrics.snapshot().counters[METRIC_NAMES.indeterminateOperations] ?? 0,
    ).toBe(0);
    // Definitive decline is not recon work
    expect(
      metrics.snapshot().counters[METRIC_NAMES.reconciliationDrift] ?? 0,
    ).toBe(0);
  });

  it("classifies InvalidRequestError throw as failed (OBS-2)", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const ctx = createOperationContext({
      operationId: "op_invalid",
      gateway: "mock",
      operationType: "payment.capture",
    });

    class InvalidRequestError extends Error {
      constructor() {
        super("over-capture");
        this.name = "InvalidRequestError";
      }
    }

    await expect(
      withPaymentOperation(
        { context: ctx, metrics, clock: fakeClock([0, 2]) },
        async () => {
          throw new InvalidRequestError();
        },
      ),
    ).rejects.toThrow(/over-capture/);

    const outcomes = metrics.snapshot().samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomes[0]!.attributes?.outcome).toBe("failed");
    expect(
      metrics.snapshot().counters[METRIC_NAMES.indeterminateOperations] ?? 0,
    ).toBe(0);
  });

  it("sanitizes recordException — name only, no secret message (OBS-1)", async () => {
    const exceptions: unknown[] = [];
    const tracer: PaymentTracer = {
      startSpan(name) {
        return {
          end() {},
          setAttribute() {},
          recordException(error: unknown) {
            exceptions.push(error);
          },
        };
      },
    };
    const ctx = createOperationContext({
      operationId: "op_san",
      gateway: "stripe",
      operationType: "payment.create",
    });

    await expect(
      withPaymentOperation(
        { context: ctx, tracer, clock: fakeClock([0, 1]) },
        async () => {
          throw new Error("Bearer sk_live_SHOULD_NOT_EXPORT");
        },
      ),
    ).rejects.toThrow(/sk_live/);

    expect(exceptions).toHaveLength(1);
    const ex = exceptions[0] as { name?: string; message?: string; code?: string };
    expect(ex.name).toBe("Error");
    expect(ex.message).toBeUndefined();
    expect(JSON.stringify(exceptions[0])).not.toContain("sk_live");
  });

  it("supports plain (non-wrapped) return values", async () => {
    const ctx = createOperationContext({
      operationId: "op_plain",
      gateway: "g",
      operationType: "payment.create",
    });
    const { result, context } = await withPaymentOperation(
      { context: ctx, clock: fakeClock([0, 1]) },
      async () => 42,
    );
    expect(result).toBe(42);
    expect(context.durationMs).toBe(1);
    expect(context.normalizedOutcome).toBeUndefined();
  });

  it("increments retries when context.retry is set on finalize", async () => {
    const metrics = createInMemoryPaymentMetrics();
    const ctx = createOperationContext({
      operationId: "op_r",
      gateway: "stripe",
      operationType: "payment.create",
      attemptNumber: 2,
    });
    await withPaymentOperation(
      { context: ctx, metrics, clock: fakeClock([0, 1]) },
      async () => ({
        result: true,
        contextPatch: { normalizedOutcome: "succeeded", retry: true },
      }),
    );
    expect(metrics.snapshot().counters[METRIC_NAMES.retries]).toBe(1);
  });
});

describe("sanitizeExceptionForSpan", () => {
  it("keeps name/code only — strips message and free-form strings", () => {
    const err = new Error("sk_live_secret_in_message");
    const sanitized = sanitizeExceptionForSpan(err);
    expect(sanitized).toEqual({ name: "Error" });
    expect(JSON.stringify(sanitized)).not.toContain("sk_live");

    class CodedError extends Error {
      code = "CARD_DECLINED";
      constructor() {
        super("pan 4242");
        this.name = "CardDeclinedError";
      }
    }
    expect(sanitizeExceptionForSpan(new CodedError())).toEqual({
      name: "CardDeclinedError",
      code: "CARD_DECLINED",
    });
    expect(sanitizeExceptionForSpan("raw string secret")).toEqual({
      name: "Error",
    });
  });

  it("drops secret-shaped error codes so sk_live_x never appears (P20-ERROR-CODE)", () => {
    class SecretCodeError extends Error {
      code = "sk_live_x";
      constructor() {
        super("card declined");
        this.name = "GatewayApiError";
      }
    }
    const sanitized = sanitizeExceptionForSpan(new SecretCodeError());
    expect(sanitized.name).toBe("GatewayApiError");
    expect(sanitized.code).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("sk_live");
    expect(JSON.stringify(sanitized)).not.toContain("sk_live_x");
  });
});

describe("recordPaymentOperation", () => {
  it("finalizes duration and records metrics without running fn", () => {
    const metrics = createInMemoryPaymentMetrics();
    const ctx = createOperationContext({
      operationId: "op_rec",
      gateway: "moyasar",
      operationType: "payment.reconcile",
    });
    const finished = recordPaymentOperation({
      context: ctx,
      metrics,
      durationMs: 15,
      normalizedOutcome: "indeterminate",
    });
    expect(finished.durationMs).toBe(15);
    expect(finished.normalizedOutcome).toBe("indeterminate");
    const snap = metrics.snapshot();
    expect(snap.counters[METRIC_NAMES.indeterminateOperations]).toBe(1);
    expect(snap.histograms[METRIC_NAMES.providerLatencyMs]).toEqual([15]);
  });
});
