# Customers and stored payment methods

Phase 22.1 first-class vault surface. Capability-gated: `customers` and `paymentMethods`. This SDK **never** accepts or stores raw PAN/CVC.

## Query support

```ts
const gateway = client.gateway("stripe");
if (gateway.supports("customers") && gateway.supports("paymentMethods")) {
  const created = await client.createCustomer({
    email: "buyer@example.com",
    name: "Buyer",
    idempotencyKey: crypto.randomUUID(),
  });
}
```

Stripe is the only built-in that claims both keys today. Moyasar, PayPal, and Paymob stay `false` until they expose the same surface.

## Operations

| Method | Capability | Notes |
| --- | --- | --- |
| `createCustomer` / `getCustomer` | `customers` | Outcome union; Stripe requires `idempotencyKey` on create |
| `attachPaymentMethod` / `listPaymentMethods` / `detachPaymentMethod` | `paymentMethods` | Tokenized ids (`pm_…`) or provider tokens — never a PAN |
| `createPayment({ offSession: true, paymentMethodId, customerId })` | `payments` + `paymentMethods` | Off-session charge of a stored method; fail-closed if `paymentMethods` is unclaimed |

Results are Phase 6 `outcome` unions (`succeeded` / `failed` / `indeterminate`). Post-submit timeouts on create/attach/detach are **indeterminate** (`reconciliationRequired: true`) — do not retry as a fresh failure.

## Off-session

`offSession: true` requires a stored payment-method id (`paymentMethodId` or Stripe `stripePaymentMethodId`) **and** a customer id (`customerId` or Stripe `stripeCustomerId`). The client rejects the call before the adapter if either is missing. Off-session is **fail-closed** unless the gateway claims `paymentMethods`. Raw card material is rejected with `InvalidRequestError`.

## PCI

`PaymentClient` runs `assertNoRawCardMaterial` on create customer, attach, off-session create, payment links, and dispute evidence. The fence walks nested `metadata`, `evidence` (including `stripeEvidence`), and CVC fields — not only top-level PAN keys (`number` / `pan` / `cardNumber`).

It **allows** numeric order ids and timestamps (unix seconds / ms) and Moyasar AFT `sender.account.number` bank-account digits that are not a Luhn PAN. It **rejects** Luhn-valid PAN (including spaced/dashed PAN and PAN embedded in surrounding text) and CVC aliases (`cvc`, `cvv`, `cvv2`, `cid`, `securityCode`, …). It does **not** claim every 13-digit leaf is blocked (non-Luhn numeric ids can pass). Top-level / card `number` keys are still treated as PAN-shaped without Luhn.

Raw PAN/CVC in those bags is `InvalidRequestError`. Use a client-side tokenization SDK (Stripe.js, etc.) and pass the resulting id. Stripe `attachPaymentMethod({ token: "tok_…" })` is the `paymentMethods` capability, not `tokenization` (Stripe keeps `tokenization: false`; there is no SetupIntent CRUD on this adapter).
