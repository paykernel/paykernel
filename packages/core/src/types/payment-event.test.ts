/**
 * Phase 7 — PaymentEvent model, mapping tables, envelope + hash helpers.
 */
import { describe, it, expect } from "bun:test";
import type {
  PaymentEvent,
  PersistedPaymentEventEnvelope,
  WebhookEvent,
  RawWebhookPayloadCodec,
} from "../index";
import {
  STABLE_PAYMENT_EVENT_TYPES,
  PAYMENT_EVENT_SCHEMA_VERSION,
  isStablePaymentEventType,
  isPaymentEvent,
  isPaymentSucceededEvent,
  isPaymentFailedEvent,
  isRefundCompletedEvent,
  isProviderUnmappedEvent,
  mapProviderEventTypeToStable,
  webhookEventToPaymentEvent,
  attachPaymentEvent,
  toPersistedPaymentEventEnvelope,
  hashWebhookPayload,
  encryptRawWebhookPayload,
  redactWebhookPayloadSecrets,
  assertNoSecretsInEnvelope,
  buildProviderEventMetadata,
  paymentFromWebhookEvent,
} from "../index";

function baseWebhook(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_1",
    type: "payment_paid",
    gateway: "moyasar",
    paymentId: "order_1",
    gatewayPaymentId: "pay_1",
    status: "paid",
    timestamp: new Date("2024-01-15T12:00:00.000Z"),
    rawPayload: { id: "evt_1", type: "payment_paid" },
    ...overrides,
  };
}

describe("STABLE_PAYMENT_EVENT_TYPES", () => {
  it("contains every documented stable name", () => {
    const expected = [
      "payment.created",
      "payment.processing",
      "payment.authorized",
      "payment.succeeded",
      "payment.failed",
      "payment.cancelled",
      "capture.completed",
      "refund.pending",
      "refund.completed",
      "refund.failed",
      "payment_method.setup_completed",
      "dispute.opened",
      "dispute.updated",
      "dispute.closed",
    ];
    expect([...STABLE_PAYMENT_EVENT_TYPES]).toEqual(expected);
    expect(STABLE_PAYMENT_EVENT_TYPES).toHaveLength(14);
  });

  it("isStablePaymentEventType is true for all stable names", () => {
    for (const t of STABLE_PAYMENT_EVENT_TYPES) {
      expect(isStablePaymentEventType(t)).toBe(true);
    }
  });

  it("isStablePaymentEventType rejects provider-native and unmapped", () => {
    expect(isStablePaymentEventType("payment_paid")).toBe(false);
    expect(isStablePaymentEventType("payment_intent.succeeded")).toBe(false);
    expect(isStablePaymentEventType("provider.unmapped")).toBe(false);
    expect(isStablePaymentEventType("")).toBe(false);
  });

  it("schemaVersion constant is literally '1'", () => {
    expect(PAYMENT_EVENT_SCHEMA_VERSION).toBe("1");
  });
});

