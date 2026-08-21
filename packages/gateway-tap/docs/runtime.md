# Runtime

`paymentsSdk.portable: true`. Production sources use injected `fetch` and core portable HMAC (`hmacSha256Hex`). No `node:crypto` / `node:buffer`.

Supported: Node ≥ 18, Bun ≥ 1.0, Deno, Cloudflare Workers (Web APIs). Pass `runtime` on `createPaymentClient` to override `fetch` / clock / UUID.
