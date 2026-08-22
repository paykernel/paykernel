# Production checklist

- Verify `hashstring` with the secret key; never skip verification
- `post.url` must be public HTTPS (Tap will not post to localhost)
- Fulfill after inbox **claim** and only when `isPaidOutcome` / `status === "paid"` (`CAPTURED`)
- Do not redirect the payer on `result.redirectUrl` unless `outcome === "requires_action"` **and** the URL is `transaction.url` / a Tap checkout host (`checkout.payments.tap.company`). Merchant `redirect.url` (`callbackUrl`) is not a next action
- Store `chg_` vs `auth_` separately; refunds need the charge id
- Pass a stable `idempotencyKey` on create for crash retries; required on capture / refund / void
- 3DS / KNET / mada / Fawry require `callbackUrl`; Fawry `IN PROGRESS` still needs `transaction.url`
- Customer is required (`tapCustomer` or `customerId`)
- No raw cards — tokens and `src_*` only
- Transport timeouts / 5xx / Tap `1151` ("Gateway timed out") after submit need `getPayment` / webhook, not a second charge (mutating `1151` is `afterProviderSubmit`)
- Runtime: Bun / Node ≥ 18 / Deno / Workers
