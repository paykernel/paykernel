/**
 * Sanitized Stripe snapshot fixtures + HMAC signing for checkout examples.
 *
 * Paid fixtures must include `amount_received` and must omit string
 * `latest_charge` (an unexpanded charge id demotes domain status to
 * `processing`). Checkout Session `cs_test_` / `cs_live_` ids fail
 * {@link assertFixtureSafe}.
 */

import { hmacSha256Hex } from "@paykernel/core";
import { assertFixtureSafe } from "@paykernel/testkit";

export const CHECKOUT_STRIPE_WEBHOOK_SECRET = "whsec_test_example_checkout";

export type StripeCheckoutFixtureOverrides = {
  orderId?: string;
  eventId?: string;
  paymentIntentId?: string;
};

export type SignedStripeWebhook = {
  event: Record<string, unknown>;
  rawBody: string;
  signature: string;
  timestamp: number;
};

function stripePaymentIntentEvent(input: {
  type: "payment_intent.succeeded" | "payment_intent.created";
  eventId: string;
  paymentIntentId: string;
  orderId: string;
  intentStatus: string;
  amount: number;
  amountReceived?: number;
}): Record<string, unknown> {
  const intent: Record<string, unknown> = {
    id: input.paymentIntentId,
    object: "payment_intent",
    status: input.intentStatus,
    amount: input.amount,
    currency: "usd",
    metadata: {
      paymentId: input.orderId,
      orderId: input.orderId,
    },
  };
  if (input.amountReceived !== undefined) {
    intent.amount_received = input.amountReceived;
  }

  const event: Record<string, unknown> = {
    id: input.eventId,
    object: "event",
    type: input.type,
    api_version: "2024-06-20",
    created: 1_700_000_000,
    livemode: false,
    data: {
      object: intent,
    },
  };
  assertFixtureSafe(event, input.type);
  return event;
}

/** `payment_intent.succeeded` with settled `amount_received` (maps to paid). */
export function stripePaidPaymentIntentFixture(
  overrides: StripeCheckoutFixtureOverrides = {},
): Record<string, unknown> {
  const orderId = overrides.orderId ?? "order_example_checkout";
  const eventId = overrides.eventId ?? "evt_example_checkout_paid";
  const paymentIntentId = overrides.paymentIntentId ?? "pi_example_checkout_paid";
  return stripePaymentIntentEvent({
    type: "payment_intent.succeeded",
    eventId,
    paymentIntentId,
    orderId,
    intentStatus: "succeeded",
    amount: 1000,
    amountReceived: 1000,
  });
}

/** Non-paid `payment_intent.created` (maps to pending / payment.created). */
export function stripeCreatedPaymentIntentFixture(
  overrides: StripeCheckoutFixtureOverrides = {},
): Record<string, unknown> {
  const orderId = overrides.orderId ?? "order_example_checkout";
  const eventId = overrides.eventId ?? "evt_example_checkout_created";
  const paymentIntentId =
    overrides.paymentIntentId ?? "pi_example_checkout_created";
  return stripePaymentIntentEvent({
    type: "payment_intent.created",
    eventId,
    paymentIntentId,
    orderId,
    intentStatus: "requires_payment_method",
    amount: 1000,
  });
}

export type SignStripeWebhookOptions = {
  secret?: string;
  nowMs?: number;
};

/**
 * Stripe-compatible `Stripe-Signature` header: `t=<unix>,v1=<hmac-hex>`.
 * HMAC is `hmacSha256Hex(secret, timestamp + "." + rawBody)`.
 */
export function signStripeWebhook(
  event: unknown,
  options: SignStripeWebhookOptions = {},
): SignedStripeWebhook {
  const secret = options.secret ?? CHECKOUT_STRIPE_WEBHOOK_SECRET;
  const timestamp = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const rawBody = JSON.stringify(event);
  const v1 = hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return {
    event: event as Record<string, unknown>,
    rawBody,
    signature: `t=${timestamp},v1=${v1}`,
    timestamp,
  };
}

function pickFixtureOverrides(
  overrides: StripeCheckoutFixtureOverrides & SignStripeWebhookOptions = {},
): StripeCheckoutFixtureOverrides {
  const out: StripeCheckoutFixtureOverrides = {};
  if (overrides.orderId !== undefined) out.orderId = overrides.orderId;
  if (overrides.eventId !== undefined) out.eventId = overrides.eventId;
  if (overrides.paymentIntentId !== undefined) {
    out.paymentIntentId = overrides.paymentIntentId;
  }
  return out;
}

function pickSignOptions(
  overrides: StripeCheckoutFixtureOverrides & SignStripeWebhookOptions = {},
): SignStripeWebhookOptions {
  const out: SignStripeWebhookOptions = {};
  if (overrides.secret !== undefined) out.secret = overrides.secret;
  if (overrides.nowMs !== undefined) out.nowMs = overrides.nowMs;
  return out;
}

export function signedStripePaidWebhook(
  overrides: StripeCheckoutFixtureOverrides & SignStripeWebhookOptions = {},
): SignedStripeWebhook {
  return signStripeWebhook(
    stripePaidPaymentIntentFixture(pickFixtureOverrides(overrides)),
    pickSignOptions(overrides),
  );
}

export function signedStripeCreatedWebhook(
  overrides: StripeCheckoutFixtureOverrides & SignStripeWebhookOptions = {},
): SignedStripeWebhook {
  return signStripeWebhook(
    stripeCreatedPaymentIntentFixture(pickFixtureOverrides(overrides)),
    pickSignOptions(overrides),
  );
}