describe("PaymentEvent discrimination", () => {
  it("switch on type narrows payment vs refund vs dispute arms", () => {
    function label(event: PaymentEvent): string {
      switch (event.type) {
        case "payment.created":
        case "payment.processing":
        case "payment.authorized":
        case "payment.succeeded":
        case "payment.cancelled":
          return `payment:${event.payment.status}`;
        case "payment.failed":
          return `failed:${event.failure.code}`;
        case "capture.completed":
          return `capture:${event.capture.status}`;
        case "refund.pending":
        case "refund.completed":
          return `refund:${event.refund.status}`;
        case "refund.failed":
          return `refund-failed:${event.refund.status}`;
        case "payment_method.setup_completed":
          return `setup:${event.setup.status}`;
        case "dispute.opened":
        case "dispute.updated":
        case "dispute.closed":
          return `dispute:${event.dispute.status}`;
        case "provider.unmapped":
          return `unmapped:${event.provider.eventType}`;
        default: {
          const _n: never = event;
          return String(_n);
        }
      }
    }

    const succeeded = webhookEventToPaymentEvent(
      baseWebhook({ type: "payment_paid", status: "paid" }),
    );
    expect(isPaymentSucceededEvent(succeeded)).toBe(true);
    expect(label(succeeded)).toBe("payment:paid");

    const failed = webhookEventToPaymentEvent(
      baseWebhook({
        type: "payment_failed",
        status: "failed",
        gateway: "moyasar",
      }),
    );
    expect(isPaymentFailedEvent(failed)).toBe(true);
    expect(label(failed)).toContain("failed:");

    const refund = webhookEventToPaymentEvent(
      baseWebhook({
        type: "charge.refunded",
        gateway: "stripe",
        status: "refunded",
      }),
    );
    expect(isRefundCompletedEvent(refund)).toBe(true);
    expect(label(refund)).toContain("refund:");

    const unmapped = webhookEventToPaymentEvent(
      baseWebhook({
        type: "invoice.paid",
        gateway: "stripe",
        status: "paid",
      }),
    );
    expect(isProviderUnmappedEvent(unmapped)).toBe(true);
    expect(label(unmapped)).toBe("unmapped:invoice.paid");
  });

  it("isPaymentEvent requires schemaVersion 1 + type + provider", () => {
    const e = webhookEventToPaymentEvent(baseWebhook());
    expect(isPaymentEvent(e)).toBe(true);
    expect(isPaymentEvent({ type: "payment.succeeded" })).toBe(false);
    expect(isPaymentEvent(null)).toBe(false);
  });
});

describe("webhookEventToPaymentEvent", () => {
  it("maps payment_paid → payment.succeeded with Payment + provider metadata", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({
        type: "payment_paid",
        status: "paid",
        amount: 10.5,
        currency: "SAR",
        livemode: false,
      }),
      { receivedAt: "2024-01-15T12:00:01.000Z", requestId: "req_1" },
    );

    expect(event.schemaVersion).toBe("1");
    expect(event.type).toBe("payment.succeeded");
    if (event.type !== "payment.succeeded") throw new Error("narrow");
    expect(event.payment.amount).toBe(10.5);
    expect(event.payment.currency).toBe("SAR");
    expect(event.payment.references.providerObjectId).toBe("pay_1");
    expect(event.payment.references.gateway).toBe("moyasar");
    expect(event.provider.eventType).toBe("payment_paid");
    expect(event.provider.eventId).toBe("evt_1");
    expect(event.provider.occurredAt).toBe("2024-01-15T12:00:00.000Z");
    expect(event.provider.receivedAt).toBe("2024-01-15T12:00:01.000Z");
    expect(event.provider.requestId).toBe("req_1");
    expect(event.provider.livemode).toBe(false);
    // raw not on payment by default
    expect(event.payment.rawResponse).toBeUndefined();
  });

  it("maps failed → payment.failed with failure", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({ type: "payment_failed", status: "failed" }),
    );
    expect(event.type).toBe("payment.failed");
    if (event.type !== "payment.failed") throw new Error("narrow");
    expect(event.failure.code).toBe("payment_failed");
    expect(event.failure.providerCode).toBe("failed");
  });

  it("unknown provider type → provider.unmapped preserving provider.eventType", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({
        type: "weird.custom.event",
        gateway: "stripe",
        status: "pending",
      }),
    );
    expect(event.type).toBe("provider.unmapped");
    if (event.type !== "provider.unmapped") throw new Error("narrow");
    expect(event.provider.eventType).toBe("weird.custom.event");
    expect(event.note).toContain("weird.custom.event");
  });

  it("does not invent misleading payment raw from webhook by default", () => {
    const payment = paymentFromWebhookEvent(
      baseWebhook({ rawPayload: { secret_token: "s" } }),
    );
    expect(payment.rawResponse).toBeUndefined();
  });
});

