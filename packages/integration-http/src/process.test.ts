import { describe, it, expect } from "bun:test";
import { InvalidWebhookError, InvalidRequestError } from "@paykernel/core";
import { createWebhookInboxEngine, type WebhookInboxEngine } from "@paykernel/webhooks";
import { createFakeClock, createMemoryWebhookInboxStore } from "@paykernel/testkit";
import { processWebhookHttp } from "./process";
import type { WebhookClient } from "./process";

function makeEngine() {
  const clock = createFakeClock({ initialMs: 1_000 });
  const store = createMemoryWebhookInboxStore({ clock });
  const engine = createWebhookInboxEngine({ store, mode: "inline", clock });
  return { engine, clock, store };
}

describe("processWebhookHttp", () => {
  it("forwards valid event to 200 processed and preserves raw body identity", async () => {
    const { engine } = makeEngine();
    let seenPayload: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_gateway, payload) {
        seenPayload = payload;
        return { id: "evt_1", payloadHash: "ph_1", event: { type: "paid" }, rawPayload: { type: "paid" } };
      },
    };
    const raw = '{"type":"paid"}';
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: raw,
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ outcome: "processed" });
    expect(seenPayload).toBe(raw);
    expect(result.headers["x-request-id"]).toBeDefined();
  });

  it("handles Uint8Array rawBody via TextDecoder", async () => {
    const { engine } = makeEngine();
    let seenPayload: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, p) {
        seenPayload = p;
        return { id: "evt_2", payloadHash: "ph_2", event: { x: 1 } };
      },
    };
    const bytes = new TextEncoder().encode('{"x":1}');
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: bytes,
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(seenPayload).toBe('{"x":1}');
  });

  it("returns 400 without calling client when required header missing", async () => {
    const { engine } = makeEngine();
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt_1" };
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: {},
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "invalid_webhook" });
    expect(called).toBe(false);
  });

  it("maps InvalidWebhookError to 400", async () => {
    const { engine } = makeEngine();
    const client: WebhookClient = {
      async handleWebhook() {
        throw new InvalidWebhookError("bad_sig");
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "invalid_webhook" });
  });

  it("maps InvalidRequestError to 500 retryable", async () => {
    const { engine } = makeEngine();
    const client: WebhookClient = {
      async handleWebhook() {
        throw new InvalidRequestError("missing secret");
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ outcome: "handler_failed", retryable: true });
  });

  it("echoes x-request-id and sets retry-after on 503", async () => {
    // Use a stub engine that returns already_processing with retryAfterMs
    const stubEngine = {
      mode: "inline" as const,
      processWithVerifier: async () => ({ outcome: "already_processing", retryAfterMs: 2500 } as const),
      processVerified: async () => ({ outcome: "already_processing" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;

    const client: WebhookClient = {
      async handleWebhook() {
        return { id: "evt_3", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig", "x-request-id": "req-123" },
      client,
      engine: stubEngine,
      handler: async () => {},
    });
    expect(result.headers["x-request-id"]).toBe("req-123");
    expect(result.status).toBe(503);
    expect(result.headers["retry-after"]).toBe("3");
  });
  it("maps scheduled_for_retry parked to 503 default and durable guard falls back to 503 on inline", async () => {
    const stubInline = {
      mode: "inline" as const,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;
    const stubDurable = {
      mode: "durable_retry" as const,
      workerGuaranteed: true as const,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;
    const stubDurableNoWorker = {
      mode: "durable_retry" as const,
      workerGuaranteed: false,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;

    const client: WebhookClient = {
      async handleWebhook() {
        return { id: "evt_4", payloadHash: "ph", event: {} };
      },
    };
    const r1 = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubInline,
      handler: async () => {},
    });
    expect(r1.status).toBe(503);
    expect(r1.body).toEqual({ outcome: "scheduled_for_retry", reason: "parked" });

    // inline + durable_worker should fallback to 503, not silently ACK
    const warnSpy: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnSpy.push(args.join(" "));
    const r2 = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubInline,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    console.warn = origWarn;
    expect(r2.status).toBe(503);
    expect(warnSpy.join(" ")).toContain("durable_worker");

    // durable_retry + durable_worker should be 200
    const r3 = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubDurable,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    expect(r3.status).toBe(200);

    // durable_retry but workerGuaranteed false should also fallback to 503
    const r4 = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubDurableNoWorker,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    expect(r4.status).toBe(503);

    // durable_retry without workerGuaranteed (strict: missing => 503)
    const stubDurableMissing = {
      mode: "durable_retry" as const,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "parked" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;
    const r5 = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubDurableMissing,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    expect(r5.status).toBe(503);
  });
  it("handles handler_retry with durable_worker guard", async () => {
    const stubInline = {
      mode: "inline" as const,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "handler_retry" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "handler_retry" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;
    const stubDurable = {
      mode: "durable_retry" as const,
      workerGuaranteed: true as const,
      processWithVerifier: async () => ({ outcome: "scheduled_for_retry", reason: "handler_retry" } as const),
      processVerified: async () => ({ outcome: "scheduled_for_retry", reason: "handler_retry" } as const),
      processRetryable: async () => ({ items: [] }),
      renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
    } as unknown as WebhookInboxEngine;
    const client: WebhookClient = {
      async handleWebhook() {
        return { id: "evt_hr", payloadHash: "ph", event: {} };
      },
    };
    const rInline = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubInline,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    expect(rInline.status).toBe(503);
    const rDurable = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine: stubDurable,
      handler: async () => {},
      ackPolicy: { kind: "durable_worker" },
    });
    expect(rDurable.status).toBe(200);
  });

  it("fails closed on missing providerEventId as 500 not 400", async () => {
    const { engine } = makeEngine();
    const client: WebhookClient = {
      async handleWebhook() {
        return { payloadHash: "ph", event: {} } as unknown as { id: string };
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(500);
  });

  it("extracts paypal headers record and forwards to handleWebhook", async () => {
    const { engine } = makeEngine();
    let seenSig: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, _p, sig) {
        seenSig = sig;
        return { id: "evt_paypal", payloadHash: "ph", event: {} };
      },
    };
    const headers = {
      "paypal-transmission-id": "tid",
      "paypal-transmission-time": "t",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "url",
      "paypal-auth-algo": "algo",
    };
    const result = await processWebhookHttp({
      gateway: "paypal",
      rawBody: '{"a":1}',
      headers,
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(seenSig).toEqual({
      "paypal-transmission-id": "tid",
      "paypal-transmission-time": "t",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "url",
      "paypal-auth-algo": "algo",
    });
  });

  it("returns 400 early when paypal headers missing", async () => {
    const { engine } = makeEngine();
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt_paypal", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "paypal",
      rawBody: '{"a":1}',
      headers: {},
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "invalid_webhook" });
    expect(called).toBe(false);
  });

  it("returns 400 early when paypal headers partially missing", async () => {
    const { engine } = makeEngine();
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt_paypal", payloadHash: "ph", event: {} };
      },
    };
    const headers: Record<string, string> = {
      "paypal-transmission-id": "tid",
      "paypal-transmission-time": "t",
      // missing sig, cert-url, auth-algo
    };
    const result = await processWebhookHttp({
      gateway: "paypal",
      rawBody: '{"a":1}',
      headers,
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 early when paymob both header and query missing", async () => {
    const { engine } = makeEngine();
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt_paymob", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "paymob",
      rawBody: '{"a":1}',
      headers: {},
      query: {},
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("passes paymob when hmac in header", async () => {
    const { engine } = makeEngine();
    let seenSig: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, _p, sig) {
        seenSig = sig;
        return { id: "evt_paymob", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "paymob",
      rawBody: '{"obj":{"a":1}}',
      headers: { hmac: "header_hmac" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(seenSig).toBe("header_hmac");
  });

  it("passes paymob when hmac in query", async () => {
    const { engine } = makeEngine();
    let seenSig: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, _p, sig) {
        seenSig = sig;
        return { id: "evt_paymob", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "paymob",
      rawBody: '{"obj":{"a":1}}',
      headers: {},
      query: { hmac: "query_hmac" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(seenSig).toBe("query_hmac");
  });

  it("maybeParsedBody does not parse arrays for object-HMAC gateways", async () => {
    const { engine } = makeEngine();
    let seenPayload: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, p) {
        seenPayload = p;
        return { id: "evt_arr", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "tap",
      rawBody: "[1,2]",
      headers: { hashstring: "sig" },
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    expect(typeof seenPayload).toBe("string");
    expect(seenPayload).toBe("[1,2]");
  });

  it("headerBag first-wins invariant for duplicate case keys", async () => {
    const { engine } = makeEngine();
    let seenHeaders: Record<string, string> | undefined;
    const client: WebhookClient = {
      async handleWebhook(_g, _p, _sig, headers) {
        seenHeaders = headers;
        return { id: "evt_dup", payloadHash: "ph", event: {} };
      },
    };
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "Stripe-Signature": "first", "stripe-signature": "second" } as Record<string, string>,
      client,
      engine,
      handler: async () => {},
    });
    expect(result.status).toBe(200);
    // getHeader would return "first", headerBag lower record must match
    expect(seenHeaders?.["stripe-signature"]).toBe("first");
  });

  it("does not warn on empty onWebhookVerified array (hasHook false-positive fix)", async () => {
    const { engine } = makeEngine();
    const warnSpy: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnSpy.push(args.join(" "));
    const client = {
      async handleWebhook() {
        return { id: "evt_warn", payloadHash: "ph", event: {} };
      },
      hooks: { onWebhookVerified: [] },
    } as unknown as WebhookClient;
    const result = await processWebhookHttp({
      gateway: "stripe",
      rawBody: '{"a":1}',
      headers: { "stripe-signature": "sig" },
      client,
      engine,
      handler: async () => {},
    });
    console.warn = origWarn;
    expect(result.status).toBe(200);
    expect(warnSpy.join(" ")).not.toContain("WEBHOOKS-2");
  });
});
