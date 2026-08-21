# Production checklist

- Verify `hashstring` with the secret key; never skip verification
- `post.url` must be public HTTPS (Tap will not post to localhost)
- Fulfill after inbox **claim** and only when `isPaidOutcome` / `status === "paid"` (`CAPTURED`)
- Store `chg_` vs `auth_` separately; refunds need the charge id
- Pass a stable `idempotencyKey` on create for crash retries; required on capture / refund / void
- 3DS / KNET / mada require `callbackUrl`
- Customer is required (`tapCustomer` or `customerId`)
- No raw cards — tokens and `src_*` only
- Indeterminate timeouts need `getPayment` / webhook, not a second charge
- Runtime: Bun / Node ≥ 18 / Deno / Workers
