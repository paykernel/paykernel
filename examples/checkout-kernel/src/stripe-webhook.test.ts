import { describe, expect, it } from "bun:test";
import { assertFixtureSafe } from "@paykernel/testkit";
import {
  signStripeWebhook,
  stripeCreatedPaymentIntentFixture,
  stripePaidPaymentIntentFixture,
} from "./stripe-webhook";

function intentOf(event: Record<string, unknown>): Record<string, unknown> {
  const data = event.data as { object: Record<string, unknown> };
  return data.object;
}

describe("stripe checkout fixtures", () => {
  it("paid fixture is fixture-safe, has amount_received, no latest_charge or cs_test_", () => {
    const event = stripePaidPaymentIntentFixture({ orderId: "order_fixture_paid" });
    assertFixtureSafe(event);
    const intent = intentOf(event);
    expect(event.type).toBe("payment_intent.succeeded");
    expect(intent.amount_received).toBe(1000);
    expect(intent).not.toHaveProperty("latest_charge");
    expect(JSON.stringify(event)).not.toContain("cs_test_");
    expect(JSON.stringify(event)).not.toContain("cs_live_");
  });

  it("created fixture is fixture-safe and non-paid", () => {
    const event = stripeCreatedPaymentIntentFixture();
    assertFixtureSafe(event);
    expect(event.type).toBe("payment_intent.created");
    expect(intentOf(event)).not.toHaveProperty("latest_charge");
    expect(intentOf(event)).not.toHaveProperty("amount_received");
  });

  it("signs t=,v1= over timestamp.rawBody", () => {
    const event = stripePaidPaymentIntentFixture();
    const signed = signStripeWebhook(event, { nowMs: 1_700_000_000_000 });
    expect(signed.signature.startsWith("t=1700000000,v1=")).toBe(true);
    expect(signed.rawBody).toBe(JSON.stringify(event));
  });
});
