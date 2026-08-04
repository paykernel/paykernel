/**
 * `route(match).to(gateway)` builder for routing rules (Phase 21).
 *
 * Produces immutable {@link RoutingRule} values for {@link createPaymentRouter}.
 * Optional keys are omitted when absent (`exactOptionalPropertyTypes`).
 */

import type { RouteMatchCriteria, RoutingRule } from "./types";

/** Fluent builder returned by {@link route}. */
export type RouteBuilder = {
  /**
   * Finalize the rule with a gateway id.
   * Gateway id is trimmed; empty string throws.
   */
  to(gateway: string): RoutingRule;
};

/**
 * Start a routing rule builder from match criteria.
 *
 * @example
 * ```ts
 * route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar")
 * route({ currency: "USD" }).to("stripe")
 * ```
 */
export function route(match: RouteMatchCriteria = {}): RouteBuilder {
  const frozenMatch = freezeMatch(match);
  return {
    to(gateway: string): RoutingRule {
      const id = gateway.trim();
      if (!id) {
        throw new Error("route().to(gateway): gateway id must be non-empty");
      }
      return Object.freeze({
        match: frozenMatch,
        gateway: id,
      });
    },
  };
}

/**
 * Normalize and freeze match criteria, omitting absent optional keys.
 */
function freezeMatch(match: RouteMatchCriteria): Readonly<RouteMatchCriteria> {
  const out: RouteMatchCriteria = {};

  if (match.currency !== undefined) {
    out.currency = match.currency.trim();
  }
  if (match.country !== undefined) {
    out.country = match.country.trim();
  }
  if (match.paymentMethod !== undefined) {
    out.paymentMethod = match.paymentMethod.trim();
  }
  if (match.amountMin !== undefined) {
    out.amountMin = String(match.amountMin).trim();
  }
  if (match.amountMax !== undefined) {
    out.amountMax = String(match.amountMax).trim();
  }
  if (match.amountCurrency !== undefined) {
    out.amountCurrency = match.amountCurrency.trim();
  }
  if (match.tenant !== undefined) {
    out.tenant = match.tenant;
  }
  if (match.tenantConfig !== undefined) {
    out.tenantConfig = Object.freeze({ ...match.tenantConfig });
  }
  if (match.requiredCapabilities !== undefined) {
    out.requiredCapabilities = Object.freeze([...match.requiredCapabilities]);
  }
  if (match.merchantPreference !== undefined) {
    out.merchantPreference = match.merchantPreference.trim();
  }

  return Object.freeze(out);
}
