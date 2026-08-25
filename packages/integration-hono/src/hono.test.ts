import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { honoWebhook } from "./hono";
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

describe("honoWebhook", () => {
  it("forwards raw body unchanged and returns 200", async () => {
    const engine = makeStubEngine() as never;
    let seenPayload: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, payload) {
        seenPayload = payload;
        return { id: "evt_1", payloadHash: "ph", event: {} };
      },
    };
    const app = new Hono();
    app.post("/webhooks/stripe", honoWebhook({ gateway: "stripe", client, engine: engine as never, handler: async () => {} }));

    const raw = '{"a":1,"b":2}';
    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(seenPayload).toBe(raw);
  });

  it("returns 400 when required stripe signature missing and does not call client", async () => {
    const engine = makeStubEngine() as never;
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt_1" } as never;
      },
    };
    const app = new Hono();
    app.post("/webhooks/stripe", honoWebhook({ gateway: "stripe", client, engine: engine as never, handler: async () => {} }));

    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("uses c.req.raw and request.text() and not c.req.json() in production source", () => {
    const src = readFileSync(join(import.meta.dir, "hono.ts"), "utf8");
    expect(src).toContain("c.req.raw");
    const hasText = src.includes("request.text()") || src.includes(".text()");
    expect(hasText).toBe(true);
    expect(src).not.toContain("c.req.json()");
  });
});
