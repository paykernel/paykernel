# Production checklist

- Verify `hashstring` with the secret key; never skip verification
- Config `secretKey` is trimmed; whitespace-only keys are invalid. Do not ship padded keys
- `post.url` must be public HTTPS (Tap will not post to localhost)
- Fulfill after inbox **claim** and only when `isPaidOutcome` / `status === "paid"` (`CAPTURED`)
- Do not redirect the payer on `result.redirectUrl` unless `outcome === "requires_action"` **and** the URL is `transaction.url` / a Tap checkout host (`checkout.payments.tap.company`). Merchant `redirect.url` (`callbackUrl`) is not a next action. Leftover `transaction.url` on AUTHORIZED / CAPTURED is not a next action
- Store `chg_` vs `auth_` separately; refunds need the charge id (`chg_…`). Capture result `authorizationId` is the `auth_…` id; `gatewayId` is the `chg_…` id
- Do not capture VOID auths (hold released). A CAPTURED authorize is already paid — `capturePayment` does not POST `/charges`; `getPayment(auth_…)` returns paid
- Refund `ACCEPTED` is in progress (`refund_pending`) — do not fulfill or treat as failure
- Pass a stable `idempotencyKey` on create for crash retries; required on capture / refund / void
- 3DS / KNET / mada / Fawry require `callbackUrl`. Pending statuses (`INITIATED` / `IN PROGRESS` / `IN_PROGRESS`, including Fawry) are `requires_action`; redirect only when `transaction.url` is present
- Customer is required (`tapCustomer` or `customerId`). Inline customers need non-empty `firstName`, `lastName`, and `email` (Tap `1130` / `1132` / `1138`). Tap `1106` ("Customer not found") is `InvalidRequestError`, not a missing payment
- Amount must be `> 0`. Capture / refund `currency` must match the authorize / charge (Tap `1149`)
- No raw cards — tokens and `src_*` only. `createPayment` rejects `auth_…` sources (use `capturePayment`)
- `createPayment` timeout / HTTP 5xx / Tap `1151` after submit: replay `createPayment` with the **same** `idempotencyKey`. Do **not** `getPayment` until you have a `chg_…` or `auth_…` id
- capture / void / refund timeouts: `getPayment(auth_… or chg_…)` (you already have the id). Mutating `1151` / HTTP 50x is `NetworkError.afterProviderSubmit`, not a card decline
- Tap `1114` ("Please check the Authorize status"), `1126` ("Source already used"), and `1149` ("Currency code is not matching") are fail-closed `InvalidRequestError`
- Runtime: Bun / Node ≥ 18 / Deno / Workers
