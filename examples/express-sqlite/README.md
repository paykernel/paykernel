# @paykernel/example-express-sqlite

Thin Express checkout example over `@paykernel/example-checkout-kernel` (single-host SQLite).

- Uses `@paykernel/integration-express` for `/webhooks/stripe` (`expressRawJson()` only on that route; other routes use `express.json()`).
- `expressAppToFetch` is a test helper that wraps an Express app for `runCheckoutHttpScenarios` without a network port (per-request server in tests).
- `/internal/reconcile`, `/internal/provider-paid`, `/internal/create-count` are **unauthenticated test hooks — do not deploy**.
- Single-host `store-sqlite` — not a distributed store. Not `@paykernel/integration-express` itself.
