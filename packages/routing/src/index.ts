/**
 * @paykernel/routing — portable safe payment routing policies.
 *
 * Depends only on `@paykernel/core` (core). No testkit, adapters,
 * webhooks, reconciliation, or observability. No framework coupling.
 * No Node-only imports.
 *
 * Select is pure and separate from payment execution. Post-attempt fallback
 * is default-deny except for not_submitted / pre_submission_failure.
 *
 * @packageDocumentation
 */

// Router (21.2)
export { createPaymentRouter, decisionToTelemetryAttributes } from "./router";

// Rule builder
export { route } from "./route";
export type { RouteBuilder } from "./route";

// Post-attempt fallback eligibility (21.3)
export {
  isSafeFallbackEligible,
  evaluateFallback,
  classifySubmissionState,
  classifyFromOperationOutcome,
  trySelectFallbackGateway,
  isExpertUnsafeFallbackOverride,
} from "./fallback";

// Match helpers (advanced / tests)
export {
  ruleMatches,
  gatewayHasCapabilities,
  isGatewayHealthy,
  costScore,
  stringsEqualCi,
} from "./match";

// Amount range (money-safe)
export {
  amountInRange,
  resolveInputAmount,
  compareDecimalAmounts,
} from "./amount-range";

// Errors
export {
  NoRouteMatchError,
  UnsafeFallbackDeniedError,
  isNoRouteMatchError,
  isUnsafeFallbackDeniedError,
  isSelectHonestyReason,
} from "./errors";
export type { NoRouteMatchReason } from "./errors";

// Types
export type {
  RoutingInput,
  RouteMatchCriteria,
  RoutingRule,
  RoutingDecision,
  RoutingDecisionReason,
  SubmissionState,
  ExpertUnsafeFallbackOverride,
  FallbackEligibility,
  CreatePaymentRouterOptions,
  PaymentRouter,
  RoutingTelemetryAttributes,
} from "./types";
