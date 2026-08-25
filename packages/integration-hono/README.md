# @paykernel/integration-hono

Thin Hono adapter for `@paykernel/integration-http`. Converts a Hono request to `processWebhookHttp` and back. No payment logic, no store adapters.

```ts
import { Hono } from "hono";
import { honoWebhook } from "@paykernel/integration-hono";

const app = new Hono();
app.post("/webhooks/stripe", honoWebhook({
  gateway: "stripe",
  client,
  engine,
  handler,
}));
```

- Reads raw body via `c.req.raw.text()` — never `c.req.json()`.
- Uses `c.req.query()` for Paymob-style query signatures.
- Re-exports `mapInboxOutcome`, `processWebhookHttp`, `requireStringBindings` so apps can import one package.
