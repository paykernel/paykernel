import { handleCloudflareWebhook } from "@paykernel/integration-cloudflare-workers";
import {
  dispatchCheckoutRequest,
  type CheckoutFetchApp,
  type CheckoutHttpOptions,
  type CheckoutKernel,
} from "@paykernel/example-checkout-kernel";

/**
 * Thin Cloudflare Workers fetch adapter.
 * Uses `handleCloudflareWebhook` for Stripe webhooks; other routes via `dispatchCheckoutRequest`.
 *
 * Tests run in Bun with `store-sqlite` (single-host). Production Workers must inject
 * D1/DO/`@paykernel/store-d1` — do not use this example's SQLite in production.
 * Do not static-import `cloudflare:workers` here.
 */
export function createCloudflareCheckoutFetch(
  kernel: CheckoutKernel,
  options: CheckoutHttpOptions = {},
): CheckoutFetchApp {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/webhooks/stripe") {
        return handleCloudflareWebhook(req, {
          gateway: kernel.webhook.gateway,
          client: kernel.webhook.client,
          engine: kernel.webhook.engine,
          handler: kernel.webhook.handler,
        });
      }
      return dispatchCheckoutRequest(kernel, req, options);
    },
  };
}
