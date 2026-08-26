# @paykernel/example-cloudflare-workers-fetch

Thin Cloudflare Workers `fetch` example over `@paykernel/example-checkout-kernel`.

- Uses `@paykernel/integration-cloudflare-workers`'s `handleCloudflareWebhook` for `POST /webhooks/stripe` (`request.text()` + `request.headers` + `URL.searchParams`; correlation via `cf-ray`).
- Other routes delegate to `dispatchCheckoutRequest`.
- Tests run in Bun with `store-sqlite` (single-host) via `createBunSqliteStoresInMemory`. Production Workers must inject `D1`/`DO`/`@paykernel/store-d1` via `createCheckoutKernel({ stores | storeFactory | executor })` — e.g. `createCheckoutKernel({ storeFactory: (clock) => createD1Stores({ d1Binding, clock }) })` or `createCheckoutKernel({ executor })` — do not use this example's SQLite in production.
- No static `cloudflare:workers` import.
