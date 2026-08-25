# @paykernel/integration-cloudflare-workers overview

- Depends only on `@paykernel/integration-http`.
- Portable, optional peer `@cloudflare/workers-types`.
- No `cloudflare:workers` static import; uses structural `Request`/`Response`.
- `readWorkerBindings` is alias of `requireStringBindings` for typed env.
