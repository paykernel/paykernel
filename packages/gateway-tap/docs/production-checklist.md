# Production checklist

- Verify `hashstring` with the secret key; never skip verification
- `post.url` must be public HTTPS (Tap will not post to localhost)
- Fulfill after inbox **claim** and only when `isPaidOutcome` / `status === "paid"` (`CAPTURED`)
- Do not redirect the payer on `result.redirectUrl` unless `outcome === "requires_action"` **and** the URL is `transaction.url` / a Tap checkout host (`checkout.payments.tap.company`). Merchant `redirect.url` (`callbackUrl`) is not a next action. Leftover `transaction.url` on AUTHORIZED / CAPTURED is not a next action
- Store `chg_` vs `auth_` separately; refunds need the charge id
- Do not capture VOID auths (hold released). Reconcile a CAPTURED authorize via `getPayment` or replay `capturePayment` with the same `idempotencyKey`
- Refund `ACCEPTED` is in progress (`refund_pending`) — do not fulfill or treat as failure
- Pass a stable `idempotencyKey` on create for crash retries; required on capture / refund / void
- 3DS / KNET / mada / Fawry require `callbackUrl`; Fawry `IN PROGRESS` / `IN_PROGRESS` still needs `transaction.url`
- Customer is required (`tapCustomer` or `customerId`). Inline customers need `lastName` (Tap `1132`). Tap `1106` ("Customer not found") is `InvalidRequestError`, not a missing payment
- Amount must be `> 0`
- No raw cards — tokens and `src_*` only. `createPayment` rejects `auth_…` sources (use `capturePayment`)
- Transport timeouts / HTTP 5xx / Tap `1151` ("Gateway timed out") after submit need `getPayment` / webhook, not a second charge (mutating `1151` / HTTP 50x is `NetworkError.afterProviderSubmit`, not a card decline)
- Tap `1114` ("Please check the Authorize status") is fail-closed `InvalidRequestError`
- Runtime: Bun / Node ≥ 18 / Deno / Workers
