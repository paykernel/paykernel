# @paykernel/integration-express overview

- Depends only on `@paykernel/integration-http`, `express` peer >=4.
- `runtime: "node-only"`, not portable.
- `expressWebhook` fails closed on parsed object bodies (400).
