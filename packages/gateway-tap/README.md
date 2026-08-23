# `@paykernel/gateway-tap`

Portable **Tap Payments** adapter for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): charges, authorize / capture / void, refunds, and `hashstring` webhooks.

> **Portable.** No Node-only imports. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web `fetch` + core HMAC). Depends only on `@paykernel/core` at runtime.

This is a first-party **extra** package (Phase 23). It is **not** a `BuiltInGatewayName`. Stripe / Moyasar / PayPal / Paymob stay in core.

## Install

```bash
bun add @paykernel/gateway-tap @paykernel/core
```

## Quickstart

```ts
import { createPaymentClient, money } from "@paykernel/core";
import { tapGateway } from "@paykernel/gateway-tap";

const payments = createPaymentClient({
  gateways: {
    tap: tapGateway({
      secretKey: process.env.TAP_SECRET_KEY!,
      webhookUrl: "https://merchant.example/webhooks/tap",
      // autoVoidHours: 24, // optional; authorize create + tok_ only; not defaulted; not src_card
    }),
  },
  defaultGateway: "tap",
});

const tap = payments.gateway("tap");

const result = await tap.createPayment({
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://merchant.example/return",
  idempotencyKey: crypto.randomUUID(), // required
  tapCustomer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  // tapSource omitted → src_all (hosted methods page). Not hostedCheckout.
  // capture: false omitted tapSource → src_card.
});

if (result.outcome === "requires_action" && result.redirectUrl) {
  // transaction.url (3DS / KNET / mada / Fawry) — do not fulfill
}
if (result.outcome === "succeeded" && result.status === "paid") {
  // still verify via webhook + inbox claim before fulfillment
}
```

`TapGateway.createPayment` accepts Tap-only `tap*` fields (`tapCustomer`, `tapSource`, `tapPostUrl`, `tapThreeDSecure`, `tapMerchantId`) as `TapCreatePaymentParams`. With `defaultGateway: "tap"`, or a TAP-only `gateways` map without `defaultGateway`, `payments.createPayment({ tapCustomer, … })` is typed the same way (core does not add `tap*` to `CreatePaymentParams`). Two or more gateways still need `defaultGateway` or a named `gateway` argument. `createPayment` **requires** `idempotencyKey` (no minted UUID). Request JSON `amount` is an ISO-padded number (`10.50`), not a string. Inline `tapCustomer` requires non-empty `firstName`, `lastName`, and `email`. Omitted `tapSource` is `src_all` for charges and `src_card` for `capture: false`. Config `webhookUrl` / `tapPostUrl` must be HTTPS. Optional config `autoVoidHours` is sent only on authorize create with a token source (`tok_…`); not defaulted; omitted / `src_card` throws. Create and capture POST send `save_card: false`. `capturePayment` result keeps `authorizationId` as the `auth_…` id; `gatewayId` is the charge `chg_…` id. Capture `amount` less than the authorize is `partially_captured`, not `paid` (`isPaidOutcome` is false). `getPayment(auth_…)` on CAPTURED uses nested `charge_id` when present (`gatewayId` is `chg_…`); without it, omit `amount`. Charge VOID is a failed payment (not succeeded). Authorize VOID is `succeeded` + cancelled. `voidPayment` GETs first; already VOID does not POST. Remaining `0` or charge `REFUNDED` does not re-POST `charge.amount`.

## Capabilities

Claimed: `payments`, `immediateCapture`, `authorization`, `partialCapture`, `refunds`, `partialRefunds`, `voids`.

Unclaimed (fail-closed): `hostedCheckout`, `tokenization`, `customers`, `paymentMethods`, `marketplaceSplits`, `disputes`, `paymentLinks`, `providerRecurring`.

`src_all` is a **redirect source**, not a Checkout Session product.

## Docs

- [Overview](./docs/overview.md)
- [Charges](./docs/charges.md)
- [Authorize / capture / void](./docs/authorize.md)
- [Refunds](./docs/refunds.md)
- [Webhooks](./docs/webhooks.md)
- [Money](./docs/money.md)
- [Idempotency](./docs/idempotency.md)
- [Status mapping](./docs/status-mapping.md)
- [Runtime](./docs/runtime.md)
- [Production checklist](./docs/production-checklist.md)

## License

MIT
