import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { elysiaWebhook } from "./elysia";
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

describe("elysiaWebhook", () => {
  it("registers parse:none and forwards raw body", async () => {
    const engine = makeStubEngine() as never;
    let seenPayload: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, payload) {
        seenPayload = payload;
        return { id: "evt_1", payloadHash: "ph", event: {} };
      },
    };
    const hook = elysiaWebhook("/webhooks/stripe", { gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    const app = new Elysia().use(hook);

    const raw = '{"hello":"world"}';
    const res = await app.handle(
      new Request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "sig", "content-type": "application/json" },
        body: raw,
      }),
    );
    expect(res.status).toBe(200);
    expect(seenPayload).toBe(raw);
  });

  it("returns 400 when required sig missing", async () => {
    const engine = makeStubEngine() as never;
    let called = false;
    const client: WebhookClient = {
      async handleWebhook() {
        called = true;
        return { id: "evt" } as never;
      },
    };
    const hook = elysiaWebhook("/webhooks/stripe", { gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    const app = new Elysia().use(hook);
    const res = await app.handle(
      new Request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
      }),
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("source contains parse none and request.text()", () => {
    const src = readFileSync(join(import.meta.dir, "elysia.ts"), "utf8");
    expect(src).toContain(`parse: "none"`);
    expect(src).toContain("request.text()");
  });
});
