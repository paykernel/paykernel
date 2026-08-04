import { describe, it, expect } from "bun:test";
import {
  METRIC_NAMES,
  PAYMENT_METRICS_KEYS,
  createInMemoryPaymentMetrics,
  createNoopPaymentMetrics,
  type PaymentMetrics,
} from "./metrics";

describe("createInMemoryPaymentMetrics", () => {
  it("exposes every 20.3 PaymentMetrics instrument", () => {
    const m = createInMemoryPaymentMetrics();
    for (const key of PAYMENT_METRICS_KEYS) {
      expect(m[key], `missing instrument: ${key}`).toBeDefined();
    }
    // Explicit list from roadmap 20.3 / task contract
    const required: Array<keyof PaymentMetrics> = [
      "operationOutcomes",
      "providerLatencyMs",
      "rateLimits",
      "retries",
      "webhookDuplicates",
      "payloadConflicts",
      "handlerFailures",
      "expiredLeases",
      "reclaimedLeases",
      "reconciliationDrift",
      "indeterminateOperations",
      "adapterLatencyMs",
      "adapterErrors",
    ];
    expect(PAYMENT_METRICS_KEYS.length).toBe(required.length);
    for (const k of required) {
      expect(m[k]).toBeDefined();
    }
  });

  it("records counters and histograms; snapshot aggregates", () => {
    const m = createInMemoryPaymentMetrics();

    m.operationOutcomes.add(1, {
      gateway: "stripe",
      operationType: "payment.create",
      outcome: "succeeded",
    });
    m.operationOutcomes.add(1, {
      gateway: "stripe",
      operationType: "payment.create",
      outcome: "failed",
    });
    m.providerLatencyMs.record(42, {
      gateway: "stripe",
      operationType: "payment.create",
    });
    m.providerLatencyMs.record(10, {
      gateway: "stripe",
      operationType: "payment.create",
    });
    m.rateLimits.add(1, { gateway: "stripe" });
    m.retries.add(2, { gateway: "stripe", operationType: "payment.capture" });
    m.webhookDuplicates.add(1);
    m.payloadConflicts.add(1);
    m.handlerFailures.add(1);
    m.expiredLeases.add(1);
    m.reclaimedLeases.add(3);
    m.reconciliationDrift.add(1, { gateway: "moyasar" });
    m.indeterminateOperations.add(1, {
      gateway: "stripe",
      operationType: "payment.create",
    });
    m.adapterLatencyMs.record(5, { adapter: "postgres", operation: "claim" });
    m.adapterErrors.add(1, { adapter: "redis", errorKind: "timeout" });

    const snap = m.snapshot();
    expect(snap.counters[METRIC_NAMES.operationOutcomes]).toBe(2);
    expect(snap.counters[METRIC_NAMES.rateLimits]).toBe(1);
    expect(snap.counters[METRIC_NAMES.retries]).toBe(2);
    expect(snap.counters[METRIC_NAMES.webhookDuplicates]).toBe(1);
    expect(snap.counters[METRIC_NAMES.payloadConflicts]).toBe(1);
    expect(snap.counters[METRIC_NAMES.handlerFailures]).toBe(1);
    expect(snap.counters[METRIC_NAMES.expiredLeases]).toBe(1);
    expect(snap.counters[METRIC_NAMES.reclaimedLeases]).toBe(3);
    expect(snap.counters[METRIC_NAMES.reconciliationDrift]).toBe(1);
    expect(snap.counters[METRIC_NAMES.indeterminateOperations]).toBe(1);
    expect(snap.counters[METRIC_NAMES.adapterErrors]).toBe(1);
    expect(snap.histograms[METRIC_NAMES.providerLatencyMs]).toEqual([42, 10]);
    expect(snap.histograms[METRIC_NAMES.adapterLatencyMs]).toEqual([5]);

    const outcomeSamples = snap.samples.filter(
      (s) => s.name === METRIC_NAMES.operationOutcomes,
    );
    expect(outcomeSamples).toHaveLength(2);
    expect(outcomeSamples[0]!.attributes?.outcome).toBe("succeeded");
    expect(outcomeSamples[1]!.attributes?.outcome).toBe("failed");
  });

  it("reset clears samples", () => {
    const m = createInMemoryPaymentMetrics();
    m.rateLimits.add(1, { gateway: "x" });
    expect(m.snapshot().samples.length).toBe(1);
    m.reset();
    expect(m.snapshot().samples.length).toBe(0);
    expect(m.snapshot().counters).toEqual({});
  });

  it("METRIC_NAMES are stable non-empty strings", () => {
    for (const [key, name] of Object.entries(METRIC_NAMES)) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(name.startsWith("payments."), `bad prefix for ${key}`).toBe(true);
    }
  });
});

describe("createNoopPaymentMetrics", () => {
  it("accepts all instrument calls without throwing", () => {
    const m = createNoopPaymentMetrics();
    m.operationOutcomes.add(1, { gateway: "g", operationType: "t", outcome: "ok" });
    m.providerLatencyMs.record(1, { gateway: "g", operationType: "t" });
    m.rateLimits.add(1);
    m.retries.add(1);
    m.webhookDuplicates.add(1);
    m.payloadConflicts.add(1);
    m.handlerFailures.add(1);
    m.expiredLeases.add(1);
    m.reclaimedLeases.add(1);
    m.reconciliationDrift.add(1);
    m.indeterminateOperations.add(1);
    m.adapterLatencyMs.record(1);
    m.adapterErrors.add(1);
  });
});
