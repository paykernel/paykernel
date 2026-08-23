# Runtime

`paymentsSdk.portable: true`. Production sources use injected `fetch` and core portable crypto (`hmacSha256`, `bytesToBase64`, `timingSafeEqualBytes`). No `node:` / `bun:` / `cloudflare:` imports.

Supported: Node ≥ 18, Bun ≥ 1.0, Deno, Cloudflare Workers (Web APIs). Pass `runtime` on `createPaymentClient` to override `fetch` / clock / UUID.
