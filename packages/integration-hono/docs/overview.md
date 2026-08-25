# @paykernel/integration-hono overview

- Depends only on `@paykernel/integration-http`.
- Portable (`paymentsSdk.portable: true`).
- Peer `hono >=4` required.
- Handler reads `c.req.raw.text()` and `request.headers`, uses `c.req.query()`, calls `processWebhookHttp`, returns `webhookHttpResultToResponse`.
- No JSON parsing on webhook route.
