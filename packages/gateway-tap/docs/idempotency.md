# Idempotency

Tap natively deduplicates `reference.idempotent` for 24 hours on **charges, authorizes, and refunds**. **Void is not Tap-idempotent.**

- **createPayment:** caller `idempotencyKey` is sent as `reference.idempotent`. If omitted, the adapter mints an ephemeral UUID for **in-process** `withRetry` only and warns. Crash retries need a stable caller key.
- **capture / refund:** missing `idempotencyKey` throws `InvalidRequestError` before POST. These stay keyed: auto-retry (`withRetry`) is allowed because Tap deduplicates `reference.idempotent`.
- **void:** missing `idempotencyKey` throws `InvalidRequestError` before POST. The adapter may still send `reference.idempotent`, but Tap does **not** deduplicate void. The adapter does **not** retry void after `afterProviderSubmit` (timeout / 5xx / unusable 2xx). Reconcile with `getPayment` instead of a second void POST.
- Auto-retry (`withRetry`) runs only on GET or Tap-keyed mutations (charges / authorize / capture / refund). Post-submit timeout / 5xx / empty-or-unusable 2xx body → `outcome: "indeterminate"`, never a forged `failed` or `InvalidRequestError`. HTML/proxy 5xx is mapped as mutating `NetworkError.afterProviderSubmit` (same as JSON 5xx), not a clean 503. Tap JSON error `1151` ("Gateway timed out") is also `NetworkError`; mutating 1151 is `afterProviderSubmit`.
