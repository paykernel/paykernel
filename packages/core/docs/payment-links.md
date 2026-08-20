# Payment links

Phase 22.5. Capability `paymentLinks`. A reusable shareable URL — **not** a one-shot Checkout Session (`hostedCheckout`).

Stripe Payment Links is the proving adapter. PayPal Pay Links stay unclaimed.

```ts
if (gateway.supports("paymentLinks")) {
  const created = await client.createPaymentLink({
    amount: money("25.00", "USD"),
    currency: "USD",
    description: "Invoice 42",
    idempotencyKey: crypto.randomUUID(),
  }, "stripe");
  if (created.outcome === "succeeded") {
    share(created.paymentLink.url);
  }
  await client.deactivatePaymentLink({
    paymentLinkId: created.paymentLink.references.providerObjectId,
    idempotencyKey: crypto.randomUUID(),
  }, "stripe");
}
```

Stripe create/deactivate require a caller `idempotencyKey` and `amount`+`currency` on create. Results are outcome unions; post-submit timeouts are indeterminate. Raw card material on create params is rejected before the adapter.
