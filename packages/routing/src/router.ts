/**
 * createPaymentRouter + pure select (Phase 21.2).
 *
 * Select-only: NEVER calls createPayment, capture, refund, fetch, or I/O.
 * Deterministic for the same input + config (A1).
 *
 * config.fallback is SELECT-TIME default only — not post-attempt recovery.
 */

import {
  amountInRange,
  amountOutsideConfiguredRange,
} from "./amount-range";
import { NoRouteMatchError, type NoRouteMatchReason } from "./errors";
import {
  costScore,
  gatewayHasCapabilities,
  isGatewayHealthy,
  ruleMatches,
  ruleMatchesIgnoringAmount,
  ruleMatchesIgnoringAmountAndCapabilities,
  stringsEqualCi,
} from "./match";
import type {
  CreatePaymentRouterOptions,
  PaymentRouter,
  RouteMatchCriteria,
  RoutingDecision,
  RoutingDecisionReason,
  RoutingInput,
  RoutingRule,
  RoutingTelemetryAttributes,
} from "./types";

/** Categorical partitions that must not be silently bypassed by select-time fallback. */
const PARTITION_FIELDS = ["currency", "country", "paymentMethod"] as const;
type PartitionField = (typeof PARTITION_FIELDS)[number];

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
    // ROUTE-1 / P21-EXCLUDE-HONESTY: amount-range honesty — do not use
    // unconstrained select-time fallback when at least one rule matches all
    // non-amount criteria but fails amount range, even if that rule's gateway
    // is excluded or unhealthy. Falling back would silently accept amounts
    // outside configured money bounds.
    if (hasAmountRangeOnlyReject(input, rules)) {
      throw new NoRouteMatchError(
        "No routing rule matched: input amount is outside configured rule amount ranges (select-time fallback does not bypass amount bounds)",
        input,
        "amount_range_honesty",
      );
    }
    // ROUTE-2 / P21-EXCLUDE-HONESTY: capability honesty — do not use
    // unconstrained select-time fallback when a nearly-matching rule requires
    // capabilities the fallback gateway lacks (rule-level requiredCapabilities
    // must not be ignored), even if that rule's gateway is excluded/unhealthy.
    if (
      hasRequiredCapabilitiesOnlyReject(
        input,
        rules,
        exclude,
        healthThreshold,
        fallback,
      )
    ) {
      throw new NoRouteMatchError(
        "No routing rule matched and fallback gateway lacks required capabilities from matching rules",
        input,
        "capability_honesty",
      );
    }
    // NEW-ROUTE-1: complementary currency / country / method partitions —
    // same honesty as hasAmountRangeOnlyReject. After exclude/unhealthy of
    // the matching bucket, do not send the input to unconstrained fallback
    // (e.g. USD→stripe + EUR→adyen, exclude adyen, EUR must not fall back
    // to stripe). Unmatched values (no rule in that partition) may still
    // use select-time fallback.
    const partitionHonesty = complementaryPartitionHonesty(input, rules);
    if (partitionHonesty !== undefined) {
      throw new NoRouteMatchError(
        partitionHonesty.message,
        input,
        partitionHonesty.reason,
      );
    }
    return selectFallback(input, fallback, healthThreshold, exclude);
  }

  const chosen = pickCandidate(candidates, input);
  return buildDecision(chosen, input);
}

/**
 * True when a configured amount range would be dishonestly bypassed by
 * unconstrained select-time fallback (ROUTE-1 / P21-EXCLUDE-HONESTY /
 * P21-AMOUNT-RESOLVE).
 *
 * Still considers rules whose gateway is excluded or unhealthy — post-attempt
 * `excludeGateways` / `attemptedGateways` / unhealthy maps must not drop
 * amount bounds. Cross-currency with a resolvable different currency does not
 * count (other criteria; fallback may still apply).
 */
function hasAmountRangeOnlyReject(
  input: RoutingInput,
  rules: readonly RoutingRule[],
): boolean {
  for (const rule of rules) {
    if (!ruleMatchesIgnoringAmount(rule, input)) continue;
    if (amountOutsideConfiguredRange(input, rule.match)) {
      return true;
    }
  }
  return false;
}

/**
 * True when at least one rule matches all non-amount, non-capability criteria
 * and declares requiredCapabilities that the select-time fallback gateway
 * lacks (ROUTE-2 / P21-EXCLUDE-HONESTY).
 *
 * Unconstrained fallback must not silently drop rule-level capability bounds,
 * even when the rule's own gateway is excluded or unhealthy.
 * When no fallback is configured this returns false (selectFallback throws).
 */
