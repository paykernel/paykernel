// file: packages/core/src/runtime/payment-runtime.test.ts

import { describe, it, expect } from "bun:test";
import {
  createPaymentRuntime,
  mergePaymentRuntime,
  paymentRuntimeFromContext,
} from "./payment-runtime";
import { systemClock } from "./clock";
import { createDefaultGatewayContext } from "../gateways/gateway-context";
import { createPaymentClient } from "../create-payment-client";
import { stripeGateway } from "../gateways/factories";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe.skip("createPaymentRuntime", () => {
  it.skip("defaults use globalThis.fetch and produce valid UUID", () => {
    const rt = createPaymentRuntime();
    expect(typeof rt.fetch).toBe("function");
    // Same binding target as global fetch (bound to globalThis)
    expect(rt.fetch).toBeInstanceOf(Function);
    expect(rt.clock.now()).toBeInstanceOf(Date);
    expect(typeof rt.clock.nowMs()).toBe("number");
    expect(rt.randomUUID()).toMatch(UUID_RE);
    expect(typeof rt.crypto.randomUUID()).toBe("string");
    expect(typeof rt.crypto.getRandomValues).toBe("function");
  });

  it.skip("honors partial override of fetch / clock / crypto / randomUUID", () => {
    const calls: string[] = [];
    const customFetch = (async () => {
      calls.push("fetch");
      return new Response("ok");
    }) as typeof globalThis.fetch;
    const fixedMs = 1_700_000_000_000;
    const customClock = {
      now: () => new Date(fixedMs),
      nowMs: () => fixedMs,
    };
    const customCrypto = {
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
      getRandomValues: <T extends ArrayBufferView>(a: T) => a,
    };
    const rt = createPaymentRuntime({
      fetch: customFetch,
      clock: customClock,
      crypto: customCrypto,
      randomUUID: () => "fixed-from-runtime",
    });
    expect(rt.fetch).toBe(customFetch);
    expect(rt.clock.nowMs()).toBe(fixedMs);
    expect(rt.crypto).toBe(customCrypto);
    expect(rt.randomUUID()).toBe("fixed-from-runtime");
  });

  it.skip("systemClock matches Date.now approximately", () => {
    const before = Date.now();
    const ms = systemClock.nowMs();
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});

describe.skip("mergePaymentRuntime / paymentRuntimeFromContext", () => {
  it.skip("merge keeps base when partial is empty/undefined", () => {
    const base = createPaymentRuntime();
    expect(mergePaymentRuntime(base)).toBe(base);
    const merged = mergePaymentRuntime(base, {});
    expect(merged.fetch).toBe(base.fetch);
    expect(merged.crypto).toBe(base.crypto);
  });

  it.skip("merge overrides only provided keys", () => {
    const base = createPaymentRuntime();
    const clock = { now: () => new Date(0), nowMs: () => 0 };
    const merged = mergePaymentRuntime(base, { clock });
    expect(merged.clock).toBe(clock);
    expect(merged.fetch).toBe(base.fetch);
    expect(merged.crypto).toBe(base.crypto);
  });

  it.skip("paymentRuntimeFromContext projects GatewayContext runtime fields", () => {
    const mockFetch = (async () => new Response()) as typeof fetch;
    const ctx = createDefaultGatewayContext({
      fetch: mockFetch,
      randomUUID: () => "ctx-uuid",
    });
    const rt = paymentRuntimeFromContext(ctx);
    expect(rt.fetch).toBe(mockFetch);
    expect(rt.crypto).toBe(ctx.crypto);
    expect(rt.clock).toBe(ctx.clock);
    expect(rt.randomUUID()).toBe("ctx-uuid");
  });
});

describe.skip("createDefaultGatewayContext runtime wiring", () => {
  it.skip("returns injected fetch from partial", () => {
    const mockFetch = (async () => new Response("x")) as typeof fetch;
    const ctx = createDefaultGatewayContext({ fetch: mockFetch });
    expect(ctx.fetch).toBe(mockFetch);
  });

  it.skip("accepts nested runtime bag and top-level overrides win", () => {
    const nestedFetch = (async () => new Response("n")) as typeof fetch;
    const topFetch = (async () => new Response("t")) as typeof fetch;
    const fixedMs = 42;
    const ctx = createDefaultGatewayContext({
      runtime: {
        fetch: nestedFetch,
        clock: { now: () => new Date(fixedMs), nowMs: () => fixedMs },
      },
      fetch: topFetch,
    });
    expect(ctx.fetch).toBe(topFetch);
    expect(ctx.clock.nowMs()).toBe(fixedMs);
    expect(typeof ctx.randomUUID()).toBe("string");
    expect(ctx.uuid()).toMatch(UUID_RE);
  });

  it.skip("exposes PaymentRuntime fields on GatewayContext", () => {
    const ctx = createDefaultGatewayContext();
    expect(typeof ctx.randomUUID).toBe("function");
    expect(ctx.randomUUID()).toMatch(UUID_RE);
    expect(ctx.uuid()).toMatch(UUID_RE);
  });
});

describe.skip("createPaymentClient runtime option", () => {
  it.skip("passes runtime into GatewayContext and routes HTTP through injected fetch", async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    let globalHits = 0;
    globalThis.fetch = (async () => {
      globalHits += 1;
      throw new Error("must not use global fetch when runtime.fetch is set");
    }) as typeof fetch;

    try {
      const mockFetch = (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(
          JSON.stringify({
            id: "pi_runtime_wire",
            object: "payment_intent",
            status: "requires_payment_method",
            amount: 100,
            currency: "usd",
            client_secret: "sec",
            metadata: {},
            latest_charge: null,
            receipt_email: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch;

      const fixedMs = 1_234_567_890_000;
      const client = createPaymentClient({
        gateways: {
          stripe: stripeGateway({
            secretKey: "sk_test_phase8_runtime_mock",
            webhookSecret: "whsec_test",
          }),
        },
        defaultGateway: "stripe",
        runtime: {
          fetch: mockFetch,
          clock: {
            now: () => new Date(fixedMs),
            nowMs: () => fixedMs,
          },
          randomUUID: () => "11111111-1111-4111-8111-111111111111",
        },
      });

      expect(client.hasGateway("stripe")).toBe(true);
      const result = await client.createPayment({
        amount: 1,
        currency: "USD",
        callbackUrl: "https://example.com",
      });
      expect(result.gatewayId).toBe("pi_runtime_wire");
      expect(seen.some((u) => u.includes("api.stripe.com"))).toBe(true);
      expect(globalHits).toBe(0);

      const ctx = createDefaultGatewayContext({
        runtime: {
          fetch: mockFetch,
          clock: {
            now: () => new Date(fixedMs),
            nowMs: () => fixedMs,
          },
          randomUUID: () => "11111111-1111-4111-8111-111111111111",
        },
      });
      expect(ctx.fetch).toBe(mockFetch);
      expect(ctx.clock.nowMs()).toBe(fixedMs);
      expect(ctx.randomUUID()).toBe("11111111-1111-4111-8111-111111111111");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
