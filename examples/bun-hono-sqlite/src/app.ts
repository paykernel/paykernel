import { Hono } from "hono";
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
 * Thin Hono checkout adapter. Stripe HMAC is verified on Request.text();
 * do not use c.req.json() or any body parser on /webhooks/stripe.
 *
 * `/internal/reconcile` and `/internal/provider-paid` are test hooks.
 * They are unauthenticated — do not deploy them.
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

  app.post("/webhooks/stripe", async (c) => {
    const request = c.req.raw;
    const raw = await request.text();
    const signature = request.headers.get("stripe-signature");
    return checkoutJsonResponse(await handlers.handleStripeWebhook(raw, signature));
  });

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

  app.get("/internal/create-count", () => {
    return checkoutJsonResponse(handlers.createCount());
  });

  return app;
}