function hasRequiredCapabilitiesOnlyReject(
  input: RoutingInput,
  rules: readonly RoutingRule[],
  exclude: ReadonlySet<string>,
  healthThreshold: number,
  fallback: string | undefined,
): boolean {
  if (fallback === undefined || fallback.length === 0) return false;
  if (exclude.has(fallback.trim().toLowerCase())) return false;
  if (!isGatewayHealthy(fallback, input, healthThreshold)) return false;

  for (const rule of rules) {
    // P21-EXCLUDE-HONESTY: do not skip excluded / unhealthy rule gateways.
    // Non-amount non-cap criteria (currency/country/…) must already match.
    if (!ruleMatchesIgnoringAmountAndCapabilities(rule, input)) continue;
    // Amount range on the nearly-matching rule must still pass (or be absent);
    // amount honesty is handled separately by hasAmountRangeOnlyReject.
    if (!amountInRange(input, rule.match)) continue;

    const caps =
      rule.match.requiredCapabilities ??
      input.requiredCapabilities ??
      undefined;
    if (caps === undefined || caps.length === 0) continue;
    if (!gatewayHasCapabilities(fallback, caps, input)) {
      return true;
    }
  }
  return false;
}

/**
 * NEW-ROUTE-1: do not use unconstrained select-time fallback when a
 * complementary currency / country / paymentMethod partition exists.
 * Exclude / health on the matching bucket are ignored (same as amount honesty).
 */
function complementaryPartitionHonesty(
  input: RoutingInput,
  rules: readonly RoutingRule[],
): { reason: NoRouteMatchReason; message: string } | undefined {
  for (const field of PARTITION_FIELDS) {
    if (!hasComplementaryPartitionOnlyReject(input, rules, field)) continue;
    return {
      reason: partitionHonestyReason(field),
      message: partitionHonestyMessage(field),
    };
  }
  return undefined;
}

/**
 * True when at least one rule matches all non-`field` criteria but fails that
 * partition (same walk as {@link hasAmountRangeOnlyReject}), and a complementary
 * rule owns the input's bucket (possibly excluded / unhealthy).
 */
function hasComplementaryPartitionOnlyReject(
  input: RoutingInput,
  rules: readonly RoutingRule[],
  field: PartitionField,
): boolean {
  const inputValue = specifiedPartitionValue(input, field);
  if (inputValue === undefined) return false;

  // Input must be inside a configured bucket of this field. Unmatched values
  // (GBP when only USD/EUR exist) still use select-time fallback.
  const hasMatchingBucket = rules.some((rule) => {
    const value = specifiedPartitionValue(rule.match, field);
    return (
      value !== undefined &&
      stringsEqualCi(value, inputValue) &&
      ruleMatches(rule, input)
    );
  });
  if (!hasMatchingBucket) return false;

  // Same honesty as hasAmountRangeOnlyReject: complementary rule matches
  // everything except this partition field.
  for (const rule of rules) {
    const ruleValue = specifiedPartitionValue(rule.match, field);
    if (ruleValue === undefined) continue;
    if (stringsEqualCi(ruleValue, inputValue)) continue;
    if (ruleMatchesIgnoringPartitionField(rule, input, field)) {
      return true;
    }
  }

  // Complementary value exists even when that rule fails other criteria
  // (USD+US vs EUR+DE) — still do not unconstrained-fallback.
  return rules.some((rule) => {
    const value = specifiedPartitionValue(rule.match, field);
    return value !== undefined && !stringsEqualCi(value, inputValue);
  });
}

function specifiedPartitionValue(
  match: Pick<RouteMatchCriteria, PartitionField>,
  field: PartitionField,
): string | undefined {
  const raw = match[field];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** {@link ruleMatches} with `field` treated as a wildcard. */
function ruleMatchesIgnoringPartitionField(
  rule: RoutingRule,
  input: RoutingInput,
  field: PartitionField,
): boolean {
  const rest: RouteMatchCriteria = { ...rule.match };
  delete rest[field];
  return ruleMatches({ match: rest, gateway: rule.gateway }, input);
}

function partitionHonestyReason(field: PartitionField): NoRouteMatchReason {
  switch (field) {
    case "currency":
      return "complementary_currency_honesty";
    case "country":
      return "complementary_country_honesty";
    case "paymentMethod":
      return "complementary_method_honesty";
  }
}

function partitionHonestyMessage(field: PartitionField): string {
  switch (field) {
    case "currency":
      return "No routing rule matched: complementary currency partition exists (select-time fallback does not bypass currency partitions)";
    case "country":
      return "No routing rule matched: complementary country partition exists (select-time fallback does not bypass country partitions)";
    case "paymentMethod":
      return "No routing rule matched: complementary payment-method partition exists (select-time fallback does not bypass payment-method partitions)";
  }
}

function pickCandidate(
  candidates: Candidate[],
  input: RoutingInput,
): Candidate {
  // Merchant preference boost: among matches, prefer gateway === preference.
  // ROUTE-2: compare gateway ids case-insensitively (same as exclude/health/cost).
  let pool = candidates;
  if (input.merchantPreference !== undefined) {
    const pref = input.merchantPreference.trim();
    if (pref) {
      const preferred = candidates.filter((c) =>
        stringsEqualCi(c.rule.gateway, pref),
      );
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
    stringsEqualCi(chosen.rule.gateway, input.merchantPreference.trim())
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
          "capability_honesty",
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
