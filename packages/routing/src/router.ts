/**
 * createPaymentRouter + pure select (Phase 21.2).
 *
 * Select-only: NEVER calls createPayment, capture, refund, fetch, or I/O.
 * Deterministic for the same input + config (A1).
 *
 * config.fallback is SELECT-TIME default only — not post-attempt recovery.
 */

import { NoRouteMatchError } from "./errors";
import {
  costScore,
  gatewayHasCapabilities,
  isGatewayHealthy,
  ruleMatches,
} from "./match";
import type {
  CreatePaymentRouterOptions,
  PaymentRouter,
  RoutingDecision,
  RoutingDecisionReason,
  RoutingInput,
  RoutingRule,
  RoutingTelemetryAttributes,
} from "./types";

const DEFAULT_HEALTH_THRESHOLD = 1;

type Candidate = {
  rule: RoutingRule;
  index: number;
};

/**
 * Create a pure, deterministic payment router.
 *
 * @example
 * ```ts
 * const router = createPaymentRouter({
 *   rules: [
 *     route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
 *     route({ currency: "USD" }).to("stripe"),
 *   ],
 *   fallback: "stripe",
 * });
 * const decision = router.select({ currency: "SAR", paymentMethod: "mada" });
 * // await payments.createPayment(params, decision.gateway);
 * ```
 */
export function createPaymentRouter(
  options: CreatePaymentRouterOptions,
): PaymentRouter {
  const rules = Object.freeze(
    options.rules.map((r) =>
      Object.freeze({
        match: Object.freeze({ ...r.match }),
        gateway: r.gateway,
      }),
    ),
  );

  const fallback =
    options.fallback !== undefined ? options.fallback.trim() : undefined;
  const healthThreshold =
    options.healthThreshold !== undefined
      ? options.healthThreshold
      : DEFAULT_HEALTH_THRESHOLD;

  const router: PaymentRouter = {
    rules,
    get fallback() {
      return fallback;
    },
    get healthThreshold() {
      return healthThreshold;
    },
    select(input: RoutingInput): RoutingDecision {
      return selectImpl(input, rules, fallback, healthThreshold);
    },
  };

  return Object.freeze(router);
}

function selectImpl(
  input: RoutingInput,
  rules: readonly RoutingRule[],
  fallback: string | undefined,
  healthThreshold: number,
): RoutingDecision {
  // ROUTE-1: excludeGateways compared case-insensitively (after trim).
  const exclude = new Set(
    (input.excludeGateways ?? [])
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean),
  );

  const candidates: Candidate[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule === undefined) continue;
    if (exclude.has(rule.gateway.trim().toLowerCase())) continue;
    if (!isGatewayHealthy(rule.gateway, input, healthThreshold)) continue;
    if (!ruleMatches(rule, input)) continue;
    candidates.push({ rule, index: i });
  }

  if (candidates.length === 0) {
    return selectFallback(input, fallback, healthThreshold, exclude);
  }

  const chosen = pickCandidate(candidates, input);
  return buildDecision(chosen, input);
}

function pickCandidate(
  candidates: Candidate[],
  input: RoutingInput,
): Candidate {
  // Merchant preference boost: among matches, prefer gateway === preference.
  let pool = candidates;
  if (input.merchantPreference !== undefined) {
    const pref = input.merchantPreference.trim();
    if (pref) {
      const preferred = candidates.filter((c) => c.rule.gateway === pref);
      if (preferred.length > 0) {
        pool = preferred;
      }
    }
  }

  // Cost tie-break: when cost map provided, sort by cost then gateway id then index.
  if (input.cost !== undefined) {
    const sorted = [...pool].sort((a, b) => {
      const ca = costScore(a.rule.gateway, input);
      const cb = costScore(b.rule.gateway, input);
      if (ca !== cb) return ca < cb ? -1 : 1;
      const ga = a.rule.gateway;
      const gb = b.rule.gateway;
      if (ga !== gb) return ga < gb ? -1 : 1;
      return a.index - b.index;
    });
    return sorted[0]!;
  }

  // First match in original rule order (deterministic A1).
  return pool[0]!;
}

function buildDecision(
  chosen: Candidate,
  input: RoutingInput,
): RoutingDecision {
  let reason: RoutingDecisionReason = "rule_match";
  if (
    input.merchantPreference !== undefined &&
    chosen.rule.gateway === input.merchantPreference.trim()
  ) {
    reason = "rule_match_merchant_preference";
  } else if (input.cost !== undefined) {
    reason = "rule_match_cost_tiebreak";
  }

  const decision: RoutingDecision = {
    gateway: chosen.rule.gateway,
    matched: true,
    usedFallback: false,
    ruleIndex: chosen.index,
    reason,
  };
  return decision;
}

function selectFallback(
  input: RoutingInput,
  fallback: string | undefined,
  healthThreshold: number,
  /** Lowercased gateway ids. */
  exclude: ReadonlySet<string>,
): RoutingDecision {
  if (
    fallback !== undefined &&
    fallback.length > 0 &&
    !exclude.has(fallback.trim().toLowerCase()) &&
    isGatewayHealthy(fallback, input, healthThreshold)
  ) {
    // Select-time fallback still honors input-level requiredCapabilities.
    // Capability map gateway ids are matched case-insensitively.
    if (
      input.requiredCapabilities !== undefined &&
      input.requiredCapabilities.length > 0
    ) {
      if (
        !gatewayHasCapabilities(fallback, input.requiredCapabilities, input)
      ) {
        throw new NoRouteMatchError(
          "No routing rule matched and fallback gateway lacks required capabilities",
          input,
        );
      }
    }

    return {
      gateway: fallback,
      matched: false,
      usedFallback: true,
      reason: "fallback",
    };
  }

  // Fail-closed — never invent a gateway id.
  throw new NoRouteMatchError(
    "No routing rule matched and no usable select-time fallback is configured",
    input,
  );
}

/**
 * Map a routing decision to non-sensitive telemetry attributes (A3).
 * Never includes tenantConfig, health maps, cost maps, or secrets.
 */
export function decisionToTelemetryAttributes(
  decision: RoutingDecision,
): RoutingTelemetryAttributes {
  const attrs: RoutingTelemetryAttributes = {
    gateway: decision.gateway,
    matched: decision.matched,
    usedFallback: decision.usedFallback,
    reason: decision.reason,
  };
  if (decision.ruleIndex !== undefined) {
    attrs.ruleIndex = decision.ruleIndex;
  }
  return attrs;
}
