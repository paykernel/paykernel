/**
 * Restricted post-attempt fallback eligibility (Phase 21.3).
 *
 * SEPARATE from select-time `createPaymentRouter({ fallback })`.
 *
 * Default-deny: only `not_submitted` and `pre_submission_failure` are safe.
 * Never auto-route after timeout, connection_reset, indeterminate,
 * provider_5xx_uncertain, or submitted (duplicate-charge risk).
 *
 * Expert override is opt-in and loud: branded object only, never defaulted.
 */

import type { PaymentOperationOutcome } from "@paykernel/core";
import { isIndeterminateOutcome } from "@paykernel/core";
import { NoRouteMatchError, UnsafeFallbackDeniedError } from "./errors";
import type { PaymentRouter } from "./types";
import type {
  ExpertUnsafeFallbackOverride,
  FallbackEligibility,
  RoutingDecision,
  RoutingInput,
  SubmissionState,
} from "./types";

const SAFE_STATES: ReadonlySet<SubmissionState> = new Set([
  "not_submitted",
  "pre_submission_failure",
]);

const ALL_STATES: ReadonlySet<SubmissionState> = new Set([
  "not_submitted",
  "pre_submission_failure",
  "submitted",
  "indeterminate",
  "timeout",
  "connection_reset",
  "provider_5xx_uncertain",
]);

/**
 * ROUTE-3: authentic expert-override eligibility objects produced only by
 * {@link evaluateFallback}. Forged `{ allowed:true, expertOverride:true,
 * reason:"expert_override:…" }` objects are rejected by
 * {@link trySelectFallbackGateway} because they are not in this set.
 */
const AUTHENTIC_EXPERT_ELIGIBILITY = new WeakSet<object>();

/**
 * True ONLY for states where the request was never accepted by a provider:
 * `not_submitted` | `pre_submission_failure`.
 *
 * False for timeout, connection_reset, indeterminate, provider_5xx_uncertain,
 * submitted (A2).
 */
export function isSafeFallbackEligible(state: SubmissionState): boolean {
  return SAFE_STATES.has(state);
}

/**
 * Evaluate post-attempt fallback eligibility.
 *
 * - Safe states → allowed:true
 * - Unsafe states → allowed:false UNLESS expertOverride with
 *   `confirmUnsafeFallback: true` AND non-empty reason string
 */
export function evaluateFallback(input: {
  submissionState: SubmissionState;
  expertOverride?: ExpertUnsafeFallbackOverride;
}): FallbackEligibility {
  const { submissionState } = input;

  if (isSafeFallbackEligible(submissionState)) {
    return {
      allowed: true,
      reason: "safe_submission_state",
      submissionState,
    };
  }

  if (isExpertUnsafeFallbackOverride(input.expertOverride)) {
    const eligibility: FallbackEligibility = {
      allowed: true,
      reason: `expert_override:${input.expertOverride.reason.trim()}`,
      submissionState,
      expertOverride: true,
    };
    // ROUTE-3: brand genuine evaluateFallback expert results only.
    AUTHENTIC_EXPERT_ELIGIBILITY.add(eligibility);
    return eligibility;
  }

  return {
    allowed: false,
    reason: unsafeDenyReason(submissionState),
    submissionState,
  };
}

function unsafeDenyReason(state: SubmissionState): string {
  switch (state) {
    case "timeout":
      return "denied_timeout";
    case "connection_reset":
      return "denied_connection_reset";
    case "indeterminate":
      return "denied_indeterminate";
    case "provider_5xx_uncertain":
      return "denied_provider_5xx_uncertain";
    case "submitted":
      return "denied_submitted";
    default:
      return "denied_unsafe_state";
  }
}

/**
 * Map a core {@link PaymentOperationOutcome} to a {@link SubmissionState}.
 *
 * **Never** maps `indeterminate` → `pre_submission_failure`.
 * Conservative: unknown / succeeded / requires_action / declined map to
 * states that do not enable automatic multi-gateway retry.
 */
