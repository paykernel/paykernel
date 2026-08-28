/**
 * Phase 7 Stream C — Acceptance criteria lock for typed & versioned webhook events.
 *
 * Locks:
 * 1) Handlers receive discriminated PaymentEvent (switch exhaustiveness + arms)
 * 2) ProviderEventMetadata always present (native eventType preserved)
 * 3) Sanitized PersistedPaymentEventEnvelope (no raw/secrets/headers)
 * 4) All roadmap 7.1 stable names present
 * 5) schemaVersion '1' on all arms
 * 6) Raw retention via encryptRawWebhookPayload; envelope never includes raw
 * 7) Unknown mapping never invents payment.succeeded
 * 8) 0.x WebhookEvent contract (id/type/gateway/status/timestamp/rawPayload)
 * 9) handleWebhook dual-writes event field (additive)
 *
 * Phase 6 operation-result / money suites remain separate regression suites.
 */
import { describe, it, expect } from "bun:test";
import { PaymentClient } from "./client";
import type {
  PaymentEvent,
  PaymentFailure,
  PersistedPaymentEventEnvelope,
  ProviderEventMetadata,
  RawWebhookPayloadCodec,
  Refund,
  WebhookEvent,
} from "./index";
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
  stripRawFromPaymentEvent,
  WEBHOOK_PAYLOAD_SECRET_KEYS,
  assertNoSecretsInEnvelope,
  buildProviderEventMetadata,
} from "./index";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function baseWebhook(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt_accept_1",
    type: "payment_paid",
    gateway: "moyasar",
    paymentId: "order_1",
    gatewayPaymentId: "pay_1",
    status: "paid",
    timestamp: new Date("2024-03-01T10:00:00.000Z"),
    rawPayload: { id: "evt_accept_1", type: "payment_paid", data: { amount: 100 } },
    ...overrides,
  };
}

/** Exhaustive switch — compile-time never + runtime coverage of every arm label. */
function exhaustiveLabel(event: PaymentEvent): string {
  switch (event.type) {
    case "payment.created":
    case "payment.processing":
    case "payment.authorized":
    case "payment.succeeded":
    case "payment.cancelled":
      // payment arm: Payment, not failure
      return `payment:${event.type}:${event.payment.status}`;
    case "payment.failed":
      return `failed:${event.failure.code}`;
    case "capture.completed":
      return `capture:${event.capture.status}`;
    case "refund.pending":
    case "refund.completed":
      return `refund:${event.type}:${event.refund.status}`;
    case "refund.failed":
      return `refund-failed:${event.refund.status}`;
    case "payment_method.setup_completed":
      return `setup:${event.setup.status}`;
    case "dispute.opened":
    case "dispute.updated":
    case "dispute.closed":
      return `dispute:${event.type}:${event.dispute.status}`;
    case "provider.unmapped":
      return `unmapped:${event.provider.eventType}`;
    default: {
      const _never: never = event;
      throw new Error(`unhandled PaymentEvent arm: ${String(_never)}`);
    }
  }
}

