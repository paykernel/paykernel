import { describe, it, expect } from "bun:test";
import {
  PAYMENT_SPAN_NAMES,
  createNoopTracer,
  spanNameForOperationType,
} from "./spans";

describe("PAYMENT_SPAN_NAMES", () => {
  it("includes all roadmap 20.2 span names", () => {
    expect(PAYMENT_SPAN_NAMES.create).toBe("payment.create");
    expect(PAYMENT_SPAN_NAMES.capture).toBe("payment.capture");
    expect(PAYMENT_SPAN_NAMES.refund).toBe("payment.refund");
    expect(PAYMENT_SPAN_NAMES.void).toBe("payment.void");
    expect(PAYMENT_SPAN_NAMES.webhookVerify).toBe("payment.webhook.verify");
    expect(PAYMENT_SPAN_NAMES.webhookClaim).toBe("payment.webhook.claim");
    expect(PAYMENT_SPAN_NAMES.webhookProcess).toBe("payment.webhook.process");
    expect(PAYMENT_SPAN_NAMES.reconcile).toBe("payment.reconcile");
    expect(PAYMENT_SPAN_NAMES.storeClaim).toBe("payment.store.claim");
  });
});

describe("createNoopTracer", () => {
  it("starts and ends spans without throwing", () => {
    const tracer = createNoopTracer();
    const span = tracer.startSpan("payment.create", { gateway: "stripe" });
    span.setAttribute("x", 1);
    span.recordException?.(new Error("e"));
    span.end({ code: "ok" });
    span.end({ code: "error", message: "fail" });
  });
});

describe("spanNameForOperationType", () => {
  it("passes through roadmap and custom operation types unchanged", () => {
    expect(spanNameForOperationType("payment.create")).toBe("payment.create");
    expect(spanNameForOperationType("payment.store.claim")).toBe(
      "payment.store.claim",
    );
    expect(spanNameForOperationType("payment.custom.foo")).toBe(
      "payment.custom.foo",
    );
  });
});
