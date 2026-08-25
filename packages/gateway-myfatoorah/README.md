# `@paykernel/gateway-myfatoorah`

Portable **MyFatoorah** adapter for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): V3 hosted payments (sale), refunds, and Webhook V2 signatures.

> **Portable.** No Node-only imports. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web `fetch` + core HMAC). Depends only on `@paykernel/core` at runtime.

This is a first-party **extra** package (Phase 23). It is **not** a `BuiltInGatewayName`. Stripe / Moyasar / PayPal / Paymob stay in core.

## Install

```bash
bun add @paykernel/gateway-myfatoorah @paykernel/core
```

## Quickstart

```ts
import { createPaymentClient, money } from "@paykernel/core";
import { myfatoorahGateway } from "@paykernel/gateway-myfatoorah";

const payments = createPaymentClient({
  gateways: {
    myfatoorah: myfatoorahGateway({
      apiToken: process.env.MYFATOORAH_API_TOKEN!, // sandbox: portal API token
      country: "KWT",
      // live: true, // use the live host for the country
      webhookSecret: process.env.MYFATOORAH_WEBHOOK_SECRET, // portal secure key, NOT the API token
      webhookUrl: "https://merchant.example/webhooks/myfatoorah",
      // defaultPaymentMethod: "KNET", // optional; omitted → all enabled methods
    }),
  },
  defaultGateway: "myfatoorah",
});

const result = await payments.createPayment({
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/return",
  idempotencyKey: crypto.randomUUID(), // required
  orderId: "ord_01", // required outside KWT/SAU (CustomerReference replay)
  // myfatoorahCustomer: { name: "Ada", email: "ada@example.com" }, // optional
});

if (result.outcome === "requires_action" && result.redirectUrl) {
  // PaymentURL hosted page — redirect the customer, do not fulfill
}
if (result.outcome === "succeeded" && result.status === "paid") {
  // still verify via webhook + inbox claim before fulfillment
}
```

`MyFatoorahGateway.createPayment` accepts MyFatoorah-only `myfatoorah*` fields (`myfatoorahCustomer`, `myfatoorahPaymentMethod`, `myfatoorahDisplayPaymentMethods`, `myfatoorahLanguage`, `myfatoorahWebhookUrl`, `myfatoorahSessionId`, `myfatoorahToken`) as `MyFatoorahCreatePaymentParams`. With `defaultGateway: "myfatoorah"`, or a MYFATOORAH-only `gateways` map without `defaultGateway`, `payments.createPayment({ myfatoorahCustomer, … })` is typed the same way (core does not add `myfatoorah*` to `CreatePaymentParams`). Two or more gateways still need `defaultGateway` or a named `gateway` argument. `createPayment` **requires** `idempotencyKey` (no minted UUID). Request JSON amounts are ISO-padded number tokens (`10.50` SAR, `1.200` KWD), never strings. `gatewayId` is the InvoiceId; `getPayment` uses `POST /v2/GetPaymentStatus` (`InvoiceId`/`PaymentId` via `myfatoorahKeyType`); `PaymentURL` → `requires_action` + `redirectUrl`. Outside KWT/SAU `orderId` or `myfatoorahCustomer.reference` is required (CustomerReference replay).

## Capabilities

Claimed: `payments`, `immediateCapture`, `refunds`, `partialRefunds`, `tokenization` (via `myfatoorahToken` / `myfatoorahSessionId` → `SourceOfFund.Token` / `SessionId`; direct `SourceOfFund.Card` PAN is still rejected).

Unclaimed (fail-closed): `authorization`, `partialCapture`, `voids`, `hostedCheckout`, `customers`, `paymentMethods`, `marketplaceSplits`, `disputes`, `paymentLinks`, `providerRecurring`.

`PaymentURL` is a **redirect**, not a Checkout Session product. `gateway.ts` length/duplication is intentional for this gate — split deferred and documented.

## Docs

- [Overview](./docs/overview.md)
- [Charges](./docs/charges.md)
- [Refunds](./docs/refunds.md)
- [Webhooks](./docs/webhooks.md)
- [Money](./docs/money.md)
- [Idempotency](./docs/idempotency.md)
- [Status mapping](./docs/status-mapping.md)
- [Runtime](./docs/runtime.md)
- [Production checklist](./docs/production-checklist.md)

## License

MIT
