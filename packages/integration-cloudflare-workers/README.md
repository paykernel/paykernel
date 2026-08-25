# @paykernel/integration-cloudflare-workers

Thin Cloudflare Workers adapter for `@paykernel/integration-http`.

```ts
import { handleCloudflareWebhook, readWorkerBindings } from "@paykernel/integration-cloudflare-workers";

export default {
  async fetch(request: Request, env: Record<string,string>) {
    const { STRIPE_WEBHOOK_SECRET } = readWorkerBindings(env, ["STRIPE_WEBHOOK_SECRET"]);
    if (new URL(request.url).pathname === "/webhooks/stripe" && request.method === "POST") {
      return handleCloudflareWebhook(request, { gateway: "stripe", client, engine, handler });
    }
    return new Response("not_found", { status: 404 });
  }
}
```

- Uses `request.text()` and `request.headers`, `URL.searchParams` for query.
- Correlation via `cf-ray` when `x-request-id` absent.
- No static `cloudflare:workers` import.
