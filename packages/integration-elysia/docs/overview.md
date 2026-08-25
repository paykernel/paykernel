# @paykernel/integration-elysia overview

- Depends only on `@paykernel/integration-http`.
- Portable (`paymentsSdk.portable: true`), peer `elysia >=1`.
- `elysiaWebhook(path, options)` returns an `Elysia` with `POST path` registered as `parse: "none"`.
- Uses `request.text()` / `request.headers` / `URL.searchParams` → `processWebhookHttp`.
