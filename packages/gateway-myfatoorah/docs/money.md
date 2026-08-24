# Money

MyFatoorah amounts are **major units with ISO decimal places**, not integer minor units. Internals use `@paykernel/core` `Money` / bigint (`rounding: "reject"`).

Outbound request bodies send `Order.Amount` (create) and `Amount` (MakeRefund) as JSON **number** tokens, ISO-padded on the wire (`10.50` SAR, `1.200` KWD) via `stringifyMyFatoorahJsonBody` — never JSON strings and never `amount * 100`. Unsafe magnitudes throw.

Zero outbound create/refund amounts throw `InvalidRequestError`. Inbound amounts are only published with a currency; unparseable provider amounts are omitted, never guessed. Official inquiry strings may include grouping commas (`12,345.000`) and are stripped before parse.

## Which currency each surface publishes

- **`createPayment` (paid):** **pay** currency when available — `TransactionDetails.Amount.ValueInPayCurrency` + `PayCurrency` (or `ValueInDisplayCurrency`/`DisplayCurrency` if pay missing, but only when its currency matches the request `currency`); `ValueInBaseCurrency` is a fallback only when its `BaseCurrency` matches. If the `ValueIn*` amount's currency does not match the request `currency`, the amount is **omitted** instead of published as the wrong currency (MF-CREATE-AMOUNT-FALLBACK). Success amount is never a mixed pay-value + base-currency pair.
- **`getPayment`:** **pay** when available — prefers `PaidCurrency` + `PaidCurrencyValue` (or `TransationValue` typo) from the last `SUCCESS`/`SUCCSS` transaction; if pay currency/value is missing or unparseable, falls back to `InvoiceValue` + `Currency` (base). Never mixes `InvoiceValue` (base) with `PaidCurrency` (pay) — MF-GETPAYMENT-BASE-MIX.
- **Webhooks (`PAYMENT_STATUS_CHANGED` / `REFUND_STATUS_CHANGED`):** **base** currency — `Data.Amount.ValueInBaseCurrency` + `BaseCurrency` preferred (fallback to display/pay then legacy `Value`); refund webhooks also base (MF-WEBHOOK-MONEY-DRIFT). A SAR checkout can webhook as KWD. Do **not** compare webhook `amount` to the create/getPayment pay amount for fulfillment — use `status === "paid"` / `isPaidOutcome` and `getPayment`. `KD`/`SR` aliases are normalized to `KWD`/`SAR`.
- **`refundPayment` / `MakeRefund`:** **base** currency only (e.g. KWD), never display/pay. Sandbox (`live: false`) base is always `KWD`; live base is `BaseCurrency` from `GetRefundStatus` or, for first refund with empty history, inferred from `country` only when `live: true` (otherwise `KWD`) — MF-SANDBOX-BASE. Mismatch throws.

See also [Charges](./charges.md) and [Webhooks](./webhooks.md) for the pay-vs-base contract and [Refunds](./refunds.md) for the sandbox rule.
