import { describe, expect, it } from "bun:test";
import {
  CardDeclinedError,
  InvalidRequestError,
  NetworkError,
  defineGatewayCapabilities,
  isIndeterminateOutcome,
  isPaidOutcome,
  isPaymentEvent,
  isPaymentSucceededEvent,
  isRequiresActionOutcome,
  money,
  toMinorUnits,
  minorAmountToNumber,
  PAYMENT_EVENT_SCHEMA_VERSION,
} from "@paykernel/core";
import {
  mockGateway,
  majorToMinor,
  minorToMajor,
  withDuplicateWebhook,
  outOfOrderWebhooks,
  generateDuplicateWebhooks,
  generateOutOfOrderWebhooks,
  generateWebhookEvent,
  mockPayloadToWebhookEvent,
  createMockWebhookPayload,
  signWebhook,
  computeMockWebhookSignature,
  createFakeClock,
  paymentStatusToOperationOutcome,
} from "../index";

const baseCreate = {
  amount: 10,
  currency: "USD" as const,
  callbackUrl: "https://ex.test/cb",
};

describe("paymentStatusToOperationOutcome", () => {
  it("maps paid → succeeded and approved → requires_action (not paid-like)", () => {
    expect(paymentStatusToOperationOutcome("paid")).toBe("succeeded");
    expect(paymentStatusToOperationOutcome("approved")).toBe("requires_action");
    expect(paymentStatusToOperationOutcome("pending")).toBe("requires_action");
    expect(paymentStatusToOperationOutcome("authorized")).toBe("succeeded");
  });
});