export function classifyFromOperationOutcome(
  outcome: PaymentOperationOutcome,
): SubmissionState {
  switch (outcome) {
    case "indeterminate":
      return "indeterminate";
    case "failed":
      // Generic failed without submission evidence — treat as pre-submission
      // only when the app has classified transport-level failure separately.
      // Default: pre_submission_failure is NOT assumed for bare "failed".
      // Use classifySubmissionState with explicit hints for transport failures.
      return "submitted";
    case "succeeded":
    case "requires_action":
    case "declined":
      return "submitted";
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return "indeterminate";
    }
  }
}

/**
 * Classify submission state from outcome / error / explicit hints.
 *
 * Priority:
 * 1. Explicit `submissionState` **unless** it is a SAFE state that would
 *    override money-moving / uncertain evidence (P21-EXPLICIT-STATE).
 *    Expert override remains the only way to allow unsafe fallback.
 * 2. Known transport/uncertain error kinds (timeout, connection_reset, etc.)
 * 3. PaymentOperationOutcome when it indicates money may have moved / is
 *    uncertain (indeterminate / succeeded / requires_action / declined / failed)
 *    — **ROUTE-2:** these must not be overridden to `pre_submission_failure`
 *    by a mis-mapped `validation_error`
 * 4. Remaining error kinds / error object shapes.
 *    Bare `errorKind: "validation_error"` is **indeterminate** (same class as
 *    `invalid_request`). Only a ValidationError-shaped object
 *    (`name === "ValidationError"` / `code === "validation_error"`) is
 *    `pre_submission_failure` (P21-VALIDATION-ERROR).
 * 5. Default: `indeterminate` (fail-closed for fallback)
 *
 * **Never** maps indeterminate → pre_submission_failure.
 *
 * **AbortError (money-safe default):** raw `AbortError` / `abort_error` /
 * `ABORT_ERR` classify as **`indeterminate`**, which is **not**
 * fallback-eligible. Abort may race after provider accept; auto multi-gateway
 * retry would risk double charge. For known pre-submit aborts use
 * `errorKind: "aborted_before_submit"` / `"cancelled_before_submit"`, explicit
 * `submissionState: "not_submitted"`, or
 * `expertUnsafeAbortAsNotSubmitted: true` (old unsafe default).
 */
export function classifySubmissionState(input: {
  submissionState?: SubmissionState;
  outcome?: PaymentOperationOutcome;
  /**
   * Optional error kind / code string (e.g. "timeout", "ECONNRESET",
   * "network_error", "validation_error", "not_submitted",
   * "aborted_before_submit").
   */
  errorKind?: string;
  /**
   * Optional raw error for shape-based classification.
   * Secrets must not be required — only name/code/message patterns.
   */
  error?: unknown;
  /**
   * Result object that may carry `outcome` (GatewayPaymentResult or
   * PaymentOperationResult). Indeterminate detection uses core helper.
   */
  result?: unknown;
  /**
   * Expert opt-in: restore pre-fix `AbortError` → `not_submitted` mapping
   * (fallback-eligible). **Unsafe** if abort can fire after provider accept.
   * Prefer explicit `submissionState` / `aborted_before_submit` instead.
   * Only the literal `true` is accepted (`exactOptionalPropertyTypes`).
   */
  expertUnsafeAbortAsNotSubmitted?: true;
}): SubmissionState {
  const abortAsNotSubmitted = input.expertUnsafeAbortAsNotSubmitted === true;

  const explicit =
    input.submissionState !== undefined && ALL_STATES.has(input.submissionState)
      ? input.submissionState
      : undefined;

  // Transport / uncertain error kinds still win (timeout, reset, 5xx, abort).
  // Pre-submission-only kinds (configuration_error, explicit not_submitted)
  // are deferred until after outcome so ROUTE-2 cannot auto-fallback after
  // money moved. Bare validation_error is indeterminate (not pre-submit).
  const fromErrorKind = classifyErrorKind(input.errorKind, abortAsNotSubmitted);
  const fromError = classifyErrorObject(input.error, abortAsNotSubmitted);

  // P21-EXPLICIT-STATE: explicit SAFE state must not override money-moving /
  // uncertain evidence into a fallback-eligible state. Explicit still wins
  // when there is no conflicting money evidence (or when it is already unsafe).
  if (explicit !== undefined) {
    if (
      !isSafeFallbackEligible(explicit) ||
      !hasConflictingMoneyEvidence(input, fromErrorKind, fromError)
    ) {
      return explicit;
    }
  }

  if (fromErrorKind !== null && !isPreSubmissionOnlyClassification(fromErrorKind)) {
    return fromErrorKind;
  }

  if (fromError !== null && !isPreSubmissionOnlyClassification(fromError)) {
    return fromError;
  }

  // ROUTE-2: outcome / result that indicate submission or uncertainty take
  // precedence over validation_error → pre_submission_failure.
  if (input.outcome !== undefined) {
    return classifyFromOperationOutcome(input.outcome);
  }

  if (input.result !== undefined) {
    const fromResult = classifyResultShape(input.result);
    if (fromResult !== null) {
      return fromResult;
    }
  }

  // No money-moving outcome: allow deferred pre-submission classifications.
  if (fromErrorKind !== null) {
    return fromErrorKind;
  }
  if (fromError !== null) {
    return fromError;
  }

  // Fail-closed: unknown → indeterminate (blocks automatic fallback).
  return "indeterminate";
}

