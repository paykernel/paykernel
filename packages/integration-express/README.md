# @paykernel/integration-express

Thin Express adapter for `@paykernel/integration-http`. Node-only.

```ts
import express from "express";
import { expressRawJson, expressWebhook } from "@paykernel/integration-express";

const app = express();
app.post("/webhooks/stripe", expressRawJson(), expressWebhook({
  gateway: "stripe", client, engine, handler,
}));
app.post("/payments", express.json(), (req, res) => { ... });
```

- `expressRawJson()` is `express.raw({ type: "application/json" })` — use only on webhook routes.
- If `req.body` is already a parsed object, returns 400 without `JSON.stringify` (fail-closed).
- Uses `req.headers` and `req.query` string values.
