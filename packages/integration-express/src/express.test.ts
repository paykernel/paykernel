import { describe, it, expect } from "bun:test";
import { expressRawJson, expressWebhook } from "./express";
import type { WebhookClient } from "@paykernel/integration-http";

function makeStubEngine() {
  return {
    mode: "inline" as const,
    processWithVerifier: async (input: {
      raw: unknown;
      verifyAndNormalize: (raw: unknown) => Promise<{ ok: true; gateway: string; providerEventId: string; payloadHash: string; event: unknown } | { ok: false; reason?: string }>;
      handler?: (ctx: unknown) => Promise<void> | void;
    }) => {
      const res = await input.verifyAndNormalize(input.raw);
      if (!res.ok) return { outcome: "invalid_webhook" } as const;
      if (input.handler) await input.handler({ event: (res as { ok: true; event: unknown }).event } as unknown);
      return { outcome: "processed" } as const;
    },
    processVerified: async () => ({ outcome: "processed" } as const),
    processRetryable: async () => ({ items: [] }),
    renewLease: async () => ({ ok: false, reason: "lease_lost" } as const),
  } as unknown as never;
}

function mockReqRes(body: unknown, headers: Record<string, string> = {}): { req: unknown; res: unknown; promise: Promise<{ status: number; body: unknown; headers: Record<string,string> }> } {
  let resolve!: (v: { status: number; body: unknown; headers: Record<string,string> }) => void;
  const promise = new Promise<{ status: number; body: unknown; headers: Record<string,string> }>((r) => (resolve = r));
  const resHeaders: Record<string,string> = {};
  const req = {
    body,
    headers: { ...headers, "content-type": "application/json" },
    query: {},
  };
  const res = {
    setHeader(k: string, v: string) { resHeaders[k.toLowerCase()] = v; },
    status(code: number) { (res as unknown as { _status: number })._status = code; return res; },
    json(payload: unknown) {
      const status = (res as unknown as { _status: number })._status ?? 200;
      resolve({ status, body: payload, headers: resHeaders });
    },
  };
  return { req, res, promise };
}

describe("expressWebhook", () => {
  it("forwards Buffer body", async () => {
    const engine = makeStubEngine() as never;
    let seen: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, p) {
        seen = p;
        return { id: "evt_1", payloadHash: "ph", event: {} };
      },
    };
    const handler = expressWebhook({ gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    const raw = '{"a":1}';
    const buf = Buffer.from(raw, "utf8");
    const { req, res, promise } = mockReqRes(buf, { "stripe-signature": "sig" });
    await (handler as unknown as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, res, () => {});
    const out = await promise;
    expect(out.status).toBe(200);
    expect(seen).toBe(raw);
  });

  it("fails closed on parsed object body and does not call client", async () => {
    const engine = makeStubEngine() as never;
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt" } as never;
      },
    };
    const handler = expressWebhook({ gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    const { req, res, promise } = mockReqRes({ a: 1 }, { "stripe-signature": "sig" });
    await (handler as unknown as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, res, () => {});
    const out = await promise;
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ error: "invalid_webhook" });
    expect(called).toBe(false);
  });

  it("forwards object body via JSON.stringify for tap (object-HMAC)", async () => {
    const engine = makeStubEngine() as never;
    let seen: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, p) {
        seen = p;
        return { id: "evt_tap", payloadHash: "ph", event: {} };
      },
    };
    const handler = expressWebhook({ gateway: "tap", client, engine: engine as never, handler: async () => {} });
    const { req, res, promise } = mockReqRes({ amount: 100, currency: "SAR" }, { hashstring: "sig" });
    await (handler as unknown as (req: unknown, res: unknown, next: unknown) => Promise<void>)(req, res, () => {});
    const out = await promise;
    expect(out.status).toBe(200);
    // processWebhookHttp parses "[object]" then gateway receives object
    expect(typeof seen).toBe("object");
    expect(seen).toEqual({ amount: 100, currency: "SAR" });
  });

  it("expressRawJson returns a middleware function", () => {
    const mw = expressRawJson();
    expect(typeof mw).toBe("function");
  });
});
