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
- Partial capture and partial refund calls require `currency` when `amount` is provided; caller currency must match the PaymentIntent currency.
- `priceData.amount` uses base currency units; `priceData.unitAmount` is a Stripe minor-unit escape hatch. **Both paths** enforce three-decimal divisible-by-10, ISK/UGX whole-major-unit (minor divisible by 100), and charge-max checks — unitAmount does not skip money rules. Checkout line-item prices may be zero where Stripe accepts zero-priced items.
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
- `getPayment` expands `latest_charge`. For succeeded PaymentIntents, refund completeness uses the **captured base only** (`amount_received` if finite, else `latest_charge.amount_captured` if finite) — **no fallback to authorized PI `amount`** (that would claim full `refunded` after partial capture). Known captured base and `amount_refunded >= capturedBase` → `refunded`; otherwise refund money with incomplete base → `partially_refunded`. Missing settled capture fields → `processing` (fail closed, not full `paid`). Finite settled `< amount` → `partially_captured`. Amount prefers settled money when present. `capturePayment` uses the same partial-capture / incomplete-settled rules.
- Hard invariant: `capturePayment` / `refundPayment` / `voidPayment` require `pi_...` PaymentIntent IDs — not `cs_...` or `sub_...`. Use `getCheckoutSession({ sessionId })` → `session.references.relatedIds.paymentIntentId`, or invoice money-event dual IDs.
- Checkout rejects providing both `customerId` and `customerEmail`.
- Mutations auto-generate an `Idempotency-Key` (UUID) when the caller omits `idempotencyKey`; empty/whitespace keys are rejected at validation. Supply a stable key for cross-process retry.
- Refund API results use a follow-up refund list request for cumulative succeeded-refund `totalRefunded`; if that request fails after refund creation, fall back to expanded `charge.amount_refunded` when present, else omit `totalRefunded`.
- Refund webhooks normalize `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, and legacy `charge.refund.updated`. Completeness prefers `charge.refunded === true` as full, else compares `amount_refunded` to `amount_captured` when present else `amount`. When `refunded !== true` and refund money is incomplete (missing/non-finite/zero `amount_refunded`), domain status is **`refund_completed`** (not fail-open `refunded`). Incomplete `refund_completed` dual-writes Phase-7 **`refund.pending`** (not `refund.completed`). Proven `refunded` / `partially_refunded` dual-write `refund.completed`. `charge.refunded` webhook `amount` is cumulative **`amount_refunded`** (money moved by refunds), omitted when incomplete — not the charge/captured payment total.
- `payment_intent.succeeded` with finite `amount_received < amount` → `partially_captured` (amount from settled). Missing settled fields → **`processing`** (fail closed, not `paid`). Both partial and incomplete-settled dual-write **`payment.processing`** (not `payment.succeeded`). Full success (`status: paid`) dual-writes `payment.succeeded`. Currency is omitted when Stripe omits it (no `usd` default). Prefer `isPaidOutcome` / status `paid` for fulfillment — not type-only `payment.succeeded`.
- Webhook signature verification uses **bidirectional** 300s tolerance (`Math.abs(now - t) > 300` rejects) — stripe-node parity for aged and far-future timestamps.
- Prefer `client.handleWebhook` over bare `verifyWebhook` + `parseWebhookEvent`; `parseWebhookEvent` alone does not verify.
- Subscription status mapping: **`active` → `processing` (not `paid`)** — lifecycle only; fulfill from invoice/PI money events. `trialing`/`past_due`/`incomplete`/`paused`/`unpaid` → `pending`; only `canceled`/`incomplete_expired` → `cancelled`. Checkout `payment_status: paid` for a $0 trial may still be `paid` via the session path.
- `checkout.session.completed` with `payment_status: no_payment_required` + `complete`: `mode === 'setup'` or `setup_intent` present → `setup_completed`; **subscription mode → `pending`** (not fulfillment-ready paid); **payment mode** free/zero / 100% coupon → **`paid`** (dual-write `payment.succeeded`); missing/unrecognized mode without setup_intent → `pending` (fail closed). When Stripe includes `setup_intent`, that id is used as `gatewayPaymentId`.
- Subscription-mode `checkout.session.completed` webhooks prefer the related `sub_...` ID over `payment_intent` when both are present. Invoice payment success/failure events and subscription lifecycle events are normalized for common recurring-billing flows. Never pass `sub_...` / `cs_...` into refund/capture/void.
- Stripe `authentication_required` (SCA) maps to `CardDeclinedError`; `AuthenticationError` is reserved for bad secret key / HTTP 401.
- `getCheckoutSession({ sessionId })` retrieves a Checkout Session (expands payment_intent). Related PaymentIntent id is `session.references.relatedIds.paymentIntentId` when present.
- REST requests send a pinned `Stripe-Version` header by default unless callers override `apiVersion`.
- REST requests enforce Stripe idempotency key length and use a configurable timeout.
- Charge creation validates currency precision and Stripe's published maximums. Default non-card cap is 8 digits (`99999999`); COP is 10 digits (`9999999999`); IDR/INR have non-card exceptions; JPY/HUF (and other elevated entries) are capped at the 12-digit card max `999999999999`. Minimum charge amounts can depend on settlement currency, so Stripe remains the source of truth for minimum enforcement. Partial capture/refund amount validation still only applies currency minor-unit formatting because Stripe validates them against the original charge.
- PaymentIntent `next_action` redirect URLs are surfaced on the normalized `redirectUrl` field when Stripe returns a known redirect action.
- Canonical money-critical docs: prefer `packages/core/docs/stripe.md` over this resource README when they diverge.
