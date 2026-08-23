# Money

Tap’s JSON amount is **major units with ISO decimal places**, not Stripe-style integer minor units. Internals use `@paykernel/core` `Money` / bigint (`rounding: "reject"`).

Outbound request bodies send `amount` as a JSON **number** (Tap’s schema), ISO-padded on the wire (`10.50` SAR, `1.200` KWD) via `stringifyTapJsonBody`. `JSON.parse` still yields an IEEE number. Unsafe magnitudes throw. Webhook `hashstring` uses the same padded decimal string (`formatTapIsoAmount`). Never `amount * 100`. Never send amount as a JSON string.
