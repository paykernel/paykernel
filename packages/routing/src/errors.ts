/**
 * Typed errors for safe routing (Phase 21).
 */

import type { RoutingInput, SubmissionState } from "./types";

/**
 * Machine-readable {@link NoRouteMatchError.reason} values.
 * Honesty reasons must not be rewritten to `no_alternate_gateway`.
 */
export type NoRouteMatchReason =
  | "no_usable_fallback"
  | "amount_range_honesty"
  | "capability_honesty"
  | "currency_mismatch_honesty"
  | "complementary_currency_honesty"
  | "complementary_country_honesty"
  | "complementary_method_honesty"
  | "complementary_tenant_honesty";

const SELECT_HONESTY_REASONS: ReadonlySet<string> = new Set([
  "amount_range_honesty",
  "capability_honesty",
  "currency_mismatch_honesty",
  "complementary_currency_honesty",
  "complementary_country_honesty",
  "complementary_method_honesty",
  "complementary_tenant_honesty",
]);

/** True when select refused unconstrained fallback for an honesty bound. */
export function isSelectHonestyReason(reason: string): boolean {
  return SELECT_HONESTY_REASONS.has(reason);
}

/** Thrown when no rule matches and no select-time fallback is available. */
export class NoRouteMatchError extends Error {
  readonly code = "no_route_match" as const;
  readonly input: RoutingInput;
  /** Why select failed; honesty reasons stay visible after post-attempt wrap. */
  readonly reason: NoRouteMatchReason;

  constructor(
    message: string,
    input: RoutingInput,
    reason: NoRouteMatchReason = "no_usable_fallback",
  ) {
    super(message);
    this.name = "NoRouteMatchError";
    this.input = input;
    this.reason = reason;
  }
}

/**
 * Thrown when post-attempt fallback is denied (unsafe submission state
 * without a valid expert override), or when no alternate gateway can be selected.
 */
export class UnsafeFallbackDeniedError extends Error {
  readonly code = "unsafe_fallback_denied" as const;
  readonly submissionState: SubmissionState;
  readonly reason: string;

  constructor(
    message: string,
    options: { submissionState: SubmissionState; reason: string },
  ) {
    super(message);
    this.name = "UnsafeFallbackDeniedError";
    this.submissionState = options.submissionState;
    this.reason = options.reason;
  }
}

export function isNoRouteMatchError(err: unknown): err is NoRouteMatchError {
  return err instanceof NoRouteMatchError;
}

export function isUnsafeFallbackDeniedError(
  err: unknown,
): err is UnsafeFallbackDeniedError {
  return err instanceof UnsafeFallbackDeniedError;
}
