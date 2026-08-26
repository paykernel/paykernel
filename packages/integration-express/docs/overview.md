# @paykernel/integration-express overview

- Depends only on `@paykernel/integration-http`, `express` peer >=4.
- `runtime: "node-only"`, not portable.
- `expressWebhook` is gateway-aware for pre-parsed object bodies: `tap`/`moyasar`/`paymob` (object-HMAC) serialize via `JSON.stringify` and forward; string-HMAC gateways (`stripe`, `paypal`, `myfatoorah`, …) fail-closed 400. See `src/express.ts:OBJECT_GATEWAYS` / `integration-http/src/process.ts:130`.
- `expressRawJson()` is `express.raw({ type: "application/json" })` — `type-is` handles `; charset=utf-8` automatically.
