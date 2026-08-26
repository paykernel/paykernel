import { handleCloudflareWebhook } from "@paykernel/integration-cloudflare-workers";
import {
  dispatchCheckoutRequest,
  type CheckoutFetchApp,
  type CheckoutHttpOptions,
  type CheckoutKernel,
} from "@paykernel/example-checkout-kernel";

/**
 * Thin Cloudflare Workers fetch adapter.
 * Uses `handleCloudflareWebhook` / `processWebhookHttp` for Stripe webhooks
 * (raw-body-safe verify-only `handleWebhook` + inbox claim); other routes via
 * `dispatchCheckoutRequest`. Path guard `POST /webhooks/stripe` is required —
 * the worker handler itself only guards method (405 for non-POST).
 * WEBHOOKS-2: fulfillment only in `kernel.webhook.handler` after claim, never
 * in `onWebhookVerified` (see docs/getting-started.md).
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