/** True for states that only mean "never reached provider" (safe fallback). */
function isPreSubmissionOnlyClassification(state: SubmissionState): boolean {
  return state === "pre_submission_failure" || state === "not_submitted";
}

const MONEY_MOVING_OR_UNCERTAIN_OUTCOMES: ReadonlySet<string> = new Set([
  "indeterminate",
  "succeeded",
  "failed",
  "declined",
  "requires_action",
]);

/**
 * P21-EXPLICIT-STATE: evidence that money may have moved or is uncertain.
 * Explicit SAFE submissionState must not override these into a fallback-eligible
 * state. Expert override is the only allowed escape hatch.
 */
function hasConflictingMoneyEvidence(
  input: {
    outcome?: string;
    result?: unknown;
  },
  fromErrorKind: SubmissionState | null,
  fromError: SubmissionState | null,
): boolean {
  if (
    input.outcome !== undefined &&
    MONEY_MOVING_OR_UNCERTAIN_OUTCOMES.has(input.outcome)
  ) {
    return true;
  }

  if (resultIndicatesMoneyMovedOrUncertain(input.result)) {
    return true;
  }

  return (
    isUnsafeMoneyEvidenceState(fromErrorKind) ||
    isUnsafeMoneyEvidenceState(fromError)
  );
}

function isUnsafeMoneyEvidenceState(state: SubmissionState | null): boolean {
  return (
    state === "timeout" ||
    state === "connection_reset" ||
    state === "provider_5xx_uncertain" ||
    state === "submitted" ||
    state === "indeterminate"
  );
}

