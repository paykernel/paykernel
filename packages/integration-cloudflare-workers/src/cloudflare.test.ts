import { describe, it, expect } from "bun:test";
import { handleCloudflareWebhook, readWorkerBindings } from "./cloudflare";
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

describe("handleCloudflareWebhook", () => {
  it("forwards raw body and returns 200", async () => {
    const engine = makeStubEngine() as never;
    let seen: unknown = null;
    const client: WebhookClient = {
      async handleWebhook(_g, p) {
        seen = p;
        return { id: "evt_1", payloadHash: "ph", event: {} };
      },
    };
    const raw = '{"a":1}';
    const req = new Request("http://worker.test/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: raw,
    });
    const res = await handleCloudflareWebhook(req, { gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    expect(res.status).toBe(200);
    expect(seen).toBe(raw);
  });

  it("uses cf-ray for correlation when x-request-id absent", async () => {
    const engine = makeStubEngine() as never;
    const client: WebhookClient = {
      async handleWebhook() {
        return { id: "evt_2", payloadHash: "ph", event: {} };
      },
    };
    const req = new Request("http://worker.test/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig", "cf-ray": "ray-123" },
      body: '{"a":1}',
    });
    const res = await handleCloudflareWebhook(req, { gateway: "stripe", client, engine: engine as never, handler: async () => {} });
    expect(res.headers.get("x-request-id")).toBe("ray-123");
  });
});

describe("readWorkerBindings", () => {
  it("requires keys and throws on missing", () => {
    expect(readWorkerBindings({ A: "a" }, ["A"] as const).A).toBe("a");
    expect(() => readWorkerBindings({}, ["SECRET"] as const)).toThrow("missing env: SECRET");
  });
});
