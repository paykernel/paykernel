/**
 * Safe routing types (Phase 21).
 *
 * Selection is pure and separate from payment execution.
 * Post-attempt fallback eligibility is a separate structural safety surface.
 */

/**
 * Application input for {@link PaymentRouter.select}.
 *
 * Unspecified fields are wildcards for matching. Health and cost are
 * select-time signals only — never used to auto-route after submission.
 */
export type RoutingInput = {
  currency?: string;
  country?: string;
  paymentMethod?: string;
  /**
   * Money-shaped amount OR major-unit decimal string for range checks.
   * When a plain string, pair with {@link amountCurrency}.
   */
  amount?: { amount: string; currency: string } | string;
  /** Currency for plain-string {@link amount}. */
  amountCurrency?: string;
  tenant?: string;
  tenantConfig?: Record<string, string | number | boolean>;
  /** Required capabilities the selected gateway must claim true. */
  requiredCapabilities?: readonly string[];
  /** Preferred gateway id (boost among matches; not a hard requirement unless on a rule). */
  merchantPreference?: string;
  /**
   * Per-gateway health signal.
   * - `false` → unhealthy (excluded at select time)
   * - `number` → unhealthy when below the router health threshold (default `1`)
   * - missing key → treated as healthy
   */
  health?: Record<string, number | boolean>;
  /**
   * Per-gateway cost score (lower preferred when used as a tie-break among matches).
   * Values may be finite numbers or decimal strings (parsed as base-10, not float money).
   */
  cost?: Record<string, number | string>;
  /**
   * Capability snapshot per gateway id.
   * Fail-closed: missing map for a candidate gateway fails requiredCapabilities.
   */
  gatewayCapabilities?: Record<string, Partial<Record<string, boolean>>>;
  /**
   * Gateways already attempted in this payment flow (excluded when selecting
   * a post-attempt alternate via {@link trySelectFallbackGateway}).
   */
  excludeGateways?: readonly string[];
};

/**
 * Criteria attached to a routing rule via {@link route}.
 * Unspecified fields are wildcards (match any input value).
 * All specified fields must match (AND).
 */
export type RouteMatchCriteria = {
  currency?: string;
  country?: string;
  paymentMethod?: string;
  /** Inclusive lower bound (major-unit decimal string). Requires {@link amountCurrency}. */
  amountMin?: string;
  /** Inclusive upper bound (major-unit decimal string). Requires {@link amountCurrency}. */
  amountMax?: string;
  /** Currency for amount range comparisons (required when amountMin/amountMax set). */
  amountCurrency?: string;
  tenant?: string;
  /**
   * Exact match for each specified key against {@link RoutingInput.tenantConfig}.
   * Unspecified keys are wildcards.
   */
  tenantConfig?: Record<string, string | number | boolean>;
  /**
   * Capabilities the rule's gateway must have true in input.gatewayCapabilities.
   * Fail-closed when the capability map for the gateway is missing.
   */
  requiredCapabilities?: readonly string[];
  /**
   * When set on a rule, input.merchantPreference must equal this value
   * (case-sensitive after trim) for the rule to match.
   */
  merchantPreference?: string;
};

/** Immutable rule produced by `route(match).to(gateway)`. */
export type RoutingRule = {
  readonly match: Readonly<RouteMatchCriteria>;
  readonly gateway: string;
};

/** Stable reason codes for {@link RoutingDecision.reason}. */
export type RoutingDecisionReason =
  | "rule_match"
  | "rule_match_merchant_preference"
  | "rule_match_cost_tiebreak"
  | "fallback";

/**
 * Result of pure select-time gateway choice.
 * `gateway` is always present on success so apps can pass it to createPayment
 * and OperationContext / telemetry (A3).
 */
export type RoutingDecision = {
  gateway: string;
  /** True when a configured rule matched (not select-time fallback). */
  matched: boolean;
  /** True when config.fallback was used because no rule matched. */
  usedFallback: boolean;
  /** Index of the matched rule when matched. */
  ruleIndex?: number;
  /** Stable machine-readable reason code. */
  reason: RoutingDecisionReason;
};

/**
 * Submission-state classification for post-attempt fallback eligibility.
 *
 * Safe (default-allow): `not_submitted`, `pre_submission_failure`.
 * Unsafe (default-deny): all others — never auto-route to another gateway.
 */
export type SubmissionState =
  | "not_submitted"
  | "pre_submission_failure"
  | "submitted"
  | "indeterminate"
  | "timeout"
  | "connection_reset"
  | "provider_5xx_uncertain";

/**
 * Explicit expert override for unsafe post-attempt fallback.
 * Must be a branded object with `confirmUnsafeFallback: true` and a non-empty reason.
 * NEVER default this on. NEVER accept bare `true` as sufficient.
 */
export type ExpertUnsafeFallbackOverride = {
  readonly confirmUnsafeFallback: true;
  readonly reason: string;
};

/** Result of post-attempt fallback eligibility evaluation. */
export type FallbackEligibility = {
  allowed: boolean;
  reason: string;
  submissionState: SubmissionState;
  /** True when allowed only because of an expert override. */
  expertOverride?: boolean;
};

/** Options for {@link createPaymentRouter}. */
export type CreatePaymentRouterOptions = {
  rules: readonly RoutingRule[];
  /**
   * Select-time default gateway when no rule matches.
   * NOT post-attempt recovery — see {@link isSafeFallbackEligible}.
   * When omitted (or unusable after health/capability filters), select throws
   * {@link NoRouteMatchError} — always fail-closed; never invent a gateway id.
   */
  fallback?: string;
  /**
   * Minimum health score for numeric health signals (default `1`).
   * Gateways with `health[id] < healthThreshold` are excluded at select time.
   */
  healthThreshold?: number;
};

/** Pure select-only router. NEVER calls createPayment / capture / refund. */
export type PaymentRouter = {
  select(input: RoutingInput): RoutingDecision;
  /** Frozen snapshot of configured rules (for tests / introspection). */
  readonly rules: readonly RoutingRule[];
  /** Select-time fallback gateway id, if any. */
  readonly fallback: string | undefined;
  /** Health threshold used for numeric health signals. */
  readonly healthThreshold: number;
};

/** Non-sensitive telemetry attributes derived from a routing decision (A3). */
export type RoutingTelemetryAttributes = {
  gateway: string;
  matched: boolean;
  usedFallback: boolean;
  reason: RoutingDecisionReason;
  ruleIndex?: number;
};