function resultIndicatesMoneyMovedOrUncertain(result: unknown): boolean {
  if (result === null || typeof result !== "object") return false;
  if ("outcome" in result) {
    const outcome = (result as { outcome?: unknown }).outcome;
    if (typeof outcome === "string" && MONEY_MOVING_OR_UNCERTAIN_OUTCOMES.has(outcome)) {
      return true;
    }
  }
  if (
    "success" in result &&
    "gatewayId" in result &&
    "status" in result &&
    isIndeterminateOutcome(
      result as Parameters<typeof isIndeterminateOutcome>[0],
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Classify only known payment-result shapes. Returns null for unrecognized
 * values so callers can fail-closed without catch-all swallowing.
 */
function classifyResultShape(result: unknown): SubmissionState | null {
  if (result === null || typeof result !== "object") {
    return null;
  }

  // Prefer dual-write / operation outcome when present (covers PaymentOperationResult
  // and GatewayPaymentResult with outcome attached).
  if ("outcome" in result) {
    const outcome = (result as { outcome?: unknown }).outcome;
    if (outcome === "indeterminate") return "indeterminate";
    if (
      outcome === "succeeded" ||
      outcome === "requires_action" ||
      outcome === "declined" ||
      outcome === "failed"
    ) {
      return classifyFromOperationOutcome(outcome);
    }
  }

  // GatewayPaymentResult without outcome: use core helper only on the
  // structural shape it accepts (success + gatewayId + status).
  if (
    "success" in result &&
    "gatewayId" in result &&
    "status" in result &&
    isIndeterminateOutcome(
      result as Parameters<typeof isIndeterminateOutcome>[0],
    )
  ) {
    return "indeterminate";
  }

  return null;
}

function classifyErrorKind(
  kind: string | undefined,
  abortAsNotSubmitted: boolean,
): SubmissionState | null {
  if (kind === undefined) return null;
  const k = kind.trim().toLowerCase();
  if (!k) return null;

  if (
    k === "not_submitted" ||
    k === "aborted_before_submit" ||
    k === "cancelled_before_submit"
  ) {
    return "not_submitted";
  }
  // Generic abort without pre-submit guarantee → indeterminate (not fallback-eligible).
  if (
    k === "abort_error" ||
    k === "aborterror" ||
    k === "abort_err" ||
    k === "aborted" ||
    k === "abort"
  ) {
    return abortAsNotSubmitted ? "not_submitted" : "indeterminate";
  }
  // Local/schema config errors are safely pre-submit.
  // P21-VALIDATION-ERROR: bare errorKind "validation_error" is the same class
  // as invalid_request (may be a mis-mapped provider 400) — indeterminate.
  // Only a ValidationError-shaped *object* is pre_submission_failure.
  if (
    k === "pre_submission_failure" ||
    k === "configuration_error" ||
    k === "auth_config_error"
  ) {
    return "pre_submission_failure";
  }
  if (k === "invalid_request") {
    return "indeterminate";
  }
  if (k === "timeout" || k === "etimedout" || k === "network_timeout") {
    return "timeout";
  }
  if (
    k === "connection_reset" ||
    k === "econnreset" ||
    k === "econnrefused" ||
    k === "socket_hang_up"
  ) {
    return "connection_reset";
  }
  if (
    k === "provider_5xx_uncertain" ||
    k === "uncertain_5xx" ||
    k === "http_5xx_uncertain"
  ) {
    return "provider_5xx_uncertain";
  }
  if (k === "indeterminate" || k === "ambiguous" || k === "unknown") {
    return "indeterminate";
  }
  if (k === "submitted" || k === "network_error") {
    // Generic network without classification → indeterminate (safer than pre-submit).
    return k === "submitted" ? "submitted" : "indeterminate";
  }
  return null;
}

function classifyErrorObject(
  error: unknown,
  abortAsNotSubmitted: boolean,
): SubmissionState | null {
  if (error === null || error === undefined) return null;
  if (typeof error !== "object") return null;

  const e = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };

  const name = typeof e.name === "string" ? e.name.toLowerCase() : "";
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";

  // Abort may fire after provider accept (client deadline race); treating as
  // not_submitted would enable multi-gateway fallback and risk double charge.
  // Opt in to old mapping only via expertUnsafeAbortAsNotSubmitted.
  if (
    name === "aborterror" ||
    code === "abort_error" ||
    code === "abort_err" ||
    code === "aborted"
  ) {
    return abortAsNotSubmitted ? "not_submitted" : "indeterminate";
  }
  // ValidationError-shaped object (name or code): local schema (safe pre-submit).
  // Bare errorKind "validation_error" is handled in classifyErrorKind as
  // indeterminate (P21-VALIDATION-ERROR) — apps must not map provider 400s.
  // InvalidRequestError / invalid_request: may be post-accept provider validation
  // or idempotency reuse — ROUTE-1 fail-closed to indeterminate (no multi-gateway retry).
  if (name === "validationerror" || code === "validation_error") {
    return "pre_submission_failure";
  }
  if (name === "invalidrequesterror" || code === "invalid_request") {
    return "indeterminate";
  }
  if (
    code === "etimedout" ||
    code === "timeout" ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }
  if (
    code === "econnreset" ||
    code === "econnrefused" ||
    message.includes("connection reset") ||
    message.includes("socket hang up")
  ) {
    return "connection_reset";
  }
  if (
    typeof e.statusCode === "number" &&
    e.statusCode >= 500 &&
    e.statusCode < 600
  ) {
    return "provider_5xx_uncertain";
  }

  return null;
}

/**
 * Select an alternate gateway only when eligibility is safe.
 *
 * Does not trust `eligibility.allowed` alone. Re-validates
 * {@link isSafeFallbackEligible} on `eligibility.submissionState`. Forged
 * `{ allowed: true, submissionState: "timeout" | "submitted" | … }` is denied
 * unless eligibility carries a genuine expert override from
 * {@link evaluateFallback} (`expertOverride: true` **and**
 * `reason` starting with `expert_override:` — bare `expertOverride: true`
 * without that reason prefix is rejected).
 *
 * Excludes already-attempted gateways from candidates.
 *
 * Throws {@link UnsafeFallbackDeniedError} when not allowed or no alternate.
 */
export function trySelectFallbackGateway(
  router: PaymentRouter,
  input: RoutingInput,
  eligibility: FallbackEligibility,
  options?: {
    /** Gateways already attempted (always excluded). */
    attemptedGateways?: readonly string[];
  },
): RoutingDecision {
  if (!eligibility.allowed) {
    throw new UnsafeFallbackDeniedError(
      `Post-attempt fallback denied: ${eligibility.reason}`,
      {
        submissionState: eligibility.submissionState,
        reason: eligibility.reason,
      },
    );
  }

  // Re-validate submission safety — never trust forged allowed:true.
  // ROUTE-3: expert override requires authentic evaluateFallback object
  // (WeakSet brand) plus flag + non-empty expert_override reason prefix.
  // Forged { allowed:true, expertOverride:true, reason:"expert_override:…" }
  // is denied — prefix alone is not sufficient.
  const state = eligibility.submissionState;
  const genuineExpertOverride =
    eligibility.expertOverride === true &&
    AUTHENTIC_EXPERT_ELIGIBILITY.has(eligibility) &&
    typeof eligibility.reason === "string" &&
    eligibility.reason.startsWith("expert_override:") &&
    eligibility.reason.length > "expert_override:".length;
  if (!isSafeFallbackEligible(state) && !genuineExpertOverride) {
    throw new UnsafeFallbackDeniedError(
      `Post-attempt fallback denied: submission state is not safe for multi-gateway retry (${state})`,
      {
        submissionState: state,
        reason: unsafeDenyReason(state),
      },
    );
  }

  // ROUTE-1: attempted/exclude gateway ids compared case-insensitively.
  const attempted = new Set<string>(
    [...(options?.attemptedGateways ?? []), ...(input.excludeGateways ?? [])]
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean),
  );

  const selectInput: RoutingInput = { ...input };
  if (attempted.size > 0) {
    // Pass original casing through; router.select lowercases for comparison.
    selectInput.excludeGateways = Object.freeze([
      ...(options?.attemptedGateways ?? []),
      ...(input.excludeGateways ?? []),
    ]);
  }

  // router.select honors excludeGateways for both rules and select-time fallback.
  let decision: RoutingDecision;
  try {
    decision = router.select(selectInput);
  } catch (err) {
    if (err instanceof NoRouteMatchError) {
      throw new UnsafeFallbackDeniedError(
        "Post-attempt fallback denied: no alternate gateway available",
        {
          submissionState: eligibility.submissionState,
          reason: "no_alternate_gateway",
        },
      );
    }
    throw err;
  }

  if (attempted.has(decision.gateway.trim().toLowerCase())) {
    throw new UnsafeFallbackDeniedError(
      "Post-attempt fallback denied: no alternate gateway available",
      {
        submissionState: eligibility.submissionState,
        reason: "no_alternate_gateway",
      },
    );
  }

  return decision;
}

/** Type guard for expert override shape (runtime). */
export function isExpertUnsafeFallbackOverride(
  value: unknown,
): value is ExpertUnsafeFallbackOverride {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.confirmUnsafeFallback === true &&
    typeof v.reason === "string" &&
    v.reason.trim().length > 0
  );
}