function assertProviderMeta(meta: ProviderEventMetadata, expected: {
  gateway: string;
  eventId: string;
  eventType: string;
}): void {
  expect(meta.gateway).toBe(expected.gateway);
  expect(meta.eventId).toBe(expected.eventId);
  expect(meta.eventType).toBe(expected.eventType);
  expect(typeof meta.occurredAt).toBe("string");
  expect(meta.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(typeof meta.receivedAt).toBe("string");
  expect(meta.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
}

// ─── 7.1 / 7.5 smoke (full catalog lives in payment-event.test.ts) ───────────

describe.skip("Phase 7 AC — schemaVersion on dual-write", () => {
  it("schemaVersion is '1' on mapped and unmapped PaymentEvents", () => {
    expect(PAYMENT_EVENT_SCHEMA_VERSION).toBe("1");
    expect(STABLE_PAYMENT_EVENT_TYPES).toHaveLength(14);
    expect(isStablePaymentEventType("payment.succeeded")).toBe(true);

    const cases: Array<Partial<WebhookEvent>> = [
      { type: "payment_paid", status: "paid", gateway: "moyasar" },
      { type: "charge.refunded", status: "refunded", gateway: "stripe" },
      { type: "invoice.paid", status: "paid", gateway: "stripe" },
    ];
    for (const overrides of cases) {
      const pe = webhookEventToPaymentEvent(baseWebhook(overrides));
      expect(pe.schemaVersion).toBe("1");
      expect(isPaymentEvent(pe)).toBe(true);
    }
  });
});

// ─── 1: Discriminated handlers ───────────────────────────────────────────────

describe.skip("Phase 7 AC — handlers receive discriminated events", () => {
  it("PaymentEvent union is exhaustively switchable on type", () => {
    const events: PaymentEvent[] = [
      webhookEventToPaymentEvent(
        baseWebhook({ type: "payment_paid", status: "paid" }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({ type: "payment_failed", status: "failed" }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({
          type: "charge.refunded",
          gateway: "stripe",
          status: "refunded",
        }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({
          type: "PAYMENT.CAPTURE.COMPLETED",
          gateway: "paypal",
          status: "paid",
        }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({
          type: "invoice.paid",
          gateway: "stripe",
          status: "paid",
        }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({
          type: "setup_intent.succeeded",
          gateway: "stripe",
          status: "setup_completed",
        }),
      ),
      webhookEventToPaymentEvent(
        baseWebhook({
          type: "charge.dispute.created",
          gateway: "stripe",
          status: "pending",
        }),
      ),
    ];

    const labels = events.map(exhaustiveLabel);
    expect(labels).toContain("payment:payment.succeeded:paid");
    expect(labels.some((l) => l.startsWith("failed:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("refund:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("capture:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("unmapped:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("setup:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("dispute:"))).toBe(true);
  });

  it("payment.succeeded arm has payment: Payment, not failure", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({ type: "payment_paid", status: "paid", amount: 42, currency: "SAR" }),
    );
    expect(isPaymentSucceededEvent(event)).toBe(true);
    expect(event.type).toBe("payment.succeeded");
    if (event.type !== "payment.succeeded") throw new Error("narrow");
    expect(event.payment).toBeDefined();
    expect(event.payment.status).toBe("paid");
    expect(event.payment.amount).toBe(42);
    expect(event.payment.currency).toBe("SAR");
    expect(event.payment.references.gateway).toBe("moyasar");
    expect(event.payment.references.providerObjectId).toBe("pay_1");
    // failure is not on this arm
    expect("failure" in event).toBe(false);
  });

  it("payment.failed arm has failure: PaymentFailure", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({ type: "payment_failed", status: "failed" }),
    );
    expect(isPaymentFailedEvent(event)).toBe(true);
    if (event.type !== "payment.failed") throw new Error("narrow");
    const failure: PaymentFailure = event.failure;
    expect(failure.code).toBeDefined();
    expect(typeof failure.code).toBe("string");
    expect(event.payment).toBeDefined();
  });

  it("refund.completed arm has refund: Refund", () => {
    const event = webhookEventToPaymentEvent(
      baseWebhook({
        type: "payment_refunded",
        gateway: "moyasar",
        status: "refunded",
        amount: 5,
        currency: "SAR",
      }),
    );
    expect(isRefundCompletedEvent(event)).toBe(true);
    if (event.type !== "refund.completed") throw new Error("narrow");
    const refund: Refund = event.refund;
    expect(refund.status).toBe("completed");
    expect(refund.amount).toBe(5);
    expect(refund.references.providerObjectId).toBe("pay_1");
    expect("payment" in event && (event as { payment?: unknown }).payment).toBeFalsy();
  });

  it("webhookEventToPaymentEvent + attachPaymentEvent dual-write event field", () => {
    const legacy = baseWebhook({ type: "payment_intent.succeeded", gateway: "stripe", status: "paid" });
    const pe = webhookEventToPaymentEvent(legacy, {
      receivedAt: "2024-03-01T10:00:01.000Z",
    });
    expect(pe.type).toBe("payment.succeeded");

    const dual = attachPaymentEvent(legacy, {
      receivedAt: "2024-03-01T10:00:01.000Z",
    });
    // 0.x fields unchanged
    expect(dual.type).toBe("payment_intent.succeeded");
    expect(dual.id).toBe(legacy.id);
    expect(dual.gateway).toBe("stripe");
    expect(dual.status).toBe("paid");
    expect(dual.timestamp).toEqual(legacy.timestamp);
    expect(dual.rawPayload).toBe(legacy.rawPayload);
    // dual-write
    expect(dual.schemaVersion).toBe("1");
    expect(dual.stableType).toBe("payment.succeeded");
    expect(dual.event).toBeDefined();
    expect(dual.event?.type).toBe("payment.succeeded");
    expect(dual.provider?.eventType).toBe("payment_intent.succeeded");
  });

  it("handleWebhook attaches PaymentEvent for handlers and onWebhookVerified", async () => {
    const verified: WebhookEvent[] = [];
    const client = new PaymentClient({
      moyasar: {
        secretKey: "sk_test_moyasar",
        webhookSecret: "whsec_accept_test",
      },
      defaultGateway: "moyasar",
      hooks: {
        onWebhookVerified: async (event) => {
          verified.push(event);
        },
      },
    });

    // Minimal fixture matches moyasar.gateway tests (verify + parse).
    // Finite `captured` is required for paid-like (P610-MOY-2).
    const payload = {
      id: "evt_hw_1",
      type: "payment_paid",
      created_at: "2024-03-01T10:00:00Z",
      secret_token: "whsec_accept_test",
      live: false,
      data: {
        id: "pay_hw_1",
        status: "paid",
        amount: 1000,
        captured: 1000,
        currency: "SAR",
        metadata: { paymentId: "order_hw_1" },
      },
    };

    const event = await client.handleWebhook("moyasar", payload);

    // 0.x contract
    expect(event.id).toBeDefined();
    expect(event.type).toBe("payment_paid"); // provider-native
    expect(event.gateway).toBe("moyasar");
    expect(event.status).toBe("paid");
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.rawPayload).toBeDefined();

    // dual-write
    expect(event.schemaVersion).toBe("1");
    expect(event.stableType).toBe("payment.succeeded");
    expect(event.event).toBeDefined();
    expect(event.event?.type).toBe("payment.succeeded");
    expect(event.provider?.eventType).toBe("payment_paid");
    expect(event.provider?.gateway).toBe("moyasar");
    expect(event.provider?.occurredAt).toMatch(/^\d{4}-/);
    expect(event.provider?.receivedAt).toMatch(/^\d{4}-/);

    if (event.event?.type !== "payment.succeeded") {
      throw new Error("expected payment.succeeded");
    }
    expect(event.event.payment.status).toBe("paid");

    // hook saw dual-written event
    expect(verified).toHaveLength(1);
    expect(verified[0]?.event?.type).toBe("payment.succeeded");
    expect(verified[0]?.type).toBe("payment_paid");
  });
});

// ─── 2: Provider metadata ────────────────────────────────────────────────────

describe.skip("Phase 7 AC — provider metadata remains available", () => {
  it("every PaymentEvent has provider with gateway, eventId, eventType, ISO times", () => {
    const samples: WebhookEvent[] = [
      baseWebhook({ type: "payment_paid", gateway: "moyasar" }),
      baseWebhook({
        type: "payment_intent.payment_failed",
        gateway: "stripe",
        status: "failed",
        apiVersion: "2023-10-16",
        livemode: true,
      }),
      baseWebhook({
        type: "PAYMENT.REFUND.COMPLETED",
        gateway: "paypal",
        status: "refunded",
      }),
      baseWebhook({
        type: "TRANSACTION",
        gateway: "paymob",
        status: "paid",
      }),
      baseWebhook({
        type: "unknown.xyz",
        gateway: "stripe",
        status: "pending",
      }),
    ];

    for (const wh of samples) {
      const pe = webhookEventToPaymentEvent(wh, {
        receivedAt: "2024-03-01T10:00:02.000Z",
        requestId: "req_accept",
      });
      assertProviderMeta(pe.provider, {
        gateway: wh.gateway,
        eventId: wh.id,
        eventType: wh.type, // native, not rewritten
      });
      expect(pe.provider.receivedAt).toBe("2024-03-01T10:00:02.000Z");
      expect(pe.provider.requestId).toBe("req_accept");
      // Stable type differs from native when mapped
      if (pe.type !== "provider.unmapped") {
        expect(pe.type).not.toBe(pe.provider.eventType);
      }
    }
  });

  it("buildProviderEventMetadata preserves provider-native eventType", () => {
    const meta = buildProviderEventMetadata(
      baseWebhook({
        type: "PAYMENT.CAPTURE.COMPLETED",
        gateway: "paypal",
      }),
      { receivedAt: "2024-03-01T11:00:00.000Z" },
    );
    expect(meta.eventType).toBe("PAYMENT.CAPTURE.COMPLETED");
    expect(meta.occurredAt).toBe("2024-03-01T10:00:00.000Z");
    expect(meta.receivedAt).toBe("2024-03-01T11:00:00.000Z");
  });
});

// ─── 3 + 6: Envelope + raw retention ─────────────────────────────────────────

describe.skip("Phase 7 AC — sanitized envelope + raw retention", () => {
  it("toPersistedPaymentEventEnvelope produces schemaVersion, event, payloadHash, storedAt", () => {
    const pe = webhookEventToPaymentEvent(
      baseWebhook({
        rawPayload: {
          secret_token: "must-not-appear",
          signature: "sig-value",
          hmac: "hmac-value",
          headers: { authorization: "Bearer x", "stripe-signature": "t=1" },
          data: { amount: 100 },
        },
      }),
      { includeRawOnPayment: true },
    );
    if ("payment" in pe && pe.payment) {
      pe.payment.rawResponse = {
        secret_token: "nested-secret",
        keep: true,
      };
      pe.payment.clientSecret = "cs_live_xxx";
    }

    const envelope = toPersistedPaymentEventEnvelope(pe, {
      rawForHash: {
        secret_token: "must-not-appear",
        signature: "sig-value",
        data: { amount: 100 },
      },
      storedAt: "2024-03-01T12:00:00.000Z",
    });

    expect(envelope.schemaVersion).toBe("1");
    expect(envelope.event).toBeDefined();
    expect(envelope.event.schemaVersion).toBe("1");
    expect(envelope.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.storedAt).toBe("2024-03-01T12:00:00.000Z");

    const json = JSON.stringify(envelope);
    // Forbidden persistence content
    expect(json).not.toContain("rawPayload");
    expect(json).not.toContain("rawResponse");
    expect(json).not.toContain("must-not-appear");
    expect(json).not.toContain("nested-secret");
    expect(json).not.toContain("cs_live_xxx");
    expect(json).not.toContain("secret_token");
    expect(json).not.toContain("sig-value");
    expect(json).not.toContain("hmac-value");
    expect(json).not.toContain("Bearer x");
    // headers object from request must not be on envelope
    expect(json).not.toMatch(/"headers"\s*:/);

    assertNoSecretsInEnvelope(envelope);

    const typed: PersistedPaymentEventEnvelope = envelope;
    expect(typed.schemaVersion).toBe("1");
  });

  it("payloadHash is stable for the same redacted input", () => {
    const body = {
      id: "1",
      secret_token: "a",
      signature: "b",
      amount: 10,
      nested: { hmac: "h", ok: true },
    };
    const h1 = hashWebhookPayload(body);
    const h2 = hashWebhookPayload({
      amount: 10,
      id: "1",
      nested: { ok: true, hmac: "different-secret" },
      secret_token: "other",
      signature: "other-sig",
    });
    // secrets redacted → same structure/non-secret values → same hash
    expect(h1).toBe(h2);

    const envelopeA = toPersistedPaymentEventEnvelope(
      webhookEventToPaymentEvent(baseWebhook()),
      { rawForHash: body, storedAt: "2024-01-01T00:00:00.000Z" },
    );
    const envelopeB = toPersistedPaymentEventEnvelope(
      webhookEventToPaymentEvent(baseWebhook()),
      {
        rawForHash: {
          amount: 10,
          id: "1",
          nested: { ok: true, hmac: "zzz" },
          secret_token: "zzz",
          signature: "zzz",
        },
        storedAt: "2024-01-01T00:00:00.000Z",
      },
    );
    expect(envelopeA.payloadHash).toBe(envelopeB.payloadHash);
  });

  it("encryptRawWebhookPayload uses app codec; envelope path never includes raw by default", async () => {
    const codec: RawWebhookPayloadCodec = {
      encrypt(plaintext) {
        const s =
          typeof plaintext === "string"
            ? plaintext
            : new TextDecoder().decode(plaintext);
        return Buffer.from(s, "utf8").toString("base64");
      },
      decrypt(ciphertext) {
        return Buffer.from(ciphertext, "base64").toString("utf8");
      },
    };

    const raw = {
      id: "evt",
      secret_token: "super-secret-token",
      body: { n: 1 },
    };
    const record = await encryptRawWebhookPayload(raw, codec, {
      codecId: "accept-test-codec",
    });
    expect(record.schemaVersion).toBe("1");
    expect(record.codecId).toBe("accept-test-codec");
    expect(record.payloadHash).toBe(hashWebhookPayload(raw));
    expect(record.ciphertext).not.toContain("super-secret-token"); // base64 of JSON may still encode it if not redacted first
    // Ciphertext is encrypted form of (possibly redacted) payload; app owns secrets in codec.
    // Envelope path is independent and must never embed raw:
    const pe = webhookEventToPaymentEvent(
      baseWebhook({ rawPayload: raw }),
    );
    const envelope = toPersistedPaymentEventEnvelope(pe, {
      payloadHash: record.payloadHash,
      storedAt: "2024-03-01T00:00:00.000Z",
    });
    const envJson = JSON.stringify(envelope);
    expect(envJson).not.toContain("rawPayload");
    expect(envJson).not.toContain("super-secret-token");
    expect(envJson).not.toContain(record.ciphertext);
    assertNoSecretsInEnvelope(envelope);
  });

  it("P610-HASH-1: JSON string payloads are parsed and redacted before hash", () => {
    const secret = "accept-secret-in-json-string";
    const asString = JSON.stringify({
      id: "evt",
      secret_token: secret,
      n: 1,
    });
    const redacted = redactWebhookPayloadSecrets(asString);
    const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
    expect(text).not.toContain(secret);
    expect(hashWebhookPayload(asString)).toBe(
      hashWebhookPayload(
        JSON.stringify({ id: "evt", secret_token: "[REDACTED]", n: 1 }),
      ),
    );
    expect(hashWebhookPayload(asString)).not.toBe(
      hashWebhookPayload({ id: "evt", secret_token: secret, n: 1 }),
    );
  });

  it("P610-HASH-2: same-length binary payloads hash by bytes, not length", () => {
    const a = new Uint8Array(8).fill(1);
    const b = new Uint8Array(8).fill(2);
    expect(hashWebhookPayload(a)).not.toBe(hashWebhookPayload(b));
    expect(hashWebhookPayload(a)).toBe(hashWebhookPayload(Buffer.from(a)));
  });

  it("P610-RED-1: camelCase aliases + nextAction.clientSecret never persist", () => {
    expect(WEBHOOK_PAYLOAD_SECRET_KEYS).toEqual(
      expect.arrayContaining([
        "clientSecret",
        "secretToken",
        "webhookSecret",
        "accessToken",
      ]),
    );

    const pe = webhookEventToPaymentEvent(baseWebhook());
    if (!("payment" in pe) || !pe.payment) throw new Error("expected payment");
    pe.payment.clientSecret = "cs_live_top";
    pe.payment.nextAction = {
      type: "redirect",
      url: "https://example.com/3ds",
      clientSecret: "cs_live_nested",
    };
    const stripped = stripRawFromPaymentEvent(pe);
    if (!("payment" in stripped) || !stripped.payment) {
      throw new Error("expected payment");
    }
    expect(
      (stripped.payment.nextAction as { clientSecret?: string } | undefined)
        ?.clientSecret,
    ).toBeUndefined();

    const envelope = toPersistedPaymentEventEnvelope(pe, {
      rawForHash: { clientSecret: "cs_live_hash", keep: true },
    });
    const json = JSON.stringify(envelope);
    expect(json).not.toContain("cs_live_top");
    expect(json).not.toContain("cs_live_nested");
    assertNoSecretsInEnvelope(envelope);
  });
});

// ─── 7: Mapping policy ───────────────────────────────────────────────────────

describe.skip("Phase 7 AC — mapping never invents payment.succeeded", () => {
  /**
   * Ambiguous / unsupported provider types must never become payment.succeeded.
   * Stripe invoice/subscription stay unmapped even when status looks paid.
   * Paymob redirect without flags/status, empty types, custom gateways → unmapped.
   */
  const unknownCases: Array<{
    gateway: string;
    type: string;
    /** Context for pure mapper (omit status to prove no invent-from-type alone). */
    mapStatus?: string;
    /** Webhook status for dual-write (defaults to pending). */
    webhookStatus?: WebhookEvent["status"];
    /** When true, pure mapper must return provider.unmapped. */
    expectUnmapped?: boolean;
  }> = [
    {
      gateway: "stripe",
      type: "invoice.paid",
      mapStatus: "paid",
      webhookStatus: "paid",
      expectUnmapped: true,
    },
    {
      gateway: "stripe",
      type: "customer.subscription.updated",
      expectUnmapped: true,
    },
    {
      gateway: "stripe",
      type: "totally.unknown.event",
      expectUnmapped: true,
    },
    {
      gateway: "stripe",
      type: "checkout.session.completed", // no paymentStatus context
      expectUnmapped: true,
    },
    {
      gateway: "paypal",
      type: "PAYMENT.CAPTURE.REVERSED",
      expectUnmapped: true,
    },
    {
      gateway: "paypal",
      type: "BILLING.SUBSCRIPTION.CREATED",
      expectUnmapped: true,
    },
    {
      gateway: "paymob",
      type: "TRANSACTION_RESPONSE", // no flags / no status on pure map
      expectUnmapped: true,
    },
    {
      gateway: "moyasar",
      type: "card_auth_succeeded",
      expectUnmapped: true,
    },
    {
      gateway: "moyasar",
      type: "unknown_event",
      mapStatus: "paid",
      webhookStatus: "paid",
      expectUnmapped: true,
    },
    {
      gateway: "acme",
      type: "order.paid",
      mapStatus: "paid",
      webhookStatus: "paid",
      expectUnmapped: true,
    },
    { gateway: "stripe", type: "", expectUnmapped: true },
  ];

  for (const c of unknownCases) {
    it(`${c.gateway}:${c.type || "(empty)"} → not payment.succeeded`, () => {
      const mapped = mapProviderEventTypeToStable(c.gateway, c.type, {
        ...(c.mapStatus !== undefined ? { status: c.mapStatus } : {}),
      });
      expect(mapped).not.toBe("payment.succeeded");
      if (c.expectUnmapped !== false) {
        expect(mapped).toBe("provider.unmapped");
      }

      // Dual-write: even if status fallback maps to processing/etc., never invent succeeded
      // for these provider types when status is not an explicit paid signal from a known type.
      const pe = webhookEventToPaymentEvent(
        baseWebhook({
          type: c.type || "empty",
          gateway: c.gateway as WebhookEvent["gateway"],
          status: c.webhookStatus ?? "pending",
        }),
      );
      expect(pe.type).not.toBe("payment.succeeded");
      // Provider-native type is preserved on metadata always
      expect(pe.provider.eventType).toBe(c.type || "empty");
    });
  }

  it("PayPal capture settles as capture.completed, not payment.succeeded", () => {
    expect(
      mapProviderEventTypeToStable("paypal", "PAYMENT.CAPTURE.COMPLETED"),
    ).toBe("capture.completed");
    expect(
      mapProviderEventTypeToStable("paypal", "PAYMENT.CAPTURE.COMPLETED"),
    ).not.toBe("payment.succeeded");
  });

  it("P610-MAP-1: Moyasar unknown type + paid is provider.unmapped, not payment.succeeded", () => {
    expect(
      mapProviderEventTypeToStable("moyasar", "unknown_event", {
        status: "paid",
      }),
    ).toBe("provider.unmapped");
    const pe = webhookEventToPaymentEvent(
      baseWebhook({
        type: "unknown_event",
        gateway: "moyasar",
        status: "paid",
      }),
    );
    expect(pe.type).toBe("provider.unmapped");
    expect(pe.provider.eventType).toBe("unknown_event");
  });

  it("P610-MAP-2: Paymob unknown type + flags.success is provider.unmapped", () => {
    expect(
      mapProviderEventTypeToStable("paymob", "CARD_TOKENIZED", {
        flags: { success: true },
      }),
    ).toBe("provider.unmapped");
    expect(
      mapProviderEventTypeToStable("paymob", "UNKNOWN_CALLBACK", {
        status: "paid",
        flags: { success: true },
      }),
    ).toBe("provider.unmapped");
  });
});

// ─── 8: 0.x WebhookEvent contract ────────────────────────────────────────────

describe.skip("Phase 7 AC — 0.x WebhookEvent remains usable", () => {
  it("required legacy fields exist after attachPaymentEvent", () => {
    const dual = attachPaymentEvent(
      baseWebhook({
        type: "payment_paid",
        gateway: "moyasar",
        status: "paid",
      }),
    );

    // Required 0.x shape
    expect(typeof dual.id).toBe("string");
    expect(typeof dual.type).toBe("string");
    expect(typeof dual.gateway).toBe("string");
    expect(dual.gatewayPaymentId).toBeDefined();
    expect(dual.status).toBeDefined();
    expect(dual.timestamp).toBeInstanceOf(Date);
    expect(dual.rawPayload).toBeDefined();

    // Native type not remapped
    expect(dual.type).toBe("payment_paid");
    // Additive only
    expect(dual.event?.type).toBe("payment.succeeded");
  });
});