describe("attachPaymentEvent dual-write", () => {
  it("keeps provider-native type and sets stableType + event", () => {
    const legacy = baseWebhook({ type: "payment_paid", status: "paid" });
    const dual = attachPaymentEvent(legacy, {
      receivedAt: "2024-06-01T00:00:00.000Z",
    });

    expect(dual.type).toBe("payment_paid"); // legacy preserved
    expect(dual.stableType).toBe("payment.succeeded");
    expect(dual.schemaVersion).toBe("1");
    expect(dual.event?.type).toBe("payment.succeeded");
    expect(dual.provider?.eventType).toBe("payment_paid");
    expect(legacy.event).toBeUndefined(); // input not mutated
  });

  it("omits stableType when unmapped", () => {
    const dual = attachPaymentEvent(
      baseWebhook({ type: "invoice.created", gateway: "stripe", status: "pending" }),
    );
    expect(dual.type).toBe("invoice.created");
    expect(dual.stableType).toBeUndefined();
    expect(dual.event?.type).toBe("provider.unmapped");
  });

  it("computePayloadHash sets payloadHash from redacted raw", () => {
    const dual = attachPaymentEvent(
      baseWebhook({
        rawPayload: { id: "x", secret_token: "shh", amount: 1 },
      }),
      { computePayloadHash: true },
    );
    expect(dual.payloadHash).toBeDefined();
    expect(dual.payloadHash).toBe(
      hashWebhookPayload({ id: "x", secret_token: "shh", amount: 1 }),
    );
  });
});

