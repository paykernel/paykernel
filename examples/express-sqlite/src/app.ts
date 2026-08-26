import express from "express";
import { expressRawJson, expressWebhook } from "@paykernel/integration-express";
import {
  checkoutJsonResponse,
  createCheckoutHandlers,
  createPaymentInputFromUnknown,
  gatewayPaymentIdFromUnknown,
  type CheckoutHttpOptions,
  type CheckoutKernel,
  type CheckoutFetchApp,
} from "@paykernel/example-checkout-kernel";
import { createServer } from "node:http";

/**
 * Thin Express checkout adapter. Stripe HMAC is verified on raw body via
 * `processWebhookHttp` (verify-only `handleWebhook` + inbox claim);
 * do not use `express.json()` on `/webhooks/stripe`. WEBHOOKS-2: fulfillment
 * only in `kernel.webhook.handler` after the inbox claim — never in
 * `onWebhookVerified` (see docs/getting-started.md).
 *
 * `/internal/reconcile`, `/internal/provider-paid`, and `/internal/create-count`
 * are test hooks. They are unauthenticated — do not deploy them.
 */
export function createExpressCheckoutApp(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): express.Application {
  const handlers = createCheckoutHandlers(kernel, options);
  const app = express();

  app.post("/payments", express.json(), async (req, res, next) => {
    try {
      const input = createPaymentInputFromUnknown(req.body);
      const result = await handlers.createPayment(input);
      const response = checkoutJsonResponse(result);
      res.status(response.status);
      for (const [k, v] of response.headers.entries()) {
        res.setHeader(k, v);
      }
      res.send(await response.text());
    } catch (err) {
      if (err instanceof SyntaxError) {
        const response = checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
        res.status(response.status);
        for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
        res.send(await response.text());
        return;
      }
      next(err);
    }
  });

  app.post(
    "/webhooks/stripe",
    expressRawJson(),
    expressWebhook({
      gateway: kernel.webhook.gateway,
      client: kernel.webhook.client,
      engine: kernel.webhook.engine,
      handler: kernel.webhook.handler,
    }),
  );

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post("/internal/reconcile", async (_req, res) => {
    const response = checkoutJsonResponse(await handlers.reconcile());
    res.status(response.status);
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.send(await response.text());
  });

  app.get("/orders/:orderId", async (req, res) => {
    const result = handlers.getOrder(req.params.orderId);
    const response = checkoutJsonResponse(result);
    res.status(response.status);
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.send(await response.text());
  });

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post("/internal/provider-paid", express.json(), async (req, res, next) => {
    try {
      const gatewayPaymentId = gatewayPaymentIdFromUnknown(req.body);
      const result =
        gatewayPaymentId === undefined
          ? handlers.providerPaid({})
          : handlers.providerPaid({ gatewayPaymentId });
      const response = checkoutJsonResponse(result);
      res.status(response.status);
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.send(await response.text());
    } catch (err) {
      if (err instanceof SyntaxError) {
        const response = checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
        res.status(response.status);
        for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
        res.send(await response.text());
        return;
      }
      next(err);
    }
  });

  // Test hook only — unauthenticated. Do not deploy this route.
  app.get("/internal/create-count", async (_req, res) => {
    const response = checkoutJsonResponse(handlers.createCount());
    res.status(response.status);
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.send(await response.text());
  });

  return app;
}

export function expressAppToFetch(app: express.Application): CheckoutFetchApp {
  return {
    async fetch(req: Request): Promise<Response> {
      const server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => resolve());
        server.on("error", reject);
      });
      const address = server.address() as { port: number };
      const url = new URL(req.url);
      const target = `http://127.0.0.1:${address.port}${url.pathname}${url.search}`;
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const bodyBuffer = hasBody && req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
      try {
        const res = await fetch(target, {
          method: req.method,
          headers,
          body: bodyBuffer as BodyInit | undefined,
        });
        const resHeaders = new Headers();
        res.headers.forEach((v, k) => resHeaders.set(k, v));
        const resBody = await res.arrayBuffer();
        return new Response(resBody, {
          status: res.status,
          headers: resHeaders,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}
