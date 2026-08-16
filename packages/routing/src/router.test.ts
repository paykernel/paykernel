import { describe, it, expect } from "bun:test";
import { createPaymentRouter, decisionToTelemetryAttributes } from "./router";
import { route } from "./route";
import { NoRouteMatchError } from "./errors";
import type { RoutingDecision, RoutingInput } from "./types";

/** Golden target sample from Phase 21. */
function createSampleRouter() {
  return createPaymentRouter({
    rules: [
      route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
      route({ currency: "USD" }).to("stripe"),
    ],
    fallback: "stripe",
  });
}

describe("createPaymentRouter + select — target sample", () => {
  it("SAR + mada → moyasar", () => {
    const router = createSampleRouter();
    const d = router.select({ currency: "SAR", paymentMethod: "mada" });
    expect(d.gateway).toBe("moyasar");
    expect(d.matched).toBe(true);
    expect(d.usedFallback).toBe(false);
    expect(d.ruleIndex).toBe(0);
  });

  it("USD → stripe", () => {
    const router = createSampleRouter();
    const d = router.select({ currency: "USD" });
    expect(d.gateway).toBe("stripe");
    expect(d.matched).toBe(true);
    expect(d.ruleIndex).toBe(1);
  });

  it("select-time fallback stripe when no rule matches", () => {
    const router = createSampleRouter();
    const d = router.select({ currency: "EUR" });
    expect(d.gateway).toBe("stripe");
    expect(d.matched).toBe(false);
    expect(d.usedFallback).toBe(true);
    expect(d.reason).toBe("fallback");
  });
});

describe("A1 determinism + rule order", () => {
  it("same input+rules → identical decision", () => {
    const router = createSampleRouter();
    const input: RoutingInput = { currency: "SAR", paymentMethod: "mada" };
    const a = router.select(input);
    const b = router.select(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("first match wins (order matters)", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("first"),
        route({ currency: "USD" }).to("second"),
      ],
    });
    expect(router.select({ currency: "USD" }).gateway).toBe("first");
  });

  it("reordering rules changes decision", () => {
    const a = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
      ],
    });
    const b = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("paypal"),
        route({ currency: "USD" }).to("stripe"),
      ],
    });
    expect(a.select({ currency: "USD" }).gateway).toBe("stripe");
    expect(b.select({ currency: "USD" }).gateway).toBe("paypal");
  });
});

describe("select purity — no payment mutation", () => {
  it("router surface is select-only (no payment execution methods)", () => {
    const router = createSampleRouter();
    expect(typeof router.select).toBe("function");
    expect("createPayment" in router).toBe(false);
    expect("capturePayment" in router).toBe(false);
    expect("refundPayment" in router).toBe(false);
    const d = router.select({ currency: "USD" });
    expect(d.gateway).toBe("stripe");
  });

  it("rules snapshot is frozen", () => {
    const router = createSampleRouter();
    expect(Object.isFrozen(router.rules)).toBe(true);
    expect(router.fallback).toBe("stripe");
  });
});

describe("no match behavior", () => {
  it("throws NoRouteMatchError without fallback (fail-closed)", () => {
    const router = createPaymentRouter({
      rules: [route({ currency: "SAR" }).to("moyasar")],
    });
    expect(() => router.select({ currency: "USD" })).toThrow(NoRouteMatchError);
  });

  it("throws when fallback is unhealthy or excluded", () => {
    const router = createPaymentRouter({
      rules: [route({ currency: "SAR" }).to("moyasar")],
      fallback: "stripe",
    });
    expect(() =>
      router.select({
        currency: "USD",
        health: { stripe: false },
      }),
    ).toThrow(NoRouteMatchError);
    expect(() =>
      router.select({
        currency: "USD",
        excludeGateways: ["stripe"],
      }),
    ).toThrow(NoRouteMatchError);
  });
});