describe("mapProviderEventTypeToStable tables", () => {
  describe("stripe", () => {
    const cases: Array<[string, string]> = [
      ["payment_intent.succeeded", "payment.succeeded"],
      ["payment_intent.payment_failed", "payment.failed"],
      ["payment_intent.canceled", "payment.cancelled"],
      ["payment_intent.created", "payment.created"],
      ["payment_intent.processing", "payment.processing"],
      ["checkout.session.async_payment_succeeded", "payment.succeeded"],
      ["checkout.session.expired", "payment.cancelled"],
      ["setup_intent.succeeded", "payment_method.setup_completed"],
      ["charge.refunded", "refund.completed"],
      ["refund.failed", "refund.failed"],
      ["charge.dispute.created", "dispute.opened"],
      ["charge.dispute.closed", "dispute.closed"],
    ];

    for (const [native, stable] of cases) {
      it(`${native} → ${stable}`, () => {
        expect(mapProviderEventTypeToStable("stripe", native)).toBe(stable);
      });
    }

    it("checkout.session.completed paid → payment.succeeded", () => {
      expect(
        mapProviderEventTypeToStable("stripe", "checkout.session.completed", {
          paymentStatus: "paid",
        }),
      ).toBe("payment.succeeded");
      expect(
        mapProviderEventTypeToStable("stripe", "checkout.session.completed", {
          status: "paid",
        }),
      ).toBe("payment.succeeded");
    });

    it("checkout.session.completed setup → payment_method.setup_completed", () => {
      expect(
        mapProviderEventTypeToStable("stripe", "checkout.session.completed", {
          paymentStatus: "no_payment_required",
          mode: "setup",
        }),
      ).toBe("payment_method.setup_completed");
      expect(
        mapProviderEventTypeToStable("stripe", "checkout.session.completed", {
          status: "setup_completed",
        }),
      ).toBe("payment_method.setup_completed");
    });

    it("invoice/subscription → provider.unmapped", () => {
      expect(mapProviderEventTypeToStable("stripe", "invoice.paid")).toBe(
        "provider.unmapped",
      );
      expect(
        mapProviderEventTypeToStable("stripe", "customer.subscription.updated"),
      ).toBe("provider.unmapped");
    });

    it("refund.created without status → refund.pending", () => {
      expect(mapProviderEventTypeToStable("stripe", "refund.created")).toBe(
        "refund.pending",
      );
    });

    it("refund.updated succeeded → refund.completed", () => {
      expect(
        mapProviderEventTypeToStable("stripe", "refund.updated", {
          status: "succeeded",
        }),
      ).toBe("refund.completed");
    });
  });

  describe("moyasar", () => {
    const cases: Array<[string, string]> = [
      ["payment_paid", "payment.succeeded"],
      ["payment_failed", "payment.failed"],
      ["payment_faild", "payment.failed"],
      ["payment_authorized", "payment.authorized"],
      ["payment_abandoned", "payment.failed"],
      ["payment_voided", "payment.cancelled"],
      ["payment_refunded", "refund.completed"],
      ["payment_captured", "capture.completed"],
      ["payment_verified", "payment_method.setup_completed"],
    ];

    for (const [native, stable] of cases) {
      it(`${native} → ${stable}`, () => {
        expect(mapProviderEventTypeToStable("moyasar", native)).toBe(stable);
      });
    }
  });

  describe("paypal", () => {
    const cases: Array<[string, string]> = [
      ["PAYMENT.CAPTURE.COMPLETED", "capture.completed"],
      ["PAYMENT.CAPTURE.DENIED", "payment.failed"],
      ["PAYMENT.CAPTURE.DECLINED", "payment.failed"],
      ["PAYMENT.CAPTURE.PENDING", "payment.processing"],
      ["PAYMENT.CAPTURE.REFUNDED", "refund.completed"],
      ["PAYMENT.REFUND.COMPLETED", "refund.completed"],
      ["PAYMENT.REFUND.PENDING", "refund.pending"],
      ["PAYMENT.REFUND.FAILED", "refund.failed"],
      ["PAYMENT.AUTHORIZATION.CREATED", "payment.authorized"],
      ["PAYMENT.AUTHORIZATION.VOIDED", "payment.cancelled"],
      ["CHECKOUT.ORDER.APPROVED", "payment.processing"],
      ["CUSTOMER.DISPUTE.CREATED", "dispute.opened"],
    ];

    for (const [native, stable] of cases) {
      it(`${native} → ${stable}`, () => {
        expect(mapProviderEventTypeToStable("paypal", native)).toBe(stable);
      });
    }

    it("PAYMENT.CAPTURE.REVERSED stays unmapped (no stable reversed arm)", () => {
      expect(
        mapProviderEventTypeToStable("paypal", "PAYMENT.CAPTURE.REVERSED"),
      ).toBe("provider.unmapped");
    });

    it("CHECKOUT.ORDER.COMPLETED + paid status → payment.succeeded", () => {
      expect(
        mapProviderEventTypeToStable("paypal", "CHECKOUT.ORDER.COMPLETED", {
          status: "paid",
        }),
      ).toBe("payment.succeeded");
    });

    it("CHECKOUT.ORDER.COMPLETED + approved → processing (not succeeded)", () => {
      expect(
        mapProviderEventTypeToStable("paypal", "CHECKOUT.ORDER.COMPLETED", {
          status: "approved",
        }),
      ).toBe("payment.processing");
    });
  });

  describe("paymob", () => {
    it("TOKEN → payment_method.setup_completed", () => {
      expect(mapProviderEventTypeToStable("paymob", "TOKEN")).toBe(
        "payment_method.setup_completed",
      );
    });

    it("TRANSACTION success flag → payment.succeeded", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { success: true },
        }),
      ).toBe("payment.succeeded");
    });

    it("TRANSACTION failed → payment.failed", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { success: false },
        }),
      ).toBe("payment.failed");
    });

    it("TRANSACTION void → payment.cancelled", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { isVoid: true, success: true },
        }),
      ).toBe("payment.cancelled");
    });

    it("TRANSACTION refund → refund.completed", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { isRefund: true, success: true },
        }),
      ).toBe("refund.completed");
    });

    it("TRANSACTION auth → payment.authorized", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { isAuth: true, success: true },
        }),
      ).toBe("payment.authorized");
    });

    it("TRANSACTION capture → capture.completed", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { isCapture: true, success: true },
        }),
      ).toBe("capture.completed");
    });

    it("TRANSACTION_RESPONSE without status → unmapped", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION_RESPONSE"),
      ).toBe("provider.unmapped");
    });

    it("TRANSACTION_RESPONSE with paid status → payment.succeeded", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION_RESPONSE", {
          status: "paid",
        }),
      ).toBe("payment.succeeded");
    });

    it("TRANSACTION amount-only refund status beats success → refund.completed", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          status: "partially_refunded",
          flags: { success: true, isRefund: false, isRefunded: false },
        }),
      ).toBe("refund.completed");
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          status: "refunded",
          flags: { success: true },
        }),
      ).toBe("refund.completed");
    });

    it("TRANSACTION amount-only refund via amounts without status → refund.completed", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { success: true, isRefund: false, isRefunded: false },
          amounts: { amountCents: 10000, refundedAmountCents: 2500 },
        }),
      ).toBe("refund.completed");
    });

    it("TRANSACTION is_auth + paid/partially_captured status is not payment.authorized", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          status: "partially_captured",
          flags: { success: true, isAuth: true },
        }),
      ).toBe("payment.succeeded");
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          status: "paid",
          flags: { success: true, isAuth: true },
        }),
      ).toBe("payment.succeeded");
    });

    it("TRANSACTION is_auth + captured amount without status → payment.succeeded", () => {
      expect(
        mapProviderEventTypeToStable("paymob", "TRANSACTION", {
          flags: { success: true, isAuth: true },
          amounts: { amountCents: 10000, capturedAmountCents: 5000 },
        }),
      ).toBe("payment.succeeded");
    });
  });

  it("custom gateway unknown type → provider.unmapped", () => {
    expect(mapProviderEventTypeToStable("acme", "order.paid")).toBe(
      "provider.unmapped",
    );
  });

  it("mapping is idempotent for already-stable names", () => {
    expect(
      mapProviderEventTypeToStable("stripe", "payment.succeeded"),
    ).toBe("payment.succeeded");
  });
});

