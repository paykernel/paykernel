# Hosted checkout

Phase 22.2 typed Checkout Session product. Capability `hostedCheckout`. **Not** every provider redirect URL (PayPal approve links, Paymob iframes, Moyasar `transaction_url` stay on createPayment).

## Breaking 0.x change (Stripe)

`StripeGateway.createCheckoutSession` / `getCheckoutSession` no longer return `{ success, sessionId, url }`. They return a Phase 6 outcome union:

```ts
const result = await client.createCheckoutSession({
  amount: money("10.00", "USD"),
  currency: "USD",
  successUrl: "https://merchant.example/success",
  cancelUrl: "https://merchant.example/cancel",
  idempotencyKey: crypto.randomUUID(),
}, "stripe");

if (result.outcome === "succeeded") {
  // Redirect the customer. This is NOT paid settlement.
  if (result.session.url) {
    redirect(result.session.url);
  }
  const sessionId = result.session.references.providerObjectId;
}
```

`isHostedCheckoutRedirect(result)` is true when `outcome === "succeeded"` and `session.url` is a non-empty string. **Never fulfill on checkout create.** Fulfill from webhooks / `getPayment` when `isPaidOutcome` / `status === "paid"`.

## Stripe-only extras

`CreateCheckoutSessionParams` remains the Stripe-extended input (`mode`, `lineItems`, `paymentMethodTypes`, `customerEmail`). `mode: "subscription"` does **not** set `providerRecurring`. Subscription billing stays out of core.

Stripe create requires a caller `idempotencyKey`. Empty/missing session id on HTTP 200 is **indeterminate**. The lookup id lives on `session.references.providerObjectId` (caller idempotency key, or `"unknown"`). `getCheckoutSession` HTTP 404 is `outcome: "failed"` (same contract as `getCustomer`). GET transport failures still throw `NetworkError`.

Related PaymentIntent id (when Stripe expands it) is `session.references.relatedIds.paymentIntentId`.
