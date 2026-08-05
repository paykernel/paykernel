import { describe, it, expect } from "bun:test";
import { route } from "./route";
import {
  costScore,
  gatewayHasCapabilities,
  isGatewayHealthy,
  ruleMatches,
  stringsEqualCi,
} from "./match";
import type { RoutingInput } from "./types";

describe("stringsEqualCi", () => {
  it("trims and compares case-insensitively", () => {
    expect(stringsEqualCi(" SAR ", "sar")).toBe(true);
    expect(stringsEqualCi("USD", "EUR")).toBe(false);
  });
});

describe("ruleMatches", () => {
  it("empty match is catch-all", () => {
    const rule = route({}).to("stripe");
    expect(ruleMatches(rule, {})).toBe(true);
    expect(ruleMatches(rule, { currency: "USD" })).toBe(true);
  });

  it("currency match is case-insensitive", () => {
    const rule = route({ currency: "SAR" }).to("moyasar");
    expect(ruleMatches(rule, { currency: "sar" })).toBe(true);
    expect(ruleMatches(rule, { currency: " USD " })).toBe(false);
    expect(ruleMatches(rule, {})).toBe(false);
  });

  it("country and paymentMethod match", () => {
    const rule = route({
      country: "SA",
      paymentMethod: "mada",
    }).to("moyasar");
    expect(
      ruleMatches(rule, { country: "sa", paymentMethod: "MADA" }),
    ).toBe(true);
    expect(
      ruleMatches(rule, { country: "SA", paymentMethod: "visa" }),
    ).toBe(false);
  });

  it("tenant exact match", () => {
    const rule = route({ tenant: "acme" }).to("stripe");
    expect(ruleMatches(rule, { tenant: "acme" })).toBe(true);
    expect(ruleMatches(rule, { tenant: "other" })).toBe(false);
  });

  it("tenantConfig matches specified keys only", () => {
    const rule = route({
      tenantConfig: { region: "eu", plan: "pro" },
    }).to("stripe");
    expect(
      ruleMatches(rule, {
        tenantConfig: { region: "eu", plan: "pro", extra: true },
      }),
    ).toBe(true);
    expect(
      ruleMatches(rule, { tenantConfig: { region: "eu", plan: "free" } }),
    ).toBe(false);
    expect(ruleMatches(rule, {})).toBe(false);
  });

  it("merchantPreference on rule is a hard criterion", () => {
    const rule = route({ merchantPreference: "stripe" }).to("stripe");
    expect(ruleMatches(rule, { merchantPreference: "stripe" })).toBe(true);
    expect(ruleMatches(rule, { merchantPreference: "moyasar" })).toBe(false);
    // ROUTE-2: case-insensitive
    expect(ruleMatches(rule, { merchantPreference: "Stripe" })).toBe(true);
    expect(ruleMatches(rule, { merchantPreference: "STRIPE" })).toBe(true);
  });

  it("amount range with AND other criteria", () => {
    const rule = route({
      currency: "USD",
      amountMin: "10.00",
      amountMax: "100.00",
      amountCurrency: "USD",
    }).to("stripe");
    expect(
      ruleMatches(rule, {
        currency: "USD",
        amount: { amount: "50.00", currency: "USD" },
      }),
    ).toBe(true);
    expect(
      ruleMatches(rule, {
        currency: "USD",
        amount: { amount: "5.00", currency: "USD" },
      }),
    ).toBe(false);
  });

  it("requiredCapabilities fail-closed without map", () => {
    const rule = route({ requiredCapabilities: ["payments"] }).to("stripe");
    expect(ruleMatches(rule, {})).toBe(false);
    expect(
      ruleMatches(rule, {
        gatewayCapabilities: { stripe: { payments: true } },
      }),
    ).toBe(true);
    expect(
      ruleMatches(rule, {
        gatewayCapabilities: { stripe: { payments: false } },
      }),
    ).toBe(false);
    expect(
      ruleMatches(rule, {
        gatewayCapabilities: { moyasar: { payments: true } },
      }),
    ).toBe(false);
  });

  it("input-level requiredCapabilities apply when rule omits them", () => {
    const rule = route({ currency: "USD" }).to("stripe");
    const input: RoutingInput = {
      currency: "USD",
      requiredCapabilities: ["refunds"],
      gatewayCapabilities: { stripe: { payments: true } },
    };
    expect(ruleMatches(rule, input)).toBe(false);
    expect(
      ruleMatches(rule, {
        ...input,
        gatewayCapabilities: { stripe: { refunds: true } },
      }),
    ).toBe(true);
  });
});

describe("gatewayHasCapabilities", () => {
  it("requires all keys true", () => {
    expect(
      gatewayHasCapabilities("g", ["a", "b"], {
        gatewayCapabilities: { g: { a: true, b: true } },
      }),
    ).toBe(true);
    expect(
      gatewayHasCapabilities("g", ["a", "b"], {
        gatewayCapabilities: { g: { a: true, b: false } },
      }),
    ).toBe(false);
  });
});

describe("isGatewayHealthy", () => {
  it("missing health map → healthy", () => {
    expect(isGatewayHealthy("stripe", {}, 1)).toBe(true);
  });

  it("boolean false excludes", () => {
    expect(
      isGatewayHealthy("stripe", { health: { stripe: false } }, 1),
    ).toBe(false);
    expect(
      isGatewayHealthy("stripe", { health: { stripe: true } }, 1),
    ).toBe(true);
  });

  it("numeric threshold", () => {
    expect(
      isGatewayHealthy("stripe", { health: { stripe: 0.5 } }, 1),
    ).toBe(false);
    expect(
      isGatewayHealthy("stripe", { health: { stripe: 1 } }, 1),
    ).toBe(true);
    expect(
      isGatewayHealthy("stripe", { health: { stripe: 0.5 } }, 0.4),
    ).toBe(true);
  });

  it("missing key → healthy", () => {
    expect(
      isGatewayHealthy("stripe", { health: { moyasar: false } }, 1),
    ).toBe(true);
  });

  it("ROUTE-1/2: health map gateway ids are case-insensitive", () => {
    expect(
      isGatewayHealthy("Stripe", { health: { stripe: false } }, 1),
    ).toBe(false);
    expect(
      isGatewayHealthy("stripe", { health: { STRIPE: 0.1 } }, 1),
    ).toBe(false);
    expect(
      isGatewayHealthy("STRIPE", { health: { Stripe: true } }, 1),
    ).toBe(true);
  });
});

describe("gatewayHasCapabilities / costScore case maps", () => {
  it("capability map gateway ids are case-insensitive", () => {
    expect(
      gatewayHasCapabilities("Stripe", ["payments"], {
        gatewayCapabilities: { stripe: { payments: true } },
      }),
    ).toBe(true);
    expect(
      gatewayHasCapabilities("stripe", ["payments"], {
        gatewayCapabilities: { STRIPE: { payments: false } },
      }),
    ).toBe(false);
  });

  it("cost map gateway ids are case-insensitive", () => {
    expect(
      costScore("Stripe", { cost: { stripe: 1 } }),
    ).toBe(1);
    expect(
      costScore("stripe", { cost: { STRIPE: "2.5" } }),
    ).toBe(2.5);
  });
});