describe("envelope + hash + secrets", () => {
  it("toPersistedPaymentEventEnvelope has no rawPayload key anywhere", () => {
    const pe = webhookEventToPaymentEvent(
      baseWebhook({
        rawPayload: {
          secret_token: "super-secret",
          signature: "sig",
          data: { amount: 100 },
        },
      }),
      { includeRawOnPayment: true },
    );
    // force raw on payment for the strip test
    if ("payment" in pe && pe.payment) {
      pe.payment.rawResponse = { secret_token: "x" };
    }

    const envelope = toPersistedPaymentEventEnvelope(pe, {
      rawForHash: {
        secret_token: "super-secret",
        data: { amount: 100 },
      },
      storedAt: "2024-01-15T12:05:00.000Z",
    });

    expect(envelope.schemaVersion).toBe("1");
    expect(envelope.storedAt).toBe("2024-01-15T12:05:00.000Z");
    expect(envelope.payloadHash).toMatch(/^[a-f0-9]{64}$/);

    const json = JSON.stringify(envelope);
    expect(json).not.toContain("rawPayload");
    expect(json).not.toContain("rawResponse");
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("secret_token");

    assertNoSecretsInEnvelope(envelope);
  });

  it("hashWebhookPayload redacts secret_token / signature", () => {
    const withSecrets = hashWebhookPayload({
      id: "1",
      secret_token: "shh",
      signature: "sig",
      amount: 10,
    });
    const redacted = hashWebhookPayload({
      id: "1",
      secret_token: "[REDACTED]",
      signature: "[REDACTED]",
      amount: 10,
    });
    expect(withSecrets).toBe(redacted);

    const withoutSecrets = hashWebhookPayload({ id: "1", amount: 10 });
    expect(withSecrets).not.toBe(withoutSecrets);
  });

  it("hashWebhookPayload returns 64-char lowercase hex (portable sha256)", () => {
    const h = hashWebhookPayload({ id: "1", amount: 10 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Stable known input — pure sha256 of redacted canonical JSON
    expect(h).toBe(hashWebhookPayload({ id: "1", amount: 10 }));
  });

  it("hash is key-order independent", () => {
    const a = hashWebhookPayload({ b: 2, a: 1 });
    const b = hashWebhookPayload({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("redactWebhookPayloadSecrets replaces nested secrets", () => {
    const out = redactWebhookPayloadSecrets({
      outer: { secret_token: "x", keep: 1 },
      hmac: "h",
    }) as Record<string, unknown>;
    expect((out.outer as Record<string, unknown>).secret_token).toBe(
      "[REDACTED]",
    );
    expect((out.outer as Record<string, unknown>).keep).toBe(1);
    expect(out.hmac).toBe("[REDACTED]");
  });

  it("encryptRawWebhookPayload roundtrips with fake codec", async () => {
    const codec: RawWebhookPayloadCodec = {
      encrypt(plaintext) {
        const s =
          typeof plaintext === "string"
            ? plaintext
            : new TextDecoder().decode(plaintext);
        return `enc:${s}`;
      },
      decrypt(ciphertext) {
        return ciphertext.replace(/^enc:/, "");
      },
    };

    const raw = { id: "evt", secret_token: "s", n: 1 };
    const record = await encryptRawWebhookPayload(raw, codec, {
      codecId: "test-codec",
    });

    expect(record.schemaVersion).toBe("1");
    expect(record.codecId).toBe("test-codec");
    expect(record.payloadHash).toBe(hashWebhookPayload(raw));
    expect(record.ciphertext.startsWith("enc:")).toBe(true);

    const decrypted = await Promise.resolve(codec.decrypt(record.ciphertext));
    expect(typeof decrypted === "string" ? decrypted : "").toContain("evt");
  });

  it("encryptRawWebhookPayload redacts secret keys in JSON string before codec", async () => {
    let seen: string | Uint8Array | undefined;
    const codec: RawWebhookPayloadCodec = {
      encrypt(plaintext) {
        seen = plaintext;
        return typeof plaintext === "string"
          ? `enc:${plaintext}`
          : "enc:bin";
      },
      decrypt(ciphertext) {
        return ciphertext.replace(/^enc:/, "");
      },
    };

    const raw = JSON.stringify({
      id: "evt",
      secret_token: "super-secret-value",
      n: 1,
    });
    const record = await encryptRawWebhookPayload(raw, codec);

    expect(typeof seen).toBe("string");
    const plaintext = seen as string;
    expect(plaintext).not.toContain("super-secret-value");
    expect(plaintext).toContain("[REDACTED]");
    expect(plaintext).toContain("evt");
    expect(record.payloadHash).toBe(hashWebhookPayload(raw));
    expect(record.ciphertext).not.toContain("super-secret-value");
  });

  it("buildProviderEventMetadata uses ISO times", () => {
    const meta = buildProviderEventMetadata(
      baseWebhook({
        apiVersion: "2024-01-01",
        livemode: true,
      }),
      { receivedAt: "2024-02-01T00:00:00.000Z" },
    );
    expect(meta.occurredAt).toBe("2024-01-15T12:00:00.000Z");
    expect(meta.receivedAt).toBe("2024-02-01T00:00:00.000Z");
    expect(meta.apiVersion).toBe("2024-01-01");
    expect(meta.livemode).toBe(true);
  });
});

describe("envelope type shape", () => {
  it("PersistedPaymentEventEnvelope requires schemaVersion 1", () => {
    const event = webhookEventToPaymentEvent(baseWebhook());
    const envelope: PersistedPaymentEventEnvelope = {
      schemaVersion: "1",
      event,
      payloadHash: hashWebhookPayload({}),
      storedAt: new Date().toISOString(),
    };
    expect(envelope.schemaVersion).toBe("1");
  });
});
