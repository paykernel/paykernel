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

- `expressRawJson()` is `express.raw({ type: "application/json" })` — use only on webhook routes. `type-is` handles `; charset=utf-8` automatically (no custom type function needed).
- Gateway-aware object-body: if `req.body` is already a parsed object, `tap`/`moyasar`/`paymob` (object-HMAC gateways, see `integration-http/src/process.ts:130`) serialize via `JSON.stringify` and forward as `rawBody`; string-HMAC gateways (`stripe`, `paypal`, `myfatoorah`, etc.) fail-closed with `400 { error: "invalid_webhook" }` without calling the client (re-serialization would not be byte-identical).
- Uses `req.headers` and `req.query` string values. Handles `Buffer`/`string`/`Uint8Array` bodies (preserves `Buffer.isBuffer` guard).