describe("21.1 inputs affect matching", () => {
  it("country", () => {
    const router = createPaymentRouter({
      rules: [route({ country: "SA" }).to("moyasar")],
      fallback: "stripe",
    });
    expect(router.select({ country: "sa" }).gateway).toBe("moyasar");
    expect(router.select({ country: "US" }).gateway).toBe("stripe");
  });

  it("tenant + tenantConfig", () => {
    const router = createPaymentRouter({
      rules: [
        route({ tenant: "acme", tenantConfig: { plan: "pro" } }).to("stripe"),
      ],
      fallback: "moyasar",
    });
    expect(
      router.select({ tenant: "acme", tenantConfig: { plan: "pro" } }).gateway,
    ).toBe("stripe");
    expect(
      router.select({ tenant: "acme", tenantConfig: { plan: "free" } }).gateway,
    ).toBe("moyasar");
  });

  it("amount range", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
        // Explicit small-amount rule (ROUTE-1: fallback no longer bypasses bounds)
        route({
          amountMax: "99.99",
          amountCurrency: "USD",
        }).to("stripe"),
      ],
    });
    expect(
      router.select({
        amount: { amount: "150.00", currency: "USD" },
      }).gateway,
    ).toBe("enterprise-psp");
    expect(
      router.select({
        amount: { amount: "50.00", currency: "USD" },
      }).gateway,
    ).toBe("stripe");
  });

  it("ROUTE-1: complementary amount-split + fallback is honesty-blocked after exclude", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          amountMax: "99.99",
          amountCurrency: "USD",
        }).to("stripe"),
        route({
          currency: "USD",
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("paypal"),
      ],
      fallback: "stripe",
    });
    expect(
      router.select({
        currency: "USD",
        amount: { amount: "150.00", currency: "USD" },
      }).gateway,
    ).toBe("paypal");
    // After excluding the matching bucket, complementary stripe max still
    // matches non-amount criteria — fallback must not send $150 to a
    // $99.99-bounded gateway (fail-closed NoRouteMatchError).
    expect(() =>
      router.select({
        currency: "USD",
        amount: { amount: "150.00", currency: "USD" },
        excludeGateways: ["paypal"],
      }),
    ).toThrow(NoRouteMatchError);
  });

  it("ROUTE-1: select-time fallback does not bypass amount-range bounds", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    // In-range still matches the rule
    expect(
      router.select({
        amount: { amount: "150.00", currency: "USD" },
      }).gateway,
    ).toBe("enterprise-psp");
    // Out-of-range must fail-closed — unconstrained fallback is dishonest
    expect(() =>
      router.select({
        amount: { amount: "50.00", currency: "USD" },
      }),
    ).toThrow(NoRouteMatchError);
  });

  it("P21-AMOUNT-RESOLVE: string amount + input.currency is bounded (USD min 100)", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    expect(() =>
      router.select({ currency: "USD", amount: "50.00" }),
    ).toThrow(NoRouteMatchError);
    expect(
      router.select({ currency: "USD", amount: "150.00" }).gateway,
    ).toBe("enterprise-psp");
  });

  it("P21-AMOUNT-RESOLVE: missing amount against a range rule fails closed", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    expect(() => router.select({ currency: "USD" })).toThrow(NoRouteMatchError);
  });

  it("P21-AMOUNT-RESOLVE: invalid JPY fraction against a JPY range fails closed", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          amountMin: "1",
          amountMax: "10000",
          amountCurrency: "JPY",
        }).to("jpy-psp"),
      ],
      fallback: "stripe",
    });
    expect(() =>
      router.select({ currency: "JPY", amount: "10.50" }),
    ).toThrow(NoRouteMatchError);
  });

  it("P21-EXCLUDE-HONESTY: exclude/unhealthy do not drop amount-range honesty", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    expect(() =>
      router.select({
        amount: { amount: "50.00", currency: "USD" },
        excludeGateways: ["enterprise-psp"],
      }),
    ).toThrow(NoRouteMatchError);
    expect(() =>
      router.select({
        amount: { amount: "50.00", currency: "USD" },
        health: { "enterprise-psp": false },
      }),
    ).toThrow(NoRouteMatchError);
  });

  it("P21-EXCLUDE-HONESTY: exclude/unhealthy do not drop rule-level requiredCapabilities", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          requiredCapabilities: ["refunds"],
        }).to("stripe"),
      ],
      fallback: "paypal",
    });
    expect(() =>
      router.select({
        currency: "USD",
        excludeGateways: ["stripe"],
        gatewayCapabilities: {
          stripe: { refunds: true },
          paypal: { payments: true },
        },
      }),
    ).toThrow(NoRouteMatchError);
    expect(() =>
      router.select({
        currency: "USD",
        health: { stripe: false },
        gatewayCapabilities: {
          stripe: { refunds: true },
          paypal: { payments: true },
        },
      }),
    ).toThrow(NoRouteMatchError);
  });

  it("ROUTE-1: fallback still applies when no rule matches non-amount criteria", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    // EUR never matches the USD rule's non-amount criteria → fallback ok
    const d = router.select({
      currency: "EUR",
      amount: { amount: "50.00", currency: "EUR" },
    });
    expect(d.gateway).toBe("stripe");
    expect(d.usedFallback).toBe(true);
  });

  it("capability requirements fail-closed", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          requiredCapabilities: ["providerRecurring"],
        }).to("stripe"),
      ],
      fallback: "paypal",
    });
    // ROUTE-2: no capability map → rule fails and fallback also lacks caps → throw
    expect(() => router.select({ currency: "USD" })).toThrow(NoRouteMatchError);
    expect(
      router.select({
        currency: "USD",
        gatewayCapabilities: { stripe: { providerRecurring: true } },
      }).gateway,
    ).toBe("stripe");
    // Fallback allowed only when it satisfies the rule-level requiredCapabilities
    expect(
      router.select({
        currency: "USD",
        gatewayCapabilities: {
          stripe: { providerRecurring: false },
          paypal: { providerRecurring: true },
        },
      }).gateway,
    ).toBe("paypal");
  });

  it("ROUTE-1: amount min/max without amountCurrency blocks select-time fallback", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          amountMin: "100.00",
          // missing amountCurrency — misconfigured money bound
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    // Rule cannot match (amountInRange fails closed) but non-amount criteria
    // match — unconstrained fallback must not bypass the intended bound.
    expect(() =>
      router.select({
        currency: "USD",
        amount: { amount: "50.00", currency: "USD" },
      }),
    ).toThrow(NoRouteMatchError);
  });

  it("ROUTE-2: select-time fallback honors rule-level requiredCapabilities", () => {
    const router = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          requiredCapabilities: ["refunds"],
        }).to("stripe"),
      ],
      fallback: "paypal",
    });
    // Nearly-matching rule requires refunds; fallback lacks them → no route
    expect(() =>
      router.select({
        currency: "USD",
        gatewayCapabilities: {
          stripe: { refunds: false },
          paypal: { payments: true },
        },
      }),
    ).toThrow(NoRouteMatchError);
    // Fallback has the rule-level caps → allowed
    const d = router.select({
      currency: "USD",
      gatewayCapabilities: {
        stripe: { refunds: false },
        paypal: { refunds: true },
      },
    });
    expect(d.gateway).toBe("paypal");
    expect(d.usedFallback).toBe(true);
  });

  it("health filters unhealthy gateways at select time", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
      ],
    });
    const d = router.select({
      currency: "USD",
      health: { stripe: false },
    });
    expect(d.gateway).toBe("paypal");
  });

  it("unhealthy primary does not match — next rule may win at select time", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
        route({ currency: "SAR" }).to("paymob"),
      ],
      fallback: "stripe",
    });
    const d = router.select({
      currency: "SAR",
      paymentMethod: "mada",
      health: { moyasar: false },
    });
    // First rule skipped (unhealthy); second matches currency only
    expect(d.gateway).toBe("paymob");
  });

  it("cost tie-break is deterministic", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
        route({ currency: "USD" }).to("adyen"),
      ],
    });
    // Without cost → first match
    expect(router.select({ currency: "USD" }).gateway).toBe("stripe");

    const d = router.select({
      currency: "USD",
      cost: { stripe: 10, paypal: 1, adyen: 5 },
    });
    expect(d.gateway).toBe("paypal");
    expect(d.reason).toBe("rule_match_cost_tiebreak");

    // Equal cost → gateway id then index (stable)
    const d2 = router.select({
      currency: "USD",
      cost: { stripe: 1, paypal: 1, adyen: 1 },
    });
    // adyen < paypal < stripe lexicographically
    expect(d2.gateway).toBe("adyen");
  });

  it("merchantPreference boosts preferred gateway among matches", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
      ],
    });
    const d = router.select({
      currency: "USD",
      merchantPreference: "paypal",
    });
    expect(d.gateway).toBe("paypal");
    expect(d.reason).toBe("rule_match_merchant_preference");
  });

  it("ROUTE-2: merchantPreference boost is case-insensitive", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("PayPal"),
      ],
    });
    const d = router.select({
      currency: "USD",
      merchantPreference: "paypal",
    });
    expect(d.gateway).toBe("PayPal");
    expect(d.reason).toBe("rule_match_merchant_preference");
  });
});

