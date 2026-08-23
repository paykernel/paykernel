# Money

MyFatoorah amounts are **major units with ISO decimal places**, not integer minor units. Internals use `@paykernel/core` `Money` / bigint (`rounding: "reject"`).

Outbound request bodies send `Order.Amount` (create) and `Amount` (MakeRefund) as JSON **number** tokens, ISO-padded on the wire (`10.50` SAR, `1.200` KWD) via `stringifyMyFatoorahJsonBody` — never JSON strings and never `amount * 100`. Unsafe magnitudes throw.

Zero outbound create/refund amounts throw `InvalidRequestError`. Inbound amounts are only published with a currency; unparseable provider amounts are omitted, never guessed.
