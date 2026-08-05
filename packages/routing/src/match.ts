/**
 * Pure deterministic matchers for routing criteria (Phase 21.1).
 *
 * Matching rules:
 * - Unspecified criteria are wildcards (match any).
 * - Specified criteria must all match (AND).
 * - currency / country / paymentMethod: case-insensitive equality after trim.
 * - amount range: inclusive min/max via money-safe bigint compare (same currency).
 * - tenant / tenantConfig: exact match for specified keys.
 * - requiredCapabilities: fail-closed without capability map for the gateway.
 * - merchantPreference on a rule: case-insensitive match against input.merchantPreference.
 */

import { amountInRange } from "./amount-range";
import type { RouteMatchCriteria, RoutingInput, RoutingRule } from "./types";

/** Case-insensitive trim equality for optional string fields. */
export function stringsEqualCi(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a single rule's match criteria are satisfied by the input
 * for the rule's target gateway (capabilities checked against that gateway).
 */
export function ruleMatches(
  rule: RoutingRule,
  input: RoutingInput,
): boolean {
  if (!ruleMatchesIgnoringAmount(rule, input)) {
    return false;
  }
  return amountInRange(input, rule.match);
}

/**
 * Same as {@link ruleMatches} but skips amount-range criteria.
 * Used by select-time fallback honesty (ROUTE-1) to detect out-of-range
 * amounts that would otherwise be silently accepted by unconstrained fallback.
 */
export function ruleMatchesIgnoringAmount(
  rule: RoutingRule,
  input: RoutingInput,
): boolean {
  if (!ruleMatchesIgnoringAmountAndCapabilities(rule, input)) {
    return false;
  }
  // Rule-level requiredCapabilities, or input-level when rule omits them.
  const caps =
    rule.match.requiredCapabilities ??
    input.requiredCapabilities ??
    undefined;
  if (caps !== undefined && caps.length > 0) {
    if (!gatewayHasCapabilities(rule.gateway, caps, input)) {
      return false;
    }
  }
  return true;
}

/**
 * Non-amount, non-capability criteria only (currency/country/method/tenant/…).
 * Used by select-time capability honesty (ROUTE-2) so unconstrained fallback
 * cannot ignore rule-level `requiredCapabilities` when those rules otherwise match.
 */
export function ruleMatchesIgnoringAmountAndCapabilities(
  rule: RoutingRule,
  input: RoutingInput,
): boolean {
  const m = rule.match;

  if (m.currency !== undefined) {
    if (input.currency === undefined) return false;
    if (!stringsEqualCi(m.currency, input.currency)) return false;
  }

  if (m.country !== undefined) {
    if (input.country === undefined) return false;
    if (!stringsEqualCi(m.country, input.country)) return false;
  }

  if (m.paymentMethod !== undefined) {
    if (input.paymentMethod === undefined) return false;
    if (!stringsEqualCi(m.paymentMethod, input.paymentMethod)) return false;
  }

  if (m.tenant !== undefined) {
    if (input.tenant === undefined) return false;
    if (m.tenant !== input.tenant) return false;
  }

  if (m.tenantConfig !== undefined) {
    if (!tenantConfigMatches(m.tenantConfig, input.tenantConfig)) {
      return false;
    }
  }

  // merchantPreference hard filter is case-insensitive (trim).
  if (m.merchantPreference !== undefined) {
    if (input.merchantPreference === undefined) return false;
    if (!stringsEqualCi(m.merchantPreference, input.merchantPreference)) {
      return false;
    }
  }

  return true;
}

/**
 * Look up a gateway-keyed map entry case-insensitively (trim + lower).
 * Prefer exact key when present; otherwise first case-insensitive match.
 */
export function lookupGatewayMapEntry<T>(
  map: Readonly<Record<string, T>> | undefined,
  gatewayId: string,
): T | undefined {
  if (map === undefined) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, gatewayId)) {
    return map[gatewayId];
  }
  const needle = gatewayId.trim().toLowerCase();
  if (!needle) return undefined;
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() === needle) return v;
  }
  return undefined;
}

/**
 * Fail-closed capability check: every required key must be `true` on the
 * gateway's capability snapshot. Missing map or missing key → false.
 * Gateway ids in the map are matched case-insensitively.
 */
export function gatewayHasCapabilities(
  gatewayId: string,
  required: readonly string[],
  input: RoutingInput,
): boolean {
  const map = lookupGatewayMapEntry(input.gatewayCapabilities, gatewayId);
  if (map === undefined) {
    return false;
  }
  for (const key of required) {
    if (map[key] !== true) {
      return false;
    }
  }
  return true;
}

function tenantConfigMatches(
  required: Record<string, string | number | boolean>,
  actual: Record<string, string | number | boolean> | undefined,
): boolean {
  if (actual === undefined) return false;
  for (const key of Object.keys(required)) {
    if (actual[key] !== required[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Health filter at select time.
 * - boolean `false` → unhealthy
 * - number < threshold → unhealthy
 * - missing key → healthy (do not exclude)
 * - boolean `true` → healthy
 * Gateway ids in the health map are matched case-insensitively.
 */
export function isGatewayHealthy(
  gatewayId: string,
  input: RoutingInput,
  healthThreshold: number,
): boolean {
  if (input.health === undefined) {
    return true;
  }
  const signal = lookupGatewayMapEntry(input.health, gatewayId);
  if (signal === undefined) {
    return true;
  }
  if (typeof signal === "boolean") {
    return signal === true;
  }
  if (typeof signal === "number") {
    if (!Number.isFinite(signal)) return false;
    return signal >= healthThreshold;
  }
  return false;
}

/**
 * Parse a cost score for deterministic ordering.
 * Numbers used as-is; decimal strings parsed via base-10 (not money float path).
 * Missing / unparseable → +Infinity (sorted last).
 * Gateway ids in the cost map are matched case-insensitively.
 */
export function costScore(
  gatewayId: string,
  input: RoutingInput,
): number {
  if (input.cost === undefined) return Number.POSITIVE_INFINITY;
  const raw = lookupGatewayMapEntry(input.cost, gatewayId);
  if (raw === undefined) return Number.POSITIVE_INFINITY;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return Number.POSITIVE_INFINITY;
  // Decimal string score — not a money amount; use Number only as score rank.
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

