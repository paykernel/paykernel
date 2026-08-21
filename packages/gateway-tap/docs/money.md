# Money

Tap’s JSON amount is **major units with ISO decimal places**, not Stripe-style integer minor units. Internals use `@paykernel/core` `Money` / bigint (`rounding: "reject"`).

Outbound JSON numbers go through `moneyToMajorNumber` (IEEE round-trip; unsafe magnitudes throw). Webhook `hashstring` uses the padded decimal string (`formatTapIsoAmount`). Never `amount * 100`.
