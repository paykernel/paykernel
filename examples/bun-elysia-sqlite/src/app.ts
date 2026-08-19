import { Elysia } from "elysia";
import {
  checkoutJsonResponse,
  createCheckoutHandlers,
  createPaymentInputFromUnknown,
  gatewayPaymentIdFromUnknown,
  readRequestJson,
  type CheckoutHttpOptions,
  type CheckoutKernel,
} from "@paykernel/example-checkout-kernel";

const noParse = { parse: "none" as const };

function invalidJsonResponse(): Response {
  return checkoutJsonResponse({ status: 400, body: { error: "invalid_json" } });
}

/**
 * Thin Elysia adapter over {@link createCheckoutHandlers}.
 * Stripe webhook reads `request.text()` with `parse: "none"` — no JSON body parser.
 *
 * `/internal/reconcile` and `/internal/provider-paid` are test hooks.
 * They are unauthenticated — do not deploy them.
 */
export function createElysiaCheckoutApp(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): Elysia {
  const handlers = createCheckoutHandlers(kernel, options);
  const app = new Elysia();

  app.post(
    "/payments",
    async ({ request }) => {
      try {
        return checkoutJsonResponse(
          await handlers.createPayment(
            createPaymentInputFromUnknown(await readRequestJson(request)),
          ),
        );
      } catch (err) {
        if (err instanceof SyntaxError) return invalidJsonResponse();
        throw err;
      }
    },
    noParse,
  );

  app.post(
    "/webhooks/stripe",
    async ({ request }) => {
      const rawBody = await request.text();
      const signature =
        request.headers.get("stripe-signature") ?? request.headers.get("Stripe-Signature");
      return checkoutJsonResponse(await handlers.handleStripeWebhook(rawBody, signature));
    },
    noParse,
  );

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post(
    "/internal/reconcile",
    async () => checkoutJsonResponse(await handlers.reconcile()),
    noParse,
  );

  app.get("/orders/:orderId", ({ params }) =>
    checkoutJsonResponse(handlers.getOrder(params.orderId)),
  );

  // Test hook only — unauthenticated. Do not deploy this route.
  app.post(
    "/internal/provider-paid",
    async ({ request }) => {
      try {
        const gatewayPaymentId = gatewayPaymentIdFromUnknown(await readRequestJson(request));
        return checkoutJsonResponse(
          gatewayPaymentId === undefined
            ? handlers.providerPaid({})
            : handlers.providerPaid({ gatewayPaymentId }),
        );
      } catch (err) {
        if (err instanceof SyntaxError) return invalidJsonResponse();
        throw err;
      }
    },
    noParse,
  );

  app.get("/internal/create-count", () => checkoutJsonResponse(handlers.createCount()));

  return app;
}
