import { Hono } from "hono";
import { honoWebhook } from "@paykernel/integration-hono";
import {
  checkoutJsonResponse,
  createCheckoutHandlers,
  createPaymentInputFromUnknown,
  gatewayPaymentIdFromUnknown,
  readRequestJson,
  type CheckoutHttpOptions,
  type CheckoutKernel,
} from "@paykernel/example-checkout-kernel";

/**
 * Thin Hono checkout adapter. Stripe HMAC is verified on `Request.text()` via
 * `processWebhookHttp` (raw-body-safe `engine.processWithVerifier` with
 * `client.handleWebhook` as verify-only verifier, then inbox claim).
 * Do not use `c.req.json()` or any body parser on `/webhooks/stripe`.
 * WEBHOOKS-2: fulfillment lives only in `kernel.webhook.handler` after the
 * inbox claim — never in `onWebhookVerified` (see docs/getting-started.md).
 *
 * `/internal/reconcile`, `/internal/provider-paid`, and `/internal/create-count`
 * are test hooks. They are unauthenticated — do not deploy them.
 */
export function createHonoCheckoutApp(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): Hono {
  const handlers = createCheckoutHandlers(kernel, options);
  const app = new Hono();

  app.post("/payments", async (c) => {
    try {
      const input = createPaymentInputFromUnknown(await readRequestJson(c.req.raw));
      return checkoutJsonResponse(await handlers.createPayment(input));
    } catch (err) {
      if (err instanceof SyntaxError) {
        return checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
      }
      throw err;
    }
  });

  app.post(
    "/webhooks/stripe",
    honoWebhook({
      gateway: kernel.webhook.gateway,
      client: kernel.webhook.client,
      engine: kernel.webhook.engine,
      handler: kernel.webhook.handler,
    }),
  );

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post("/internal/reconcile", async () => {
    return checkoutJsonResponse(await handlers.reconcile());
  });

  app.get("/orders/:orderId", (c) => {
    return checkoutJsonResponse(handlers.getOrder(c.req.param("orderId")));
  });

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post("/internal/provider-paid", async (c) => {
    try {
      const gatewayPaymentId = gatewayPaymentIdFromUnknown(await readRequestJson(c.req.raw));
      return checkoutJsonResponse(
        gatewayPaymentId === undefined
          ? handlers.providerPaid({})
          : handlers.providerPaid({ gatewayPaymentId }),
      );
    } catch (err) {
      if (err instanceof SyntaxError) {
        return checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
      }
      throw err;
    }
  });

  // Test hook only — unauthenticated. Do not deploy this route.
  app.get("/internal/create-count", () => {
    return checkoutJsonResponse(handlers.createCount());
  });

  return app;
}