describe("mockGateway", () => {
  it("scripts outcomes FIFO", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "requires_action" }, { outcome: "succeeded" }],
    });
    const a = await g.createPayment({
      amount: 10,
      currency: "SAR",
      callbackUrl: "https://ex.test/cb",
    });
    expect(a.status).toBe("pending");
    expect(a.redirectUrl).toBeTruthy();
    expect(a.outcome).toBe("requires_action");
    expect(a.success).toBe(true); // deprecated dual-write; not paid
    expect(isRequiresActionOutcome(a)).toBe(true);
    expect(isPaidOutcome(a)).toBe(false);
    expect(a.references?.providerObjectId).toBe(a.gatewayId);
    expect(a.references?.gateway).toBe("mock");
    const b = await g.createPayment({
      amount: 10,
      currency: "SAR",
      callbackUrl: "https://ex.test/cb",
    });
    expect(b.status).toBe("paid");
    expect(b.outcome).toBe("succeeded");
    expect(isPaidOutcome(b)).toBe(true);
    expect(b.references?.normalizedStatus).toBe("paid");
  });

  it("replays last step after queue exhaustion", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "declined" }],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      CardDeclinedError,
    );
    // Last step replayed
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      CardDeclinedError,
    );
  });

  it("uses explicit defaultOutcome when queues empty", async () => {
    const g = mockGateway({
      defaultOutcome: { outcome: "requires_action" },
    });
    const r = await g.createPayment(baseCreate);
    expect(r.status).toBe("pending");
    expect(r.redirectUrl).toBeTruthy();
    expect(r.outcome).toBe("requires_action");
    expect(isPaidOutcome(r)).toBe(false);
  });

  it("maps declines and records history with error summary", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "declined" }],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      CardDeclinedError,
    );
    expect(g.history.some((h) => h.operation === "createPayment")).toBe(true);
    const rec = g.history.find((h) => h.operation === "createPayment");
    expect(rec?.error?.name).toBe("CardDeclinedError");
  });

  it("provider_ok_client_timeout dual outcome records ledger success", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "provider_ok_client_timeout" }],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
    const side = g.getLastProviderSideSuccess();
    expect(side?.success).toBe(true);
    expect(side?.status).toBe("paid");
    expect(side?.outcome).toBe("succeeded");
    expect(side?.references?.providerObjectId).toBe(side?.gatewayId);
    // Provider-side payment exists for reconciliation
    expect(g.getPaymentState(side!.gatewayId)?.status).toBe("paid");
  });

  it("accepts provider_success_client_timeout alias", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "provider_success_client_timeout" }],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(g.getLastProviderSideSuccess()?.success).toBe(true);
    expect(g.getLastProviderSideSuccess()?.outcome).toBe("succeeded");
  });

  it("indeterminate outcome is Phase 6 arm, never decline/paid", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "indeterminate" }],
    });
    const r = await g.createPayment(baseCreate);
    expect(r.outcome).toBe("indeterminate");
    expect(r.success).toBe(false); // dual-write — do not treat as decline
    expect(r.status).toBe("processing");
    expect(r.reconciliationRequired).toBe(true);
    expect(isIndeterminateOutcome(r)).toBe(true);
    expect(isPaidOutcome(r)).toBe(false);
    expect(r.references?.providerObjectId).toBe(r.gatewayId);
    const raw = r.rawResponse as {
      reconciliationRequired?: boolean;
      error?: { code?: string };
    };
    expect(raw.reconciliationRequired).toBe(true);
    expect(raw.error?.code).toBe("INDETERMINATE");
  });

  it("failed outcome is definitive success:false status failed", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "failed" }],
    });
    const r = await g.createPayment(baseCreate);
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("failed");
    expect(r.status).toBe("failed");
    expect(isPaidOutcome(r)).toBe(false);
    expect(r.references?.normalizedStatus).toBe("failed");
    // Ledger must be honest failed — never leave paid + full capture hanging
    const state = g.getPaymentState(r.gatewayId);
    expect(state).toBeDefined();
    expect(state!.status).toBe("failed");
    expect(state!.status).not.toBe("paid");
    expect(state!.capturedAmount).toBe(0);
    expect(state!.authorized).toBe(false);
  });

  it("default/succeeded createPayment still writes paid ledger", async () => {
    const gDefault = mockGateway();
    const d = await gDefault.createPayment(baseCreate);
    expect(d.success).toBe(true);
    expect(d.status).toBe("paid");
    const dState = gDefault.getPaymentState(d.gatewayId);
    expect(dState?.status).toBe("paid");
    expect(dState?.capturedAmount).toBe(10);
    expect(dState?.authorized).toBe(false);

    const gScripted = mockGateway({
      createPayment: [{ outcome: "succeeded" }],
    });
    const s = await gScripted.createPayment(baseCreate);
    expect(s.success).toBe(true);
    expect(s.status).toBe("paid");
    const sState = gScripted.getPaymentState(s.gatewayId);
    expect(sState?.status).toBe("paid");
    expect(sState?.capturedAmount).toBe(10);
  });

  it("throw form steps", async () => {
    const g = mockGateway({
      createPayment: [
        { throw: "abort" },
        { throw: new Error("custom boom") },
      ],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
    await expect(g.createPayment(baseCreate)).rejects.toThrow("custom boom");
  });

  it("delayMs alias and FakeClock virtual latency", async () => {
    const clock = createFakeClock({ initialMs: 1_000 });
    const g = mockGateway({
      clock,
      createPayment: [{ outcome: "succeeded", delayMs: 250 }],
    });
    const start = clock.nowMs();
    const r = await g.createPayment(baseCreate);
    expect(r.success).toBe(true);
    expect(r.outcome).toBe("succeeded");
    expect(isPaidOutcome(r)).toBe(true);
    expect(clock.nowMs() - start).toBe(250);
    expect(g.history[0]?.atMs).toBe(1_250);
  });

  it("timeout and network_error throw NetworkError", async () => {
    const g = mockGateway({
      createPayment: [
        { outcome: "timeout" },
        { outcome: "network_error" },
      ],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("timeout does not leave paid ledger", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "timeout" }],
    });
    await expect(g.createPayment(baseCreate)).rejects.toBeInstanceOf(
      NetworkError,
    );
    // Plain timeout never calls provider success path; no paid reconciliation entry
    expect(g.getLastProviderSideSuccess()).toBeUndefined();
    // History records the failed call but no payment ledger was written as paid
    const rec = g.history.find((h) => h.operation === "createPayment");
    expect(rec?.error?.name).toBe("NetworkError");
    expect(rec?.result).toBeUndefined();
    // Known ids from dual-timeout/success paths would be pay_mock_N; timeout still
    // allocates an id internally but must not leave it as paid in the ledger.
    // Probe sequential ids that would exist if fallback had written paid.
    for (let i = 1; i <= 3; i++) {
      const state = g.getPaymentState(`pay_mock_${i}`);
      if (state) {
        expect(state.status).not.toBe("paid");
        expect(state.capturedAmount).toBe(0);
      }
    }
  });

  it("partial capture and refund with remaining tracking", async () => {
    const g = mockGateway({
      capabilities: defineGatewayCapabilities({
        payments: true,
        immediateCapture: true,
        authorization: true,
        partialCapture: true,
        refunds: true,
        partialRefunds: true,
        voids: true,
      }),
    });
    const pay = await g.createPayment({
      amount: 100,
      currency: "USD",
      callbackUrl: "https://ex.test/cb",
      capture: false,
    });
    expect(pay.status).toBe("authorized");
    const cap = await g.capturePayment({
      gatewayPaymentId: pay.gatewayId,
      amount: 40,
      currency: "USD",
    });
    expect(cap.status).toBe("partially_captured");
    const full = await g.capturePayment({
      gatewayPaymentId: pay.gatewayId,
      amount: 60,
      currency: "USD",
    });
    expect(full.status).toBe("paid");
    const ref = await g.refundPayment({
      gatewayPaymentId: pay.gatewayId,
      amount: 10,
      currency: "USD",
    });
    expect(ref.success).toBe(true);
    expect(g.getPaymentState(pay.gatewayId)?.status).toBe("partially_refunded");
  });

  it("rejects over-capture and over-refund", async () => {
    const g = mockGateway();
    const pay = await g.createPayment({
      amount: 50,
      currency: "USD",
      callbackUrl: "https://ex.test/cb",
      capture: false,
    });
    await expect(
      g.capturePayment({
        gatewayPaymentId: pay.gatewayId,
        amount: 51,
        currency: "USD",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    const paid = await g.createPayment({
      amount: 20,
      currency: "USD",
      callbackUrl: "https://ex.test/cb",
      capture: true,
    });
    await expect(
      g.refundPayment({
        gatewayPaymentId: paid.gatewayId,
        amount: 21,
        currency: "USD",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("amount conversion minor units in rawResponse", async () => {
    const g = mockGateway();
    const r = await g.createPayment({
      amount: 10.5,
      currency: "SAR",
      callbackUrl: "https://ex.test/cb",
    });
    const raw = r.rawResponse as { amountMinor: number };
    expect(raw.amountMinor).toBe(majorToMinor(10.5, "SAR"));
    expect(raw.amountMinor).toBe(1050);
    // Shared core bigint path (not silent Math.round float)
    expect(raw.amountMinor).toBe(
      minorAmountToNumber(toMinorUnits(10.5, "SAR")),
    );
  });

  it("majorToMinor / minorToMajor use core money helpers", () => {
    expect(majorToMinor(10.5, "SAR")).toBe(1050);
    expect(majorToMinor(100, "JPY")).toBe(100);
    expect(majorToMinor(1.234, "KWD")).toBe(1234);
    expect(majorToMinor(money("10.50", "SAR"), "SAR")).toBe(1050);
    expect(minorToMajor(1050, "SAR")).toBe(10.5);
    // Strict precision — no silent float rounding
    expect(() => majorToMinor(10.999, "SAR")).toThrow(InvalidRequestError);
    expect(() => majorToMinor(0.1 + 0.2, "SAR")).toThrow(InvalidRequestError);
  });

  it("accepts Money amount input on createPayment", async () => {
    const g = mockGateway();
    const r = await g.createPayment({
      amount: money("10.50", "SAR"),
      currency: "SAR",
      callbackUrl: "https://ex.test/cb",
    });
    expect(r.success).toBe(true);
    expect(r.outcome).toBe("succeeded");
    expect(isPaidOutcome(r)).toBe(true);
    expect(r.amount).toBe(10.5);
    expect(r.references?.gateway).toBe("mock");
    const raw = r.rawResponse as { amountMinor: number };
    expect(raw.amountMinor).toBe(1050);
  });

  it("tracks partial capture remaining in integer minor units", async () => {
    const g = mockGateway({
      capabilities: defineGatewayCapabilities({
        payments: true,
        immediateCapture: true,
        authorization: true,
        partialCapture: true,
        refunds: true,
        partialRefunds: true,
        voids: true,
      }),
    });
    const pay = await g.createPayment({
      amount: money("10.50", "USD"),
      currency: "USD",
      callbackUrl: "https://ex.test/cb",
      capture: false,
    });
    const cap = await g.capturePayment({
      gatewayPaymentId: pay.gatewayId,
      amount: money("4.25", "USD"),
      currency: "USD",
    });
    expect(cap.status).toBe("partially_captured");
    expect(cap.capturedAmount).toBe(4.25);
    const state = g.getPaymentState(pay.gatewayId);
    expect(state?.amount).toBe(10.5);
    expect(state?.capturedAmount).toBe(4.25);
  });

  it("history redacts secrets and assertHistory works", async () => {
    const g = mockGateway();
    await g.createPayment({
      ...baseCreate,
      metadata: {
        note: "ok",
        apiKey: "sk_test_fake_should_redact",
        cardNumber: "4242424242424242",
      },
    });
    const blob = JSON.stringify(g.getHistory());
    expect(blob).not.toContain("sk_test_fake_should_redact");
    expect(blob).not.toContain("4242424242424242");
    expect(blob).toContain("[REDACTED]");

    g.assertHistory([
      {
        operation: "createPayment",
        result: {
          success: true,
          status: "paid",
          outcome: "succeeded",
        },
      },
    ]);
    expect(() =>
      g.assertHistory([{ operation: "refundPayment" }]),
    ).toThrow(/assertHistory/);
  });

  it("webhook HMAC sign / verify / OOO / duplicate", () => {
    const g = mockGateway({ name: "mock" });
    const a = g.buildWebhook({
      id: "e1",
      sequence: 1,
      gatewayPaymentId: "p1",
      status: "paid",
    });
    const b = g.buildWebhook({
      id: "e2",
      sequence: 2,
      gatewayPaymentId: "p1",
      status: "paid",
    });
    expect(a.signature?.startsWith("mocksig_")).toBe(true);
    expect(g.verifyWebhook(a)).toBe(true);
    expect(g.verifyWebhook(a, "bad")).toBe(false);
    expect(g.signWebhook(a)).toBe(
      computeMockWebhookSignature(a, "testkit_mock_secret"),
    );

    // Tampered body.signature alone must not self-verify (HMAC compare only).
    const tampered = { ...a, signature: "mocksig_deadbeef" };
    expect(g.verifyWebhook(tampered)).toBe(false);
    expect(g.verifyWebhook(tampered, "mocksig_deadbeef")).toBe(false);
    // Matching wrong external + body signature still fails vs computed HMAC.
    expect(g.verifyWebhook({ ...a, signature: "x" }, "x")).toBe(false);
    // Correct explicit signature still works
    expect(g.verifyWebhook({ ...a, signature: undefined }, a.signature)).toBe(
      true,
    );

    const dup = withDuplicateWebhook([a, b]);
    expect(dup).toHaveLength(3);
    expect(generateDuplicateWebhooks([a, b])).toHaveLength(3);
    const ooo = outOfOrderWebhooks([a, b]);
    expect(ooo[0]?.sequence).toBe(2);
    expect(generateOutOfOrderWebhooks([a, b])[0]?.sequence).toBe(2);

    const evt = g.parseWebhookEvent(a);
    expect(evt.gateway).toBe("mock");
    expect(evt.status).toBe("paid");
    // Phase 7 dual-write on parseWebhookEvent
    expect(evt.schemaVersion).toBe(PAYMENT_EVENT_SCHEMA_VERSION);
    expect(evt.type).toBe("payment_paid"); // legacy free-form preserved
    expect(evt.stableType).toBe("payment.succeeded");
    expect(evt.event).toBeDefined();
    expect(isPaymentEvent(evt.event)).toBe(true);
    expect(evt.event?.type).toBe("payment.succeeded");
    expect(evt.provider?.eventType).toBe("payment_paid");
    expect(evt.provider?.gateway).toBe("mock");
    expect(typeof evt.provider?.occurredAt).toBe("string");
    expect(typeof evt.provider?.receivedAt).toBe("string");
    expect(evt.rawPayload).toBeDefined();

    const generated = generateWebhookEvent({
      gatewayPaymentId: "p9",
      status: "paid",
      type: "payment_paid",
    });
    expect(generated.signature.startsWith("mocksig_")).toBe(true);
    expect(generated.event.gatewayPaymentId).toBe("p9");
    expect(signWebhook(generated.raw)).toBe(generated.signature);
    expect(generated.event.stableType).toBe("payment.succeeded");
    expect(generated.event.event?.schemaVersion).toBe("1");
  });

  it("Phase 7 dual-write: stable type option and free-form mapping", () => {
    // Stable name as type → PaymentEvent.type matches; free-form type is that name
    const stable = generateWebhookEvent({
      type: "payment.succeeded",
      status: "paid",
      gatewayPaymentId: "pay_stable",
      computePayloadHash: true,
    });
    expect(stable.event.type).toBe("payment.succeeded");
    expect(stable.event.stableType).toBe("payment.succeeded");
    expect(stable.event.event?.type).toBe("payment.succeeded");
    expect(stable.event.schemaVersion).toBe("1");
    expect(stable.event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    if (stable.event.event && isPaymentSucceededEvent(stable.event.event)) {
      expect(stable.event.event.payment.references.gateway).toBe("mock");
      expect(stable.event.event.payment.references.providerObjectId).toBe(
        "pay_stable",
      );
    } else {
      throw new Error("expected payment.succeeded arm");
    }

    // Free-form refund alias
    const refund = mockPayloadToWebhookEvent(
      createMockWebhookPayload({
        type: "payment_refunded",
        status: "refunded",
        gatewayPaymentId: "pay_r1",
      }),
      "mock",
    );
    expect(refund.type).toBe("payment_refunded");
    expect(refund.stableType).toBe("refund.completed");
    expect(refund.event?.type).toBe("refund.completed");
    expect(refund.provider?.eventType).toBe("payment_refunded");

    // Built-in gateway name uses core map (Stripe native → stable)
    const stripeish = generateWebhookEvent({
      gateway: "stripe",
      type: "payment_intent.succeeded",
      status: "paid",
      gatewayPaymentId: "pi_test",
    });
    expect(stripeish.event.type).toBe("payment_intent.succeeded");
    expect(stripeish.event.stableType).toBe("payment.succeeded");
    expect(stripeish.event.provider?.eventType).toBe(
      "payment_intent.succeeded",
    );

    // Unknown free-form → provider.unmapped (no invented stable name)
    const unknown = generateWebhookEvent({
      type: "invoice.paid",
      status: "paid",
    });
    expect(unknown.event.type).toBe("invoice.paid");
    expect(unknown.event.stableType).toBeUndefined();
    expect(unknown.event.event?.type).toBe("provider.unmapped");
  });

  it("history getter returns a frozen snapshot callers cannot mutate", async () => {
    const g = mockGateway();
    await g.createPayment(baseCreate);
    const snap = g.history;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      // @ts-expect-error readonly contract
      snap.push({} as never);
    }).toThrow();
    expect(g.history).toHaveLength(1);
    expect(g.getHistory()).toHaveLength(1);
    expect(Object.isFrozen(g.getHistory())).toBe(true);
  });

  it("rejects malformed webhook parse", () => {
    const g = mockGateway();
    expect(() => g.parseWebhookEvent({})).toThrow();
    expect(() => g.parseWebhookEvent(null)).toThrow();
  });

  it("aborts long latency create via AbortSignal", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "succeeded", latencyMs: 200 }],
    });
    const c = new AbortController();
    const p = g.createPayment({
      amount: 1,
      currency: "USD",
      callbackUrl: "https://ex.test/cb",
      // @ts-expect-error signal is testkit extension
      signal: c.signal,
    });
    c.abort();
    await expect(p).rejects.toBeInstanceOf(NetworkError);
  });

  it("void authorized payment", async () => {
    const g = mockGateway();
    const pay = await g.createPayment({
      ...baseCreate,
      amount: 30,
      capture: false,
    });
    const voided = await g.voidPayment!({ gatewayPaymentId: pay.gatewayId });
    expect(voided.status).toBe("cancelled");
    expect(await g.getPaymentStatus!(pay.gatewayId)).toBe("cancelled");
  });

  it("enqueue extends queues at runtime", async () => {
    const g = mockGateway();
    g.enqueue("createPayment", { outcome: "requires_action" });
    const r = await g.createPayment(baseCreate);
    expect(r.status).toBe("pending");
    expect(r.outcome).toBe("requires_action");
  });

  it("default create dual-writes outcome succeeded + references", async () => {
    const g = mockGateway({ name: "demo" });
    const r = await g.createPayment(baseCreate);
    expect(r.outcome).toBe("succeeded");
    expect(r.status).toBe("paid");
    expect(r.success).toBe(true);
    expect(isPaidOutcome(r)).toBe(true);
    expect(r.references).toMatchObject({
      providerObjectId: r.gatewayId,
      normalizedStatus: "paid",
      gateway: "demo",
    });
  });

  it("requires_action is not type-confusable with paid via isPaidOutcome", async () => {
    const g = mockGateway({
      createPayment: [{ outcome: "requires_action" }],
    });
    const r = await g.createPayment(baseCreate);
    // Both historically had success:true — Phase 6 separates them
    expect(r.success).toBe(true);
    expect(r.outcome).toBe("requires_action");
    expect(isRequiresActionOutcome(r)).toBe(true);
    expect(isPaidOutcome(r)).toBe(false);
  });

  it("implements PaymentGateway surface (name, capabilities, supports)", () => {
    const g = mockGateway({ name: "custom-mock" });
    expect(g.name).toBe("custom-mock");
    expect(g.supports("payments")).toBe(true);
    expect(g.supports("partialCapture")).toBe(true);
    expect(typeof g.capabilities.refunds).toBe("boolean");
    expect(Object.isFrozen(g.capabilities)).toBe(true);
  });

  it("redacting logger never receives cleartext secrets", async () => {
    const seen: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    const sink = {
      debug(message: string, context?: Record<string, unknown>) {
        seen.push({ message, context });
      },
      info(message: string, context?: Record<string, unknown>) {
        seen.push({ message, context });
      },
      warn(message: string, context?: Record<string, unknown>) {
        seen.push({ message, context });
      },
      error(message: string, context?: Record<string, unknown>) {
        seen.push({ message, context });
      },
    };
    const g = mockGateway({ logger: sink });
    await g.createPayment({
      ...baseCreate,
      metadata: { apiKey: "sk_test_should_not_appear", note: "ok" },
    });
    const blob = JSON.stringify(seen);
    expect(blob).not.toContain("sk_test_should_not_appear");
    // setLogger re-wraps with redaction
    g.setLogger(sink);
    await g.createPayment({
      ...baseCreate,
      metadata: { cardNumber: "4111111111111111" },
    });
    expect(JSON.stringify(seen)).not.toContain("4111111111111111");
  });

  it("concurrent same idempotencyKey does not double-charge", async () => {
    const g = mockGateway({
      // force a microtask yield so Promise.all would race without in-flight map
      defaultLatencyMs: 1,
    });
    const params = {
      amount: 25,
      currency: "USD" as const,
      callbackUrl: "https://ex.test/cb",
      idempotencyKey: "race-key",
    };
    const [a, b] = await Promise.all([
      g.createPayment(params),
      g.createPayment(params),
    ]);
    expect(a.gatewayId).toBe(b.gatewayId);
    expect(a.success).toBe(true);
    // Only one payment id on the ledger
    const ids = new Set(
      g
        .getHistory()
        .filter((h) => h.operation === "createPayment" && !h.error)
        .map((h) => (h.result as { gatewayId?: string } | undefined)?.gatewayId),
    );
    expect([...ids].filter(Boolean)).toHaveLength(1);
  });

  it("provider_ok_client_timeout caches so idempotent retry is not a double charge", async () => {
    const g = mockGateway({
      createPayment: [
        { outcome: "provider_ok_client_timeout" },
        { outcome: "succeeded" }, // must not be consumed on retry
      ],
    });
    const params = {
      amount: 10,
      currency: "USD" as const,
      callbackUrl: "https://ex.test/cb",
      idempotencyKey: "dual-timeout-key",
    };
    await expect(g.createPayment(params)).rejects.toBeInstanceOf(NetworkError);
    const side = g.getLastProviderSideSuccess();
    expect(side?.gatewayId).toBeTruthy();
    // Retry must return the provider-side payment, not create pay_mock_2
    const retry = await g.createPayment(params);
    expect(retry.gatewayId).toBe(side!.gatewayId);
    expect(retry.success).toBe(true);
    expect(g.remainingOutcomes().createPayment).toBe(1); // second script unused
  });

  it("honors idempotencyKey with same gatewayId (process-local)", async () => {
    const g = mockGateway();
    const a = await g.createPayment({
      ...baseCreate,
      idempotencyKey: "idem-key-1",
    });
    const b = await g.createPayment({
      ...baseCreate,
      idempotencyKey: "idem-key-1",
    });
    expect(a.gatewayId).toBe(b.gatewayId);
    const c = await g.createPayment({
      ...baseCreate,
      idempotencyKey: "idem-key-2",
    });
    expect(c.gatewayId).not.toBe(a.gatewayId);
  });
});
