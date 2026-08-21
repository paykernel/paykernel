# Idempotency

Tap natively deduplicates `reference.idempotent` for 24 hours on charges, authorizes, and refunds.

- **createPayment:** caller `idempotencyKey` is sent as `reference.idempotent`. If omitted, the adapter mints an ephemeral UUID for **in-process** `withRetry` only and warns. Crash retries need a stable caller key.
- **capture / void / refund:** missing `idempotencyKey` throws `InvalidRequestError` before POST.
- Auto-retry (`withRetry`) runs only on GET or keyed mutations. Post-submit timeout / 5xx / empty-or-unusable 2xx body → `outcome: "indeterminate"`, never a forged `failed` or `InvalidRequestError`. HTML/proxy 5xx is mapped as mutating `NetworkError.afterProviderSubmit` (same as JSON 5xx), not a clean 503.
