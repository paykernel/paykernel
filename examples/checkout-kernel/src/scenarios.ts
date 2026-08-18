import { describe, expect, it } from "bun:test";
import { createCheckoutKernel, type CheckoutKernel } from "./kernel";
import {
  signedStripeCreatedWebhook,
  signedStripePaidWebhook,
  type SignedStripeWebhook,
} from "./stripe-webhook";
import type { CheckoutFetchApp } from "./types";

export type CheckoutScenarioCreateApp = (kernel: CheckoutKernel) => CheckoutFetchApp;

const ORIGIN = "http://checkout.test";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function postJson(app: CheckoutFetchApp, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.fetch(new Request(`${ORIGIN}${path}`, init));
}

function postStripeWebhook(
  app: CheckoutFetchApp,
  signed: SignedStripeWebhook,
): Promise<Response> {
  return app.fetch(
    new Request(`${ORIGIN}/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signed.signature,
      },
      body: signed.rawBody,
    }),
  );
}

async function createOrder(
  app: CheckoutFetchApp,
): Promise<{ orderId: string; gatewayPaymentId?: string }> {
  const res = await postJson(app, "/payments", {});
  expect(res.status).toBe(200);
  const body = await readJson(res);
  expect(typeof body.orderId).toBe("string");
  const out: { orderId: string; gatewayPaymentId?: string } = {
    orderId: body.orderId as string,
  };
  if (typeof body.gatewayPaymentId === "string") {
    out.gatewayPaymentId = body.gatewayPaymentId;
  }
  return out;
}

async function getOrder(
  app: CheckoutFetchApp,
  orderId: string,
): Promise<Record<string, unknown>> {
  const res = await app.fetch(new Request(`${ORIGIN}/orders/${orderId}`));
  expect(res.status).toBe(200);
  return readJson(res);
}

async function getCreateCount(app: CheckoutFetchApp): Promise<number> {
  const res = await app.fetch(new Request(`${ORIGIN}/internal/create-count`));
  expect(res.status).toBe(200);
  const body = await readJson(res);
  expect(typeof body.count).toBe("number");
  return body.count as number;
}

/**
 * Shared HTTP scenarios for checkout-kernel and thin Hono/Elysia adapters.
 * Each `it` builds its own kernel + app and `close()`s in `finally`.
 */
export function runCheckoutHttpScenarios(
  name: string,
  createApp: CheckoutScenarioCreateApp,
): void {
  describe(name, () => {
    it("paid create does not fulfill", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("signed Stripe paid webhook fulfills once", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const res = await postStripeWebhook(app, signed);
        expect(res.status).toBe(200);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("paid");
        expect(order.fulfillCount).toBe(1);
      } finally {
        kernel.close();
      }
    });

    it("redelivery 200 no second fulfill", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const first = await postStripeWebhook(app, signed);
        expect(first.status).toBe(200);
        const second = await postStripeWebhook(app, signed);
        expect(second.status).toBe(200);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("paid");
        expect(order.fulfillCount).toBe(1);
      } finally {
        kernel.close();
      }
    });

    it("bad sig 400", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const res = await app.fetch(
          new Request(`${ORIGIN}/webhooks/stripe`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "stripe-signature": `t=${signed.timestamp},v1=${"ab".repeat(32)}`,
            },
            body: signed.rawBody,
          }),
        );
        expect(res.status).toBe(400);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("JSON.parse+stringify body 400", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const parsed = JSON.parse(signed.rawBody) as unknown;
        let reserialized = JSON.stringify(parsed);
        if (reserialized === signed.rawBody) {
          reserialized = JSON.stringify(parsed, null, 2);
        }
        expect(reserialized).not.toBe(signed.rawBody);
        const res = await app.fetch(
          new Request(`${ORIGIN}/webhooks/stripe`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "stripe-signature": signed.signature,
            },
            body: reserialized,
          }),
        );
        expect(res.status).toBe(400);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("concurrent same body one fulfill", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const [a, b] = await Promise.all([
          postStripeWebhook(app, signed),
          postStripeWebhook(app, signed),
        ]);
        expect([200, 503]).toContain(a.status);
        expect([200, 503]).toContain(b.status);
        expect(a.status === 200 || b.status === 200).toBe(true);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("paid");
        expect(order.fulfillCount).toBe(1);
      } finally {
        kernel.close();
      }
    });

    it("fulfillThrows before mark paid -> 500 unpaid", async () => {
      const kernel = await createCheckoutKernel({ fulfillThrows: true });
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripePaidWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const res = await postStripeWebhook(app, signed);
        expect(res.status).toBe(500);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("payment_intent.created 200 unpaid", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        const signed = signedStripeCreatedWebhook({
          orderId: created.orderId,
          nowMs: kernel.clock.nowMs(),
        });
        const res = await postStripeWebhook(app, signed);
        expect(res.status).toBe(200);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("indeterminate create, provider-paid, reconcile pays without second create", async () => {
      const kernel = await createCheckoutKernel({
        scriptCreate: [{ outcome: "indeterminate" }],
      });
      const app = createApp(kernel);
      try {
        const created = await createOrder(app);
        expect(created.gatewayPaymentId).toBeDefined();
        expect(await getCreateCount(app)).toBe(1);
        expect(kernel.createPaymentCount()).toBe(1);

        const mark = await postJson(app, "/internal/provider-paid", {
          gatewayPaymentId: created.gatewayPaymentId,
        });
        expect(mark.status).toBe(200);

        const recon = await postJson(app, "/internal/reconcile");
        expect(recon.status).toBe(200);

        expect(await getCreateCount(app)).toBe(1);
        expect(kernel.createPaymentCount()).toBe(1);
        const order = await getOrder(app, created.orderId);
        expect(order.status).toBe("paid");
        expect(order.fulfillCount).toBe(1);
      } finally {
        kernel.close();
      }
    });

    it("invalid amount maps to 400 without creating an order", async () => {
      const kernel = await createCheckoutKernel();
      const app = createApp(kernel);
      try {
        const res = await postJson(app, "/payments", { amount: "10.001", currency: "USD" });
        expect(res.status).toBe(400);
        expect(await getCreateCount(app)).toBe(0);
      } finally {
        kernel.close();
      }
    });

    it("provider-side client timeout keeps the order, schedules recon, and does not charge again", async () => {
      const kernel = await createCheckoutKernel({
        scriptCreate: [{ outcome: "provider_ok_client_timeout" }],
      });
      const app = createApp(kernel);
      try {
        const res = await postJson(app, "/payments", {});
        expect(res.status).toBe(200);
        const created = await readJson(res);
        expect(created.outcome).toBe("indeterminate");
        expect(created.reconciliationRequired).toBe(true);
        expect(typeof created.orderId).toBe("string");
        expect(created.gatewayPaymentId).toBeUndefined();
        expect(await getCreateCount(app)).toBe(1);

        const recon = await postJson(app, "/internal/reconcile");
        expect(recon.status).toBe(200);
        expect(await getCreateCount(app)).toBe(1);
        const order = await getOrder(app, created.orderId as string);
        expect(order.status).toBe("unpaid");
        expect(order.fulfillCount).toBe(0);
        expect(order.gatewayPaymentId).toBeUndefined();
      } finally {
        kernel.close();
      }
    });

    it("create NetworkError keeps the order and does not leak err.message", async () => {
      const kernel = await createCheckoutKernel({
        scriptCreate: [{ outcome: "network_error", message: "do-not-leak-network-detail" }],
      });
      const app = createApp(kernel);
      try {
        const res = await postJson(app, "/payments", {});
        expect(res.status).toBe(200);
        const body = await readJson(res);
        expect(body.outcome).toBe("indeterminate");
        expect(body.reconciliationRequired).toBe(true);
        expect(JSON.stringify(body)).not.toContain("do-not-leak-network-detail");
        expect(await getCreateCount(app)).toBe(1);
        const order = await getOrder(app, body.orderId as string);
        expect(order.status).toBe("unpaid");
        expect(order.gatewayPaymentId).toBeUndefined();
      } finally {
        kernel.close();
      }
    });

    it("does not bind last provider-side success onto another order", async () => {
      const kernel = await createCheckoutKernel({
        scriptCreate: [
          { outcome: "provider_ok_client_timeout" },
          { outcome: "network_error" },
        ],
      });
      const app = createApp(kernel);
      try {
        const firstRes = await postJson(app, "/payments", { orderId: "order_a" });
        expect(firstRes.status).toBe(200);
        const first = await readJson(firstRes);
        expect(first.outcome).toBe("indeterminate");
        expect(first.gatewayPaymentId).toBeUndefined();

        const secondRes = await postJson(app, "/payments", { orderId: "order_b" });
        expect(secondRes.status).toBe(200);
        const second = await readJson(secondRes);
        expect(second.outcome).toBe("indeterminate");
        expect(second.gatewayPaymentId).toBeUndefined();
        expect(JSON.stringify(second)).not.toContain("Network error (mock)");

        const recon = await postJson(app, "/internal/reconcile");
        expect(recon.status).toBe(200);
        expect(await getCreateCount(app)).toBe(2);

        const orderA = await getOrder(app, "order_a");
        const orderB = await getOrder(app, "order_b");
        expect(orderA.status).toBe("unpaid");
        expect(orderA.fulfillCount).toBe(0);
        expect(orderA.gatewayPaymentId).toBeUndefined();
        expect(orderB.status).toBe("unpaid");
        expect(orderB.fulfillCount).toBe(0);
        expect(orderB.gatewayPaymentId).toBeUndefined();
      } finally {
        kernel.close();
      }
    });
  });
}
