# Higher-level payment capabilities stay in core

Phase 22 adds customers, hosted checkout, disputes, marketplace vocabulary, and payment links as **capability-gated gateway operations** on `@paykernel/core`, not as a new workspace package.

Routing, reconciliation, and observability are separate packages because they wrap or sit beside `PaymentClient`. Customers, checkout sessions, disputes, splits, and payment links are provider APIs the adapter already talks to. A `@paykernel/marketplace` package would either duplicate those methods or invert the plugin seam.

Stripe is the proving adapter for hosted checkout, disputes, and payment links. Moyasar remains the proving adapter for create-time marketplace splits. Other built-ins stay fail-closed (`false`) until they expose the same first-class surface. Checkout `mode: "subscription"` stays Stripe-only and does not claim `providerRecurring`. Transfers, payouts, and Connect onboarding are vocabulary only until an adapter implements them.

Checkout create/get results use a Phase 6 `outcome` union (breaking Stripe’s 0.x `{ success, sessionId, url }` shape) so hosted checkout cannot be mistaken for paid settlement.
