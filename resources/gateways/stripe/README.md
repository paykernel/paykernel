# Stripe Gateway Resources

Minimal reference notes for the Stripe gateway implementation.

## Official References

- PaymentIntents API: https://docs.stripe.com/api/payment_intents
- Checkout Sessions API: https://docs.stripe.com/api/checkout/sessions
- Invoices API: https://docs.stripe.com/api/invoices
- Subscriptions API: https://docs.stripe.com/api/subscriptions
- Refunds API: https://docs.stripe.com/api/refunds
- Refund events: https://docs.stripe.com/refunds#refund-events
- Supported currencies and minor units: https://docs.stripe.com/currencies
- Metadata limits: https://docs.stripe.com/metadata
- Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Webhook signature verification: https://docs.stripe.com/webhooks/signatures
- Webhook security and replay tolerance: https://docs.stripe.com/webhooks
- Rate limits and lock timeouts: https://docs.stripe.com/rate-limits
- API versioning: https://docs.stripe.com/api/versioning

## SDK Assumptions

- SDK callers pass amounts in base currency units; the Stripe gateway converts to Stripe minor units.
- Amount conversion must be decimal-safe because JavaScript floats can represent valid decimal amounts such as `0.29` imprecisely.
- Zero-decimal currencies are not multiplied by 100. ISK and UGX are represented with Stripe's backwards-compatible two-decimal API format and must be whole currency units.
- Three-decimal currencies (BHD, JOD, KWD, OMR, TND) must produce minor-unit amounts divisible by 10; non-compliant amounts are rejected rather than rounded.
- Partial capture and partial refund calls require `currency` when `amount` is provided.
- `priceData.amount` uses base currency units and enforces charge maximums like `unitAmount`; `priceData.unitAmount` is a Stripe minor-unit escape hatch that still applies three-decimal divisible-by-10 and charge-max checks without re-scaling. Checkout line-item prices may be zero where Stripe accepts zero-priced items.
- Checkout Sessions use either `lineItems` or the simple `amount`/`currency` form, not both; setup mode does not accept `lineItems` or `amount`.
- `cancelUrl` maps to Stripe's optional `cancel_url` parameter and should not be required by SDK validation.
- Checkout Session inputs reject unsupported passthrough fields instead of silently dropping them.
- Checkout Session line item counts are validated against Stripe's published payment/subscription mode limits where the SDK has enough information.
- Inline Checkout subscription `priceData` must include recurring settings.
- Stripe metadata is restricted to scalar string/number/boolean values and is sent as string metadata within Stripe's key count, key length, value length, and key character limits.
- Checkout Session metadata is also propagated into `payment_intent_data`, `setup_intent_data`, or `subscription_data` metadata where Stripe supports it.
- Webhook verification requires the raw request body and a configured endpoint signing secret. Buffer payloads must be signed using their original bytes, not a UTF-8 decoded string.
- Server-side PaymentIntent confirmation with a payment method and no callback URL disables redirect payment methods via `automatic_payment_methods.allow_redirects=never`.
- Webhook parsing expects snapshot event payloads with `data.object`; thin events must be hydrated by the caller before normalization.
- Webhook endpoint API versions should be kept aligned with the gateway `apiVersion` because endpoint event shapes can differ from REST request versions. Optional `webhookApiVersion` enforces a match only when explicitly set; it does not default to `apiVersion`.
- Webhook `gatewayPaymentId` is normalized to the most useful related Stripe object ID when Stripe provides one. Payment-mode Checkout prefers PaymentIntent, then SetupIntent, then Subscription, then the emitting object. Subscription-mode Checkout prefers Subscription even when PaymentIntent is also present. Invoice **money** events (`invoice.paid` / `invoice.payment_succeeded` / `invoice.payment_failed`) prefer PaymentIntent for `gatewayPaymentId` when present and set `gatewaySubscriptionId` to the related `sub_...` (dual IDs). Subscription resolution: Basil+ `parent.subscription_details.subscription`, then top-level `subscription`. PI resolution: `payments.data` default payment_intent, then legacy `payment_intent`. Non-money invoice events still prefer subscription over PI. `gatewayObjectId` keeps the original event object ID (`in_...`, etc.).
- Unmapped webhook event types with non-`payment_intent` objects default status to `pending` (do not run foreign statuses such as `active` through the PI fail-closed map).
- `getPayment` expands `latest_charge`. For succeeded PaymentIntents, refund completeness uses the captured base (`amount_received` if finite, else `latest_charge.amount_captured` if finite, else PI `amount`): `amount_refunded >= capturedBase` → `refunded`, else `partially_refunded` (refunds override partial capture). `amount_received < amount` sets `partially_captured`. Amount prefers `amount_received` (captured/settled) when present. `capturePayment` uses the same partial-capture rule.
- Hard invariant: `capturePayment` / `refundPayment` / `voidPayment` require `pi_...` PaymentIntent IDs — not `cs_...` or `sub_...`. Use `getCheckoutSession({ sessionId })` for `paymentIntentId`, or invoice money-event dual IDs.
- Checkout rejects providing both `customerId` and `customerEmail`.
- Mutations auto-generate an `Idempotency-Key` (UUID) when the caller omits one or passes empty/whitespace so Stripe retries are safe; supply a stable key for cross-process retry.
- Refund API results use a follow-up refund list request for cumulative succeeded-refund `totalRefunded`; if that request fails after refund creation, `totalRefunded` is omitted.
- Refund webhooks normalize `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, and legacy `charge.refund.updated`. Completeness prefers `charge.refunded === true` as full, else compares `amount_refunded` to `amount_captured` when present else `amount`. `charge.refunded` webhook `amount` is the payment/captured total (not cumulative refunded). Refund object events only distinguish full from partial refunds when Stripe includes enough charge totals; successful refund object events without those totals use `refund_completed`.
- `payment_intent.succeeded` webhooks with finite `amount_received < amount` normalize as `partially_captured` with amount from `amount_received`. Currency is omitted when Stripe omits it (no `usd` default on the event).
- Webhook signature verification rejects only aged timestamps (`now - t > 300`). Far-future `t` values are accepted (intentional one-sided tolerance; diverges from stripe-node bidirectional `Math.abs` tolerance).
- Prefer `client.handleWebhook` over bare `verifyWebhook` + `parseWebhookEvent`; `parseWebhookEvent` alone does not verify.
- Subscription status mapping: `active` → `paid`; `trialing`/`past_due`/`incomplete`/`paused`/`unpaid` → `pending`; only `canceled`/`incomplete_expired` → `cancelled`. Checkout `payment_status: paid` for a $0 trial may still be `paid` via the session path.
- `checkout.session.completed` → `setup_completed` only when `payment_status: no_payment_required` **and** (`mode === 'setup'` or `setup_intent` present); payment-mode free/zero / 100% coupon sessions with `no_payment_required` + `complete` normalize as **`paid`** (fulfillment-ready dual-write `payment.succeeded`) — not `pending` and not `setup_completed`. When Stripe includes `setup_intent`, that id is used as `gatewayPaymentId`.
- Subscription-mode `checkout.session.completed` webhooks prefer the related `sub_...` ID over `payment_intent` when both are present. Invoice payment success/failure events and subscription lifecycle events are normalized for common recurring-billing flows.
- Stripe `authentication_required` (SCA) maps to `CardDeclinedError`; `AuthenticationError` is reserved for bad secret key / HTTP 401.
- `getCheckoutSession({ sessionId })` retrieves a Checkout Session (expands payment_intent) and returns `paymentIntentId` for money mutations.
- REST requests send a pinned `Stripe-Version` header by default unless callers override `apiVersion`.
- REST requests enforce Stripe idempotency key length and use a configurable timeout.
- Charge creation validates currency precision and Stripe's published maximums. Default non-card cap is 8 digits (`99999999`); COP is 10 digits (`9999999999`); IDR/INR have non-card exceptions; JPY/HUF (and other elevated entries) are capped at the 12-digit card max `999999999999`. Minimum charge amounts can depend on settlement currency, so Stripe remains the source of truth for minimum enforcement. Partial capture/refund amount validation still only applies currency minor-unit formatting because Stripe validates them against the original charge.
- PaymentIntent `next_action` redirect URLs are surfaced on the normalized `redirectUrl` field when Stripe returns a known redirect action.
