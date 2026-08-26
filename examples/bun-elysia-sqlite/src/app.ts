import { Elysia } from "elysia";
import { elysiaWebhook } from "@paykernel/integration-elysia";
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
 * Stripe webhook reads `request.text()` with `parse: "none"` — no JSON body
 * parser — then `processWebhookHttp` (verify-only `handleWebhook` + inbox
 * claim). WEBHOOKS-2: fulfillment only in `kernel.webhook.handler` after claim,
 * never in `onWebhookVerified` (see docs/getting-started.md).
 *
 * `/internal/reconcile`, `/internal/provider-paid`, and `/internal/create-count`
 * are test hooks. They are unauthenticated — do not deploy them.
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

  app.use(
    elysiaWebhook("/webhooks/stripe", {
      gateway: kernel.webhook.gateway,
      client: kernel.webhook.client,
      engine: kernel.webhook.engine,
      handler: kernel.webhook.handler,
    }),
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

  // Test hook only — unauthenticated. Do not deploy this route.
  app.get("/internal/create-count", () => checkoutJsonResponse(handlers.createCount()));

  return app;
}