describe("A3 decision.gateway + telemetry", () => {
  it("decision.gateway always set on success", () => {
    const router = createSampleRouter();
    const decisions: RoutingDecision[] = [
      router.select({ currency: "SAR", paymentMethod: "mada" }),
      router.select({ currency: "USD" }),
      router.select({ currency: "EUR" }),
    ];
    for (const d of decisions) {
      expect(typeof d.gateway).toBe("string");
      expect(d.gateway.length).toBeGreaterThan(0);
    }
  });

  it("decisionToTelemetryAttributes includes gateway and non-sensitive fields only", () => {
    const router = createSampleRouter();
    const d = router.select({ currency: "SAR", paymentMethod: "mada" });
    const attrs = decisionToTelemetryAttributes(d);
    expect(attrs.gateway).toBe("moyasar");
    expect(attrs.matched).toBe(true);
    expect(attrs.usedFallback).toBe(false);
    expect(attrs.ruleIndex).toBe(0);
    expect(attrs.reason).toBeDefined();
    // No secret-like keys
    expect(Object.keys(attrs).sort()).toEqual(
      ["gateway", "matched", "reason", "ruleIndex", "usedFallback"].sort(),
    );
  });

  it("fallback decision telemetry has gateway without ruleIndex", () => {
    const router = createSampleRouter();
    const d = router.select({ currency: "JPY" });
    const attrs = decisionToTelemetryAttributes(d);
    expect(attrs.gateway).toBe("stripe");
    expect(attrs.usedFallback).toBe(true);
    expect(attrs.ruleIndex).toBeUndefined();
  });
});

describe("excludeGateways", () => {
  it("skips excluded gateways when selecting", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
      ],
    });
    expect(
      router.select({
        currency: "USD",
        excludeGateways: ["stripe"],
      }).gateway,
    ).toBe("paypal");
  });

  it("ROUTE-1: excludeGateways is case-insensitive", () => {
    const router = createPaymentRouter({
      rules: [
        route({ currency: "USD" }).to("stripe"),
        route({ currency: "USD" }).to("paypal"),
      ],
    });
    expect(
      router.select({
        currency: "USD",
        excludeGateways: ["Stripe", "STRIPE"],
      }).gateway,
    ).toBe("paypal");
  });
});

describe("route().to builder", () => {
  it("rejects empty gateway", () => {
    expect(() => route({ currency: "USD" }).to("")).toThrow();
    expect(() => route({ currency: "USD" }).to("   ")).toThrow();
  });

  it("freezes rule", () => {
    const rule = route({ currency: "USD" }).to("stripe");
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(rule.match)).toBe(true);
    expect(rule.gateway).toBe("stripe");
  });
});
