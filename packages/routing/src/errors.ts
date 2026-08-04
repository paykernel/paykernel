/**
 * Typed errors for safe routing (Phase 21).
 */

import type { RoutingInput, SubmissionState } from "./types";

/** Thrown when no rule matches and no select-time fallback is available. */
export class NoRouteMatchError extends Error {
  readonly code = "no_route_match" as const;
  readonly input: RoutingInput;

  constructor(message: string, input: RoutingInput) {
    super(message);
    this.name = "NoRouteMatchError";
    this.input = input;
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
