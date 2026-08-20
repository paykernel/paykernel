# Disputes and chargebacks

Phase 22.3. Capability `disputes`. Stripe is the proving adapter (get / list / submit evidence). PayPal `CUSTOMER.DISPUTE.*` webhooks still dual-write `dispute.*` events but **do not** claim the capability.

## Normalized snapshot

```ts
if (gateway.supports("disputes")) {
  const result = await client.getDispute({ disputeId: "dp_…" }, "stripe");
  if (result.outcome === "succeeded") {
    result.dispute.status;        // DisputeStatus
    result.dispute.evidenceDueBy; // ISO-8601 when present
    result.dispute.dashboardUrl;  // best-effort Stripe Dashboard link
    result.dispute.providerStatus;
  }
}
```

`listDisputes` on Stripe **requires** `paymentId` (`pi_…` or `ch_…`) so the SDK does not list the whole Stripe account.

## Evidence

Small common fields (`uncategorizedText`, `customerName`, `customerEmail`, `productDescription`) plus `stripeEvidence` for remaining Stripe hashes (file ids / strings). Never PAN/CVC. Stripe submit requires `idempotencyKey`. Post-submit timeout is indeterminate.

## Webhooks

`charge.dispute.*` dual-writes `dispute.opened` / `dispute.updated` / `dispute.closed`. Envelope `WebhookEvent.status` is the Stripe dispute lifecycle (or `processing` if missing) — **never** generic payment `pending`. Do not last-write a paid payment to pending. Handle the `PaymentEvent` dispute arm; do not treat these as payment lifecycle.

Dashboard URLs are constructed (`dashboard.stripe.com` vs `/test` from livemode), not returned by Stripe.
