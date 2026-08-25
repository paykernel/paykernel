# @paykernel/integration-elysia

Thin Elysia adapter for `@paykernel/integration-http`.

```ts
import { Elysia } from "elysia";
import { elysiaWebhook } from "@paykernel/integration-elysia";

const app = new Elysia()
  .use(elysiaWebhook("/webhooks/stripe", { gateway: "stripe", client, engine, handler }))
  .listen(3000);
```

- Registers `POST path` with `{ parse: "none" }` — no JSON parser on webhook route.
- Uses `request.text()` and `request.headers`.
- Re-exports `mapInboxOutcome`, `processWebhookHttp`, `requireStringBindings`.
